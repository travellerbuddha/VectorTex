import { VersionConflictError, type ExternalOutcome, type OpaqueRef, type ProviderBookingState } from '@texholiday/contracts';
import type { QuoteDifference } from '../quote';
import type { BookingStatus } from '../state/machines';
import {
  audit,
  emit,
  raiseTask,
  setBookingStatus,
  setOrderStatus,
  setPaymentStatus,
  type OrderAggregate,
  type OrderItemState,
} from './aggregate';
import type { OrderStore } from './orchestrator';

/**
 * Provider-managed checkout (spec §5.1, ADR-0008): the provider's payment component collects the customer payment;
 * we only create the prebook with the payment session and finalize the booking with the provider transaction.
 * - We can neither verify a payment separately nor capture/refund it (no documented endpoint): the booking result is
 *   the proof. A browser return only triggers finalization; ids from the URL are never used.
 * - Closing the browser loses nothing: the worker keeps finalizing until the pay-by deadline, then abandons the
 *   checkout after a lookup (an unfinished provider payment hold is released by the provider).
 * - "Payment not completed" uses up the client reference without creating a booking (Nuitee sandbox, 2026-10-09:
 *   the same reference then answers 4005 and finds nothing), so every try after it gets a NEW reference. The provider
 *   transaction books at most once (a used transaction answers "payment not completed" again), and before giving up
 *   every reference ever sent is looked up.
 */
export interface ProviderManagedPrebook {
  prebookRef: OpaqueRef;
  transactionId: OpaqueRef;
  /** Short-lived secret for the provider payment component (never our API key). */
  clientSecret: string;
  /** Differences to the accepted quote (price, cancellation, board...). Any difference needs a new acceptance. */
  differences: readonly QuoteDifference[];
}

export interface ProviderManagedBookingPort {
  prebookForPayment(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderManagedPrebook>>;
  book(agg: OrderAggregate, it: OrderItemState, clientReference: string, transaction: { prebookRef: OpaqueRef; transactionId: OpaqueRef }): Promise<ExternalOutcome<ProviderBookingState>>;
  /** The booking made under `clientReference`, or null when none exists. */
  lookup(agg: OrderAggregate, it: OrderItemState, clientReference: string): Promise<ExternalOutcome<ProviderBookingState | null>>;
}

export interface ProviderManagedPolicy {
  /** Lease for a side-effecting call; must exceed the provider's documented long-operation budget. */
  intentLeaseSeconds: number;
  /** Delay before the next finalization attempt while the customer has not paid yet (attempt starts at 1). */
  finalizeRetrySeconds: (attempt: number) => number;
  /** After this many inconclusive lookups a human is asked (lookups continue). */
  maxAutomaticLookups: number;
}

export interface ProviderManagedDeps {
  store: OrderStore;
  port: ProviderManagedBookingPort;
  clock(): Date;
  workerId: string;
  policy: ProviderManagedPolicy;
}

/** Codes a connector returns when the provider refuses the booking only because the customer has not paid yet. */
export const PAYMENT_NOT_COMPLETED_CODES: ReadonlySet<string> = new Set(['NUITEE_PAYMENT_NOT_COMPLETED']);

export type ProviderManagedAction =
  | { type: 'NONE'; reason: string }
  | { type: 'PREBOOK' }
  | { type: 'FINALIZE' }
  | { type: 'LOOKUP' }
  | { type: 'EXPIRE' }
  | { type: 'INTENT_EXPIRED' };

const ACTOR = 'system:provider-managed';

function single(agg: OrderAggregate): OrderItemState {
  if (agg.route.mode !== 'PROVIDER_MANAGED' || agg.items.length !== 1 || !agg.payment) {
    throw new Error(`Order ${agg.id} is not a single-item provider-managed checkout`);
  }
  return agg.items[0] as OrderItemState;
}

/** Every client reference a book call may have been sent with, newest first (`${booking.id}-${n}`, see book()). */
function sentReferences(it: OrderItemState): string[] {
  const refs = new Set<string>();
  if (it.booking.clientReference) refs.add(it.booking.clientReference);
  for (let n = it.booking.clientReferenceSeq; n >= 1; n -= 1) refs.add(`${it.booking.id}-${n}`);
  return [...refs];
}

/** Pure decision for one provider-managed order. `trigger` says whether a finalization was asked for. */
export function decideProviderManaged(agg: OrderAggregate, now: Date, trigger: 'STEP' | 'FINALIZE'): ProviderManagedAction {
  const it = single(agg);
  const p = agg.payment!;
  if (agg.status === 'CONFIRMED' || agg.status === 'CANCELLED') return { type: 'NONE', reason: 'order settled' };
  const intent = it.booking.intent;
  if (intent) return new Date(intent.leaseUntil).getTime() <= now.getTime() ? { type: 'INTENT_EXPIRED' } : { type: 'NONE', reason: 'call in flight' };
  if (it.booking.status === 'UNKNOWN' || it.booking.status === 'PENDING_CONFIRMATION') return { type: 'LOOKUP' };
  if (it.booking.status === 'NEW' && p.status === 'NEW') return { type: 'PREBOOK' };
  if (it.booking.status === 'PREPARED' && p.status === 'PENDING') {
    const expired = p.payBy !== null && new Date(p.payBy).getTime() <= now.getTime();
    if (expired) return { type: 'EXPIRE' };
    return trigger === 'FINALIZE' ? { type: 'FINALIZE' } : { type: 'NONE', reason: 'waiting for the customer payment' };
  }
  return { type: 'NONE', reason: `no provider-managed step for booking ${it.booking.status} / payment ${p.status}` };
}

export class ProviderManagedOrchestrator {
  constructor(private readonly deps: ProviderManagedDeps) {}

