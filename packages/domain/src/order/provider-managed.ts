import { DomainError, VersionConflictError, notAvailable, type ExternalOutcome, type OpaqueRef, type ProviderBookingState } from '@texholiday/contracts';
import { add, compare, money, toMajor, type Money } from '@texholiday/pricing';
import type { QuoteDifference } from '../quote';
import type { BookingStatus } from '../state/machines';
import {
  audit,
  emit,
  raiseTask,
  setBookingStatus,
  setCancellation,
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
  /** The provider's current state of a booking, by the provider booking id. */
  refresh(agg: OrderAggregate, it: OrderItemState, providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>>;
  /**
   * Cancels the booking at the provider. `penalty` and `providerRefund` are what the provider reports (null when not
   * reported); the provider, not us, collected the payment and refunds it by its own rules.
   */
  cancel(agg: OrderAggregate, it: OrderItemState, providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null; providerRefund: Money | null }>>;
}

/** What a staff "check status" did, for the panel. */
export interface StatusCheckResult {
  /** False when the provider could not be read (nothing changed; try again later). */
  providerAnswered: boolean;
  changed: boolean;
  /** A provider call for this order was already in flight; nothing was done. */
  busy: boolean;
  orderStatus: OrderAggregate['status'];
  bookingStatus: OrderItemState['booking']['status'];
}

export type StaffCancelResult =
  | { outcome: 'CANCELLED'; penalty: Money | null; providerRefund: Money | null }
  /** The provider refused the cancellation; the booking stays as it was. */
  | { outcome: 'REJECTED'; code: string }
  /** The answer was lost: the booking is checked again automatically; nothing is re-sent. */
  | { outcome: 'UNKNOWN' };

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
  /** A cancellation answer was lost: read the booking by its provider id (never re-send the cancel). */
  | { type: 'CANCEL_LOOKUP' }
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
  if (agg.status === 'CANCELLED') return { type: 'NONE', reason: 'order settled' };
  const intent = it.booking.intent;
  if (intent) return new Date(intent.leaseUntil).getTime() <= now.getTime() ? { type: 'INTENT_EXPIRED' } : { type: 'NONE', reason: 'call in flight' };
  if (it.booking.status === 'UNKNOWN' && it.booking.unknownOperation === 'CANCEL') return { type: 'CANCEL_LOOKUP' };
  if (agg.status === 'CONFIRMED') return { type: 'NONE', reason: 'order settled' };
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
        case 'CANCEL_LOOKUP':
          await this.cancelLookup(agg, now);
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
    emit(agg, 'order.provider_managed.failed', { orderId: agg.id, code, mayHoldPayment });
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
      if (op === 'CANCEL') {
        fi.booking.unknownOperation = 'CANCEL';
        setCancellation(fresh, fi.id, 'UNKNOWN', 'UPSTREAM_RESULT', ACTOR, now);
        raiseTask(fresh, 'CANCELLATION_UNKNOWN', fi.id, 'Cancel call lease expired without an answer; the booking is being checked', ACTOR, now);
      } else {
        fi.booking.unknownOperation = 'BOOK';
      }
      emit(fresh, 'order.provider_managed.lookup', { orderId: fresh.id });
    });
  }

  // ------------------------------------------------------------------ staff commands (/yonetim)

  /**
   * "Check status": reads the provider now and applies what it says, through the same rules as the automatic steps.
   * A confirmed booking is read by its provider id (a cancellation made at the provider or the hotel is picked up);
   * an open checkout or an unknown outcome takes its regular next step. Never creates a payment session.
   */
  async checkStatus(orderId: string, actor: string): Promise<StatusCheckResult> {
    const agg = await this.deps.store.load(orderId);
    const it = single(agg);
    const now = this.deps.clock();
    const before = `${agg.status}|${it.booking.status}|${agg.payment!.status}|${it.booking.voucherReady}`;
    const result = (fresh: OrderAggregate, providerAnswered: boolean, busy = false): StatusCheckResult => {
      const fi = single(fresh);
      return {
        providerAnswered,
        busy,
        changed: `${fresh.status}|${fi.booking.status}|${fresh.payment!.status}|${fi.booking.voucherReady}` !== before,
        orderStatus: fresh.status,
        bookingStatus: fi.booking.status,
      };
    };
    if (it.booking.intent && new Date(it.booking.intent.leaseUntil).getTime() > now.getTime()) return result(agg, true, true);

    let answered = true;
    if ((it.booking.status === 'CONFIRMED' || it.booking.status === 'ISSUED') && it.booking.providerBookingRef && !it.booking.intent) {
      answered = await this.verifyBooked(agg, now, actor);
    } else {
      const action = decideProviderManaged(agg, now, 'FINALIZE');
      if (action.type !== 'PREBOOK') {
        const lookupsBefore = it.booking.lookupAttempts;
        await this.run(orderId, 'FINALIZE', 1);
        const after = await this.deps.store.load(orderId);
        answered = !(single(after).booking.status === 'UNKNOWN' && single(after).booking.lookupAttempts > lookupsBefore);
      }
    }
    let fresh = await this.deps.store.load(orderId);
    const out = result(fresh, answered);
    await this.apply(orderId, (f) => audit(f, 'order.status_checked', actor, now, { providerAnswered: answered, changed: out.changed, orderStatus: out.orderStatus, bookingStatus: out.bookingStatus }));
    fresh = await this.deps.store.load(orderId);
    return result(fresh, answered);
  }

  /** Reads a confirmed booking; returns false when the provider gave no usable answer. */
  private async verifyBooked(agg: OrderAggregate, now: Date, actor: string): Promise<boolean> {
    const it = single(agg);
    const outcome = await this.deps.port.refresh(agg, it, it.booking.providerBookingRef!);
    if (outcome.kind !== 'SUCCEEDED') return false;
    const state = outcome.value;
    await this.apply(agg.id, (fresh, fi) => {
      if (fi.booking.intent || (fi.booking.status !== 'CONFIRMED' && fi.booking.status !== 'ISSUED')) return; // changed meanwhile
      if (state.status === 'CANCELLED') {
        // Cancelled outside TexHoliday (provider or hotel): the customer refund follows the provider's rules.
        this.cancelledAtProvider(fresh, fi, null, null, 'RECONCILIATION', now, actor, false);
        return;
      }
      if (state.status === 'CONFIRMED' || state.status === 'ISSUED') {
        fi.booking.voucherReady = state.voucherReady;
        return;
      }
      // Never move a confirmed booking backwards on a read: a person looks at it.
      raiseTask(fresh, 'BOOKING_UNKNOWN', fi.id, `Provider reports ${state.status} for a booking we hold as ${fi.booking.status}`, actor, now);
    });
    return true;
  }

  /**
   * Cancels a confirmed booking at the provider (staff command, `orders.cancel` checked by the caller). The intent is
   * stored before the call; a lost answer is resolved by reading the booking, never by sending the cancel again.
   */
  async cancel(orderId: string, actor: string, reason: string, context: { expectedPenalty: Money | null; customerAcceptedFee: boolean } = { expectedPenalty: null, customerAcceptedFee: false }): Promise<StaffCancelResult> {
    const agg = await this.deps.store.load(orderId);
    const it = single(agg);
    const now = this.deps.clock();
    if (agg.status !== 'CONFIRMED' || (it.booking.status !== 'CONFIRMED' && it.booking.status !== 'ISSUED') || !it.booking.providerBookingRef) {
      throw new DomainError('ILLEGAL_TRANSITION', 'Only a confirmed booking can be cancelled', { httpStatus: 409 });
    }
    if (it.booking.intent) throw new DomainError('VERSION_CONFLICT', 'A provider call for this order is in flight', { httpStatus: 409, retryable: true });
    const ref = it.booking.providerBookingRef;
    it.booking.preCancelStatus = it.booking.status;
    setBookingStatus(agg, it.id, 'CANCEL_PENDING', 'COMMAND', actor, now);
    // A new request (an earlier one may have been REJECTED, which is final for that request).
    it.booking.cancellation = 'REQUESTED';
    it.booking.intent = { op: 'CANCEL', ...this.lease(now) };
    audit(agg, 'provider_managed.cancel_requested', actor, now, {
      itemId: it.id,
      reason,
      expectedPenalty: context.expectedPenalty ? { currency: context.expectedPenalty.currency, minor: context.expectedPenalty.minor.toString() } : null,
      customerAcceptedFee: context.customerAcceptedFee,
    });
    await this.deps.store.save(agg);

    const outcome = await this.deps.port.cancel(agg, it, ref);
    let result: StaffCancelResult = { outcome: 'UNKNOWN' };
    await this.apply(orderId, (fresh, fi) => {
      fi.booking.intent = null;
      if (outcome.kind === 'SUCCEEDED' && outcome.value.status === 'CANCELLED') {
        this.cancelledAtProvider(fresh, fi, outcome.value.penalty, outcome.value.providerRefund, 'UPSTREAM_RESULT', now, actor, true);
        result = { outcome: 'CANCELLED', penalty: outcome.value.penalty, providerRefund: outcome.value.providerRefund };
        return;
      }
      if (outcome.kind === 'REJECTED' || outcome.kind === 'CAPABILITY_NOT_AVAILABLE') {
        setBookingStatus(fresh, fi.id, fi.booking.preCancelStatus ?? 'CONFIRMED', 'UPSTREAM_RESULT', actor, now);
        setCancellation(fresh, fi.id, 'REJECTED', 'UPSTREAM_RESULT', actor, now);
        const code = outcome.kind === 'REJECTED' ? outcome.code : `CAPABILITY_NOT_AVAILABLE:${outcome.capability}`;
        audit(fresh, 'provider_managed.cancel_rejected', actor, now, { itemId: fi.id, code });
        result = { outcome: 'REJECTED', code };
        return;
      }
      // UNKNOWN (timeout, 5xx, unreadable answer) or a success that does not say CANCELLED.
      setBookingStatus(fresh, fi.id, 'UNKNOWN', 'UPSTREAM_RESULT', actor, now);
      fi.booking.unknownOperation = 'CANCEL';
      fi.booking.lookupAttempts = 0;
      setCancellation(fresh, fi.id, 'UNKNOWN', 'UPSTREAM_RESULT', actor, now);
      raiseTask(fresh, 'CANCELLATION_UNKNOWN', fi.id, 'Cancel answer lost; the booking is being checked automatically (the cancel is not re-sent)', actor, now);
      emit(fresh, 'order.provider_managed.lookup', { orderId: fresh.id }, new Date(now.getTime() + this.deps.policy.finalizeRetrySeconds(1) * 1000));
      result = { outcome: 'UNKNOWN' };
    });
    return result;
  }

  /** Resolves a lost cancellation answer by reading the booking. */
  private async cancelLookup(agg: OrderAggregate, now: Date): Promise<void> {
    const it = single(agg);
    const ref = it.booking.providerBookingRef;
    const outcome: ExternalOutcome<ProviderBookingState> = ref
      ? await this.deps.port.refresh(agg, it, ref)
      : notAvailable('PROVIDER_BOOKING_REF', 'no provider booking id');
    await this.apply(agg.id, (fresh, fi) => {
      if (fi.booking.status !== 'UNKNOWN' || fi.booking.unknownOperation !== 'CANCEL') return;
      if (outcome.kind === 'SUCCEEDED') {
        const st = outcome.value.status;
        if (st === 'CANCELLED') {
          this.cancelledAtProvider(fresh, fi, null, null, 'RECONCILIATION', now, ACTOR, true);
          return;
        }
        if (st === 'CONFIRMED' || st === 'ISSUED') {
          // The cancel did not take effect. It is not re-sent automatically: staff may cancel again.
          setBookingStatus(fresh, fi.id, st, 'RECONCILIATION', ACTOR, now);
          fi.booking.unknownOperation = null;
          fi.booking.lookupAttempts = 0;
          setCancellation(fresh, fi.id, 'REJECTED', 'RECONCILIATION', ACTOR, now);
          audit(fresh, 'provider_managed.cancel_not_applied', ACTOR, now, { itemId: fi.id });
          return;
        }
      }
      fi.booking.lookupAttempts += 1;
      emit(fresh, 'order.provider_managed.lookup', { orderId: fresh.id }, new Date(now.getTime() + this.deps.policy.finalizeRetrySeconds(fi.booking.lookupAttempts + 1) * 1000));
    });
  }

  /**
   * The provider cancelled the booking. The provider collected the customer payment, so the refund is the provider's:
   * we record what it reported and ask a person to confirm the customer refund (not documented for SDK payments).
   */
  private cancelledAtProvider(
    agg: OrderAggregate,
    it: OrderItemState,
    penalty: Money | null,
    providerRefund: Money | null,
    cause: 'UPSTREAM_RESULT' | 'RECONCILIATION',
    now: Date,
    actor: string,
    requestedByUs: boolean,
  ): void {
    if (it.booking.status === 'CONFIRMED' || it.booking.status === 'ISSUED') {
      it.booking.preCancelStatus = it.booking.status;
      setBookingStatus(agg, it.id, 'CANCEL_PENDING', cause, actor, now);
    }
    setBookingStatus(agg, it.id, 'CANCELLED', cause, actor, now);
    it.booking.unknownOperation = null;
    it.booking.voucherReady = false;
    setCancellation(agg, it.id, 'COMPLETED', cause, actor, now);
    const reason = requestedByUs ? 'CANCELLED_BY_STAFF' : 'CANCELLED_AT_PROVIDER';
    setOrderStatus(agg, 'CANCELLED', cause, actor, now, reason);
    agg.compensationReason = reason;
    const fmt = (m: Money | null) => (m ? `${toMajor(m)} ${m.currency}` : 'not reported');
    audit(agg, 'provider_managed.cancelled', actor, now, {
      itemId: it.id,
      requestedByUs,
      penalty: penalty ? { currency: penalty.currency, minor: penalty.minor.toString() } : null,
      providerRefund: providerRefund ? { currency: providerRefund.currency, minor: providerRefund.minor.toString() } : null,
    });
    const refundExpected = providerRefund === null || providerRefund.minor > 0n;
    if (refundExpected) {
      if (providerRefund && agg.payment!.status === 'CAPTURED') setPaymentStatus(agg, 'REFUND_PENDING', cause, actor, now);
      raiseTask(
        agg,
        'REFUND_UNKNOWN',
        it.id,
        `Booking cancelled at Nuitee (${requestedByUs ? 'by us' : 'outside TexHoliday'}). Penalty: ${fmt(penalty)}; refund reported by Nuitee: ${fmt(providerRefund)}. Nuitee collected the payment; an automatic refund to the customer's card is not documented: confirm it, then record it on the order.`,
        actor,
        now,
      );
    }
    emit(agg, 'order.cancelled', { orderId: agg.id, reason, refundExpected });
  }

  /**
   * Records a refund the provider made to the customer, after staff verified it (`orders.record_refund` checked by
   * the caller). Partial refunds add up; the total never exceeds what the customer paid.
   */
  async recordProviderRefund(orderId: string, actor: string, amount: Money, reference: string): Promise<{ paymentStatus: string; refundedTotal: Money }> {
    const ref = reference.trim();
    if (ref.length < 3 || ref.length > 200) throw new DomainError('VALIDATION_FAILED', 'Give where the refund was verified (3-200 characters)', { httpStatus: 422 });
    let out: { paymentStatus: string; refundedTotal: Money } | null = null;
    await this.apply(orderId, (agg) => {
      const p = agg.payment!;
      const now = this.deps.clock();
      if (agg.status !== 'CANCELLED' || !['CAPTURED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(p.status)) {
        throw new DomainError('ILLEGAL_TRANSITION', 'A refund can be recorded only for a cancelled, paid order', { httpStatus: 409 });
      }
      if (amount.currency !== p.amount.currency) throw new DomainError('VALIDATION_FAILED', 'Refund currency must be the payment currency', { httpStatus: 422 });
      if (amount.minor <= 0n) throw new DomainError('VALIDATION_FAILED', 'Refund amount must be positive', { httpStatus: 422 });
      // A double submission (two clicks, two tabs) must not record the same refund twice; a concurrent one reloads
      // the order after the version conflict and lands here.
      if (p.providerRefunds.some((r) => r.amount.minor === amount.minor && r.reference === ref)) {
        throw new DomainError('VALIDATION_FAILED', 'This refund is already recorded', { httpStatus: 422 });
      }
      const before = p.providerRefunds.reduce((acc, r) => add(acc, r.amount), money(p.amount.currency, 0n));
      const total = add(before, amount);
      if (compare(total, p.amount) > 0) throw new DomainError('VALIDATION_FAILED', 'Refunds would exceed the amount paid', { httpStatus: 422 });
      p.providerRefunds.push({ amount, reference: ref, recordedBy: actor, recordedAt: now.toISOString() });
      if (p.status !== 'REFUND_PENDING') setPaymentStatus(agg, 'REFUND_PENDING', 'COMMAND', actor, now);
      setPaymentStatus(agg, compare(total, p.amount) === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED', 'COMMAND', actor, now);
      audit(agg, 'provider_managed.refund_recorded', actor, now, { amount: { currency: amount.currency, minor: amount.minor.toString() }, reference: ref });
      emit(agg, 'order.refund_recorded', { orderId: agg.id, amount: { currency: amount.currency, minor: amount.minor.toString() } });
      out = { paymentStatus: p.status, refundedTotal: total };
    });
    return out!;
  }
}