  /** Creates the prebook + payment session (idempotent: does nothing once the session exists). */
  async start(orderId: string): Promise<ProviderManagedAction> {
    return this.run(orderId, 'STEP');
  }

  /**
   * Tries to finalize: on a browser return, from the worker sweep, or after the deadline (abandon). The caller's
   * request carries no ids: the stored prebook/transaction is used. `attempt` (from the scheduled event) drives
   * the retry back-off while the customer has not paid yet.
   */
  async finalize(orderId: string, attempt = 1): Promise<ProviderManagedAction> {
    return this.run(orderId, 'FINALIZE', attempt);
  }

  private async run(orderId: string, trigger: 'STEP' | 'FINALIZE', attempt = 1): Promise<ProviderManagedAction> {
    const agg = await this.deps.store.load(orderId);
    const now = this.deps.clock();
    const action = decideProviderManaged(agg, now, trigger);
    try {
      switch (action.type) {
        case 'NONE':
          break;
        case 'PREBOOK':
          await this.prebook(agg, now);
          break;
        case 'FINALIZE':
          await this.book(agg, now, attempt);
          break;
        case 'LOOKUP':
          await this.lookup(agg, now, false);
          break;
        case 'EXPIRE':
          await this.expire(agg, now);
          break;
        case 'INTENT_EXPIRED':
          await this.intentExpired(agg, now);
          break;
      }
    } catch (err) {
      if (!(err instanceof VersionConflictError)) throw err;
      return { type: 'NONE', reason: 'concurrent update' };
    }
    return action;
  }

  private lease(now: Date) {
    return {
      startedAt: now.toISOString(),
      leaseUntil: new Date(now.getTime() + this.deps.policy.intentLeaseSeconds * 1000).toISOString(),
      workerId: this.deps.workerId,
    };
  }

  private async apply(orderId: string, mutate: (agg: OrderAggregate, it: OrderItemState) => void): Promise<void> {
    let agg = await this.deps.store.load(orderId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      mutate(agg, single(agg));
      try {
        await this.deps.store.save(agg);
        return;
      } catch (err) {
        if (!(err instanceof VersionConflictError)) throw err;
        agg = await this.deps.store.load(orderId);
      }
    }
    throw new VersionConflictError('order', orderId);
  }

  private scheduleFinalize(agg: OrderAggregate, now: Date, attempt: number): void {
    const delay = this.deps.policy.finalizeRetrySeconds(attempt);
    const payBy = agg.payment?.payBy ? new Date(agg.payment.payBy).getTime() : Number.POSITIVE_INFINITY;
    // Never later than the deadline, so an abandoned checkout is closed on time.
    const at = Math.min(now.getTime() + delay * 1000, payBy);
    emit(agg, 'order.provider_managed.finalize', { orderId: agg.id, attempt }, new Date(at));
  }

  // ------------------------------------------------------------------ prebook

  private async prebook(agg: OrderAggregate, now: Date): Promise<void> {
    const it = single(agg);
    it.booking.intent = { op: 'PREBOOK', ...this.lease(now) };
    await this.deps.store.save(agg);
    const outcome = await this.deps.port.prebookForPayment(agg, it);
    await this.apply(agg.id, (fresh, fi) => {
      fi.booking.intent = null;
      const p = fresh.payment!;
      if (outcome.kind !== 'SUCCEEDED') {
        // A prebook is a provider session, not a reservation, and no customer money is involved yet.
        setBookingStatus(fresh, fi.id, 'FAILED', 'UPSTREAM_RESULT', ACTOR, now);
        fi.booking.failureCode = outcome.kind === 'REJECTED' ? outcome.code : outcome.kind;
        setPaymentStatus(fresh, 'DECLINED', 'UPSTREAM_RESULT', ACTOR, now);
        setOrderStatus(fresh, 'CANCELLED', 'UPSTREAM_RESULT', ACTOR, now, `PREBOOK_${fi.booking.failureCode}`);
        audit(fresh, 'provider_managed.prebook_failed', ACTOR, now, { itemId: fi.id, outcome: outcome.kind });
        return;
      }
      const v = outcome.value;
      if (v.differences.length > 0) {
        // K15/T04: a changed price or condition needs a new quote and explicit acceptance before any payment.
        setBookingStatus(fresh, fi.id, 'FAILED', 'UPSTREAM_RESULT', ACTOR, now);
        fi.booking.failureCode = `QUOTE_CHANGED:${v.differences.join('+')}`;
        setPaymentStatus(fresh, 'DECLINED', 'UPSTREAM_RESULT', ACTOR, now);
        setOrderStatus(fresh, 'CANCELLED', 'UPSTREAM_RESULT', ACTOR, now, fi.booking.failureCode);
        fresh.compensationReason = fi.booking.failureCode;
        emit(fresh, 'order.quote_changed', { orderId: fresh.id, differences: v.differences });
        return;
      }
      setBookingStatus(fresh, fi.id, 'PREPARED', 'UPSTREAM_RESULT', ACTOR, now);
      fi.booking.prebookRef = v.prebookRef;
      p.providerTransaction = { prebookRef: v.prebookRef, transactionId: v.transactionId };
      p.providerClientSecret = v.clientSecret;
      setPaymentStatus(fresh, 'PENDING', 'UPSTREAM_RESULT', ACTOR, now);
      audit(fresh, 'provider_managed.payment_session_created', ACTOR, now, { itemId: fi.id, prebookRef: v.prebookRef, transactionId: v.transactionId });
      emit(fresh, 'order.payment_session_ready', { orderId: fresh.id });
      this.scheduleFinalize(fresh, now, 1);
    });
  }

  // ------------------------------------------------------------------ book

  private async book(agg: OrderAggregate, now: Date, attempt: number): Promise<void> {
    const it = single(agg);
    const tx = agg.payment!.providerTransaction;
    if (!tx || it.booking.prebookRef !== tx.prebookRef) {
      raiseTask(agg, 'BOOKING_UNKNOWN', it.id, 'Provider transaction does not match the stored prebook', ACTOR, now);
      await this.deps.store.save(agg);
      return;
    }
    // A new client reference unless the current one may still hold a booking (only after an inconclusive answer,
    // which goes to lookup, never to another book call).
    if (!it.booking.clientReference) {
      it.booking.clientReferenceSeq += 1;
      it.booking.clientReference = `${it.booking.id}-${it.booking.clientReferenceSeq}`;
    }
    const clientReference = it.booking.clientReference;
    it.booking.intent = { op: 'BOOK', ...this.lease(now) };
    await this.deps.store.save(agg);

    const outcome = await this.deps.port.book(agg, it, clientReference, tx);
    await this.apply(agg.id, (fresh, fi) => {
      fi.booking.intent = null;
      const cause = fi.booking.status === 'UNKNOWN' ? 'RECONCILIATION' : 'UPSTREAM_RESULT';
      switch (outcome.kind) {
        case 'SUCCEEDED':
          this.applyBooked(fresh, fi, outcome.value, cause, now);
          return;
        case 'REJECTED':
          if (PAYMENT_NOT_COMPLETED_CODES.has(outcome.code)) {
            // The provider used up this reference without a booking; the next try needs a new one.
            audit(fresh, 'provider_managed.payment_not_completed', ACTOR, now, { itemId: fi.id, clientReference });
            fi.booking.clientReference = null;
            this.scheduleFinalize(fresh, now, attempt + 1);
            return;
          }
          this.fail(fresh, fi, outcome.code, cause, now, true);
          return;
        case 'UNKNOWN':
        case 'CAPABILITY_NOT_AVAILABLE':
          setBookingStatus(fresh, fi.id, 'UNKNOWN', cause, ACTOR, now);
          fi.booking.unknownOperation = 'BOOK';
          emit(fresh, 'order.provider_managed.lookup', { orderId: fresh.id }, new Date(now.getTime() + this.deps.policy.finalizeRetrySeconds(1) * 1000));
          return;
      }
    });
  }

  private applyBooked(agg: OrderAggregate, it: OrderItemState, state: ProviderBookingState, cause: 'UPSTREAM_RESULT' | 'RECONCILIATION', now: Date): void {
    const target: BookingStatus = state.status === 'PREPARED' ? 'PREPARED' : state.status;
    if (state.providerCommission) it.booking.providerCommission = state.providerCommission;
    it.booking.providerBookingRef = state.providerBookingRef ?? it.booking.providerBookingRef;
    it.booking.voucherReady = state.voucherReady;
    it.booking.unknownOperation = null;
    if (target === 'CONFIRMED' || target === 'ISSUED') {
      setBookingStatus(agg, it.id, target, cause, ACTOR, now);
      // The provider collected the customer payment when it confirmed the booking (it is the merchant of record).
      setPaymentStatus(agg, 'CAPTURED', cause, ACTOR, now);
      agg.payment!.providerClientSecret = null;
      setOrderStatus(agg, 'CONFIRMED', cause, ACTOR, now, 'PROVIDER_MANAGED_BOOKED');
      emit(agg, 'order.confirmed', { orderId: agg.id });
      return;
    }
    if (target === 'FAILED' || target === 'CANCELLED') {
      this.fail(agg, it, `PROVIDER_${target}`, cause, now, true);
      return;
    }
    // A pending provider confirmation is not a confirmation (T10): keep reading the booking.
    setBookingStatus(agg, it.id, target, cause, ACTOR, now);
    emit(agg, 'order.provider_managed.lookup', { orderId: agg.id }, new Date(now.getTime() + this.deps.policy.finalizeRetrySeconds(1) * 1000));
  }

  /** No booking exists. The customer may hold a payment authorization the provider releases on its own. */
  private fail(agg: OrderAggregate, it: OrderItemState, code: string, cause: 'UPSTREAM_RESULT' | 'RECONCILIATION' | 'COMMAND', now: Date, mayHoldPayment: boolean): void {
    if (it.booking.status !== 'FAILED') setBookingStatus(agg, it.id, 'FAILED', cause, ACTOR, now);
    it.booking.failureCode = code;
    it.booking.unknownOperation = null;
    setPaymentStatus(agg, 'DECLINED', cause, ACTOR, now);
    agg.payment!.providerClientSecret = null;
    setOrderStatus(agg, 'CANCELLED', cause, ACTOR, now, code);
    agg.compensationReason = code;
    if (mayHoldPayment) {
      raiseTask(
        agg,
        'PROVIDER_PAYMENT_HOLD',
        it.id,
        `No booking (${code}). If the customer paid, the provider releases the payment hold within 1-2 business days (user-payment guide); contact the customer.`,
        ACTOR,
        now,
      );
    }
    emit(agg, 'order.provider_managed.failed', { orderId: agg.id, code });
  }

  // ------------------------------------------------------------------ lookup / expiry

  /**
   * Reads the provider. An open outcome looks up the reference it was sent with; abandoning looks up every reference
   * ever sent, so a booking whose answer was lost is found even after later tries.
   */
  private async lookup(agg: OrderAggregate, now: Date, abandonIfMissing: boolean): Promise<void> {
    const it = single(agg);
    const refs = !abandonIfMissing && it.booking.clientReference ? [it.booking.clientReference] : sentReferences(it);
    let found: ProviderBookingState | null = null;
    let inconclusive = false;
    for (const ref of refs) {
      const outcome = await this.deps.port.lookup(agg, it, ref);
      if (outcome.kind === 'SUCCEEDED' && outcome.value) {
        found = outcome.value;
        break;
      }
      if (outcome.kind !== 'SUCCEEDED') inconclusive = true;
    }
    await this.apply(agg.id, (fresh, fi) => {
      if (found) {
        this.applyBooked(fresh, fi, found, 'RECONCILIATION', now);
        return;
      }
      if (!inconclusive) {
        if (abandonIfMissing) {
          this.fail(fresh, fi, 'CHECKOUT_EXPIRED', fi.booking.status === 'UNKNOWN' ? 'RECONCILIATION' : 'COMMAND', now, true);
          return;
        }
        if (fi.booking.status === 'UNKNOWN') {
          // Nothing was created under this reference: back to the prepared offer, a new reference for the next try.
          setBookingStatus(fresh, fi.id, 'PREPARED', 'RECONCILIATION', ACTOR, now);
          fi.booking.unknownOperation = null;
          fi.booking.clientReference = null;
          fi.booking.lookupAttempts = 0;
          this.scheduleFinalize(fresh, now, 1);
        }
        return;
      }
      fi.booking.lookupAttempts += 1;
      if (fi.booking.lookupAttempts >= this.deps.policy.maxAutomaticLookups) {
        raiseTask(fresh, 'BOOKING_UNKNOWN', fi.id, 'Provider-managed booking outcome still unknown after automatic lookups', ACTOR, now);
      }
      emit(fresh, 'order.provider_managed.lookup', { orderId: fresh.id }, new Date(now.getTime() + this.deps.policy.finalizeRetrySeconds(fi.booking.lookupAttempts + 1) * 1000));
    });
  }

  private async expire(agg: OrderAggregate, now: Date): Promise<void> {
    const it = single(agg);
    if (sentReferences(it).length > 0) {
      // A book call was sent before: make sure no booking exists under any reference before abandoning (T19).
      await this.lookup(agg, now, true);
      return;
    }
    await this.apply(agg.id, (fresh, fi) => this.fail(fresh, fi, 'CHECKOUT_EXPIRED', 'COMMAND', now, false));
  }

  private async intentExpired(agg: OrderAggregate, now: Date): Promise<void> {
    await this.apply(agg.id, (fresh, fi) => {
      const op = fi.booking.intent?.op;
      fi.booking.intent = null;
      if (op === 'PREBOOK') {
        // An unanswered prebook created at most a provider session; the item stops (no money involved).
        this.fail(fresh, fi, 'PREBOOK_UNCONFIRMED', 'UPSTREAM_RESULT', now, false);
        return;
      }
      setBookingStatus(fresh, fi.id, 'UNKNOWN', 'UPSTREAM_RESULT', ACTOR, now);
      fi.booking.unknownOperation = 'BOOK';
      emit(fresh, 'order.provider_managed.lookup', { orderId: fresh.id });
    });
  }
}
