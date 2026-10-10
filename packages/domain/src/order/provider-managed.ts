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
  setTicketing,
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
 * - Products differ in when a book may be sent and how a lost answer is found (port.bookTrigger / port.lookupScope):
 *   a flight is booked only after the customer came back from the payment component (the Nuitee sandbox accepted a
 *   flight booking before payment, provider question 11), and its lost answer is found by repeating the book with the
 *   same prebook (documented idempotency, ADR-0011).
 * - A flight PNR is not a ticket (T08): the provider has collected the payment once the booking is confirmed, but the
 *   order is confirmed to the customer only when the ticket is issued (ADR-0012).
 */
export interface ProviderManagedPrebook {
  prebookRef: OpaqueRef;
  transactionId: OpaqueRef;
  /** Short-lived secret for the provider payment component (never our API key). */
  clientSecret: string;
  /** Differences to the accepted quote (price, cancellation, board...). Any difference needs a new acceptance. */
  differences: readonly QuoteDifference[];
}

/** A seat or bag picked by the customer for one passenger (flights, ADR-0013). */
export interface ServiceSelection {
  serviceRef: OpaqueRef;
  /** Zero-based position in the prebook passengers. */
  passengerIndex: number;
  quantity: number;
}

/** The provider payment intent in force for a prebook. */
export interface ProviderPaymentState {
  transactionId: OpaqueRef;
  clientSecret: string;
  amountToCharge: Money;
}

export type AttachServicesResult =
  | { outcome: 'ATTACHED'; amount: Money }
  /** Nothing was attached; the checkout continues unchanged. */
  | { outcome: 'REJECTED'; code: string }
  /** Attached at another amount than the one accepted: the checkout ends before any payment (K15). */
  | { outcome: 'PRICE_CHANGED' }
  /** The outcome could not be established: the checkout ends before any payment. */
  | { outcome: 'FAILED' };

export interface ProviderManagedBookingPort {
  /**
   * When a book call may be sent. ANY_TRIGGER: on the customer's return and on scheduled retries, because the provider
   * refuses a book for an unpaid transaction with a known code (hotels). CUSTOMER_RETURN: only after the customer came
   * back from the payment component; scheduled retries never book (flights, ADR-0012).
   */
  bookTrigger(it: OrderItemState): 'ANY_TRIGGER' | 'CUSTOMER_RETURN';
  /**
   * How a lost book answer is found. PER_REFERENCE: every client reference ever sent is looked up (hotels).
   * PER_PREBOOK: one lookup covers them all, because the provider returns the booking of the prebook whatever reference
   * it was sent with (flights: idempotent book per prebook).
   */
  lookupScope(it: OrderItemState): 'PER_REFERENCE' | 'PER_PREBOOK';
  /**
   * Flights (ADR-0013): attaches seats/bags to the prebook before the payment form is shown. The provider replaces the
   * payment intent, so the answer is the new transaction, its secret and the new amount.
   */
  attachServices?(agg: OrderAggregate, it: OrderItemState, selections: readonly ServiceSelection[]): Promise<ExternalOutcome<ProviderPaymentState>>;
  /** Flights: the prebook's payment intent as the provider holds it now (resolves a lost attach answer). */
  readPayment?(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderPaymentState>>;
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
  /** The provider accepted the request and waits for the airline; the booking is checked automatically. */
  | { outcome: 'PENDING'; penalty: Money | null }
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
  /** A flight booking is confirmed (PNR) but not ticketed yet: read it until the ticket is issued (T08). */
  | { type: 'ISSUANCE_CHECK' }
  /** A cancellation answer was lost or awaits the airline: read the booking by its provider id (never re-send). */
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

/** A cancellation was requested while the flight was waiting for its ticket (the order was never confirmed). */
function awaitingTicketBefore(agg: OrderAggregate, it: OrderItemState): boolean {
  return agg.status === 'PROCESSING' && it.connector.requiresIssuance && it.booking.preCancelStatus === 'CONFIRMED' && it.booking.ticketing !== 'ISSUED';
}

/** A flight with a PNR whose ticket is not issued yet; the order waits (T08). */
export function awaitingTicket(agg: OrderAggregate, it: OrderItemState): boolean {
  return agg.status === 'PROCESSING' && it.connector.requiresIssuance && it.booking.status === 'CONFIRMED' && it.booking.ticketing !== 'ISSUED';
}

/**
 * Pure decision for one provider-managed order. `trigger`: STEP (start), FINALIZE (scheduled or staff), RETURN (the
 * customer came back from the payment component). `bookOnlyOnReturn`: the product is booked on RETURN only.
 */
export function decideProviderManaged(agg: OrderAggregate, now: Date, trigger: 'STEP' | 'FINALIZE' | 'RETURN', bookOnlyOnReturn = false): ProviderManagedAction {
  const it = single(agg);
  const p = agg.payment!;
  if (agg.status === 'CANCELLED') return { type: 'NONE', reason: 'order settled' };
  const intent = it.booking.intent;
  if (intent) return new Date(intent.leaseUntil).getTime() <= now.getTime() ? { type: 'INTENT_EXPIRED' } : { type: 'NONE', reason: 'call in flight' };
  if ((it.booking.status === 'UNKNOWN' && it.booking.unknownOperation === 'CANCEL') || it.booking.status === 'CANCEL_PENDING') return { type: 'CANCEL_LOOKUP' };
  if (agg.status === 'CONFIRMED') return { type: 'NONE', reason: 'order settled' };
  if (it.booking.status === 'UNKNOWN' || it.booking.status === 'PENDING_CONFIRMATION') return { type: 'LOOKUP' };
  if (awaitingTicket(agg, it)) return it.booking.ticketing === 'PENDING' || it.booking.ticketing === 'UNKNOWN' ? { type: 'ISSUANCE_CHECK' } : { type: 'NONE', reason: `ticketing ${it.booking.ticketing}` };
  if (it.booking.status === 'NEW' && p.status === 'NEW') return { type: 'PREBOOK' };
  if (it.booking.status === 'PREPARED' && p.status === 'PENDING') {
    const expired = p.payBy !== null && new Date(p.payBy).getTime() <= now.getTime();
    if (expired) return { type: 'EXPIRE' };
    if (trigger === 'RETURN' || (trigger === 'FINALIZE' && !bookOnlyOnReturn)) return { type: 'FINALIZE' };
    return { type: 'NONE', reason: 'waiting for the customer payment' };
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
   * Tries to finalize from the worker sweep, a staff check or after the deadline (abandon). The caller's request
   * carries no ids: the stored prebook/transaction is used. `attempt` (from the scheduled event) drives the retry
   * back-off while the customer has not paid yet. Products booked on the customer's return only are not booked here.
   */
  async finalize(orderId: string, attempt = 1): Promise<ProviderManagedAction> {
    return this.run(orderId, 'FINALIZE', attempt);
  }

  /** The customer came back from the payment component (a trigger only: nothing from the URL is used). */
  async customerReturned(orderId: string): Promise<ProviderManagedAction> {
    return this.run(orderId, 'RETURN', 1);
  }

  private async run(orderId: string, trigger: 'STEP' | 'FINALIZE' | 'RETURN', attempt = 1): Promise<ProviderManagedAction> {
    const agg = await this.deps.store.load(orderId);
    const now = this.deps.clock();
    const action = decideProviderManaged(agg, now, trigger, this.deps.port.bookTrigger(single(agg)) === 'CUSTOMER_RETURN');
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
        case 'ISSUANCE_CHECK':
          await this.issuanceCheck(agg, now);
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
    const payBy = agg.payment?.payBy ? new Date(agg.payment.payBy).getTime() : Number.POSITIVE_INFINITY;
    if (this.deps.port.bookTrigger(single(agg)) === 'CUSTOMER_RETURN' && Number.isFinite(payBy)) {
      // Booked on the customer's return only: the one scheduled step is closing the checkout at the deadline.
      emit(agg, 'order.provider_managed.finalize', { orderId: agg.id, attempt }, new Date(payBy));
      return;
    }
    const delay = this.deps.policy.finalizeRetrySeconds(attempt);
    // Never later than the deadline, so an abandoned checkout is closed on time.
    const at = Math.min(now.getTime() + delay * 1000, payBy);
    emit(agg, 'order.provider_managed.finalize', { orderId: agg.id, attempt }, new Date(at));
  }

  private scheduleLookup(agg: OrderAggregate, now: Date, attempt: number): void {
    emit(agg, 'order.provider_managed.lookup', { orderId: agg.id }, new Date(now.getTime() + this.deps.policy.finalizeRetrySeconds(attempt) * 1000));
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
    if (it.connector.requiresIssuance) {
      it.booking.pnr = state.pnr ?? it.booking.pnr;
      if (state.ticketNumbers.length > 0) it.booking.ticketNumbers = state.ticketNumbers;
    }
    if (target === 'CONFIRMED' || target === 'ISSUED') {
      const firstConfirmation = it.booking.status !== 'CONFIRMED' && it.booking.status !== 'ISSUED';
      if (firstConfirmation) {
        // UNKNOWN may go straight to ISSUED; every other state passes CONFIRMED (a PNR before its ticket).
        setBookingStatus(agg, it.id, it.connector.requiresIssuance || it.booking.status !== 'UNKNOWN' ? 'CONFIRMED' : target, cause, ACTOR, now);
      }
      // The provider collected the customer payment when it confirmed the booking (it is the merchant of record).
      setPaymentStatus(agg, 'CAPTURED', cause, ACTOR, now);
      agg.payment!.providerClientSecret = null;
      if (it.connector.requiresIssuance) {
        // T08: only an issued ticket confirms a flight (ticketedAt, ADR-0011); a PNR keeps the order processing.
        const issued = target === 'ISSUED' || state.ticketingStatus === 'ISSUED';
        if (!issued) {
          if (firstConfirmation) audit(agg, 'provider_managed.awaiting_ticket', ACTOR, now, { itemId: it.id, pnr: it.booking.pnr });
          this.scheduleLookup(agg, now, it.booking.lookupAttempts + 1);
          return;
        }
        setBookingStatus(agg, it.id, 'ISSUED', cause, ACTOR, now);
        setTicketing(agg, it.id, 'ISSUED', cause, ACTOR, now);
        it.booking.lookupAttempts = 0;
      } else if (target !== it.booking.status) {
        setBookingStatus(agg, it.id, target, cause, ACTOR, now);
      }
      setOrderStatus(agg, 'CONFIRMED', cause, ACTOR, now, 'PROVIDER_MANAGED_BOOKED');
      emit(agg, 'order.confirmed', { orderId: agg.id });
      return;
    }
    if (target === 'FAILED' || target === 'CANCELLED') {
      this.fail(agg, it, `PROVIDER_${target}`, cause, now, true);
      return;
    }
    if (target === 'CANCEL_PENDING') {
      // A cancellation we never asked for, on a booking we did not hold as confirmed: a person looks at it.
      raiseTask(agg, 'BOOKING_UNKNOWN', it.id, 'Provider reports a pending cancellation on a booking that was never confirmed to us', ACTOR, now);
      this.scheduleLookup(agg, now, it.booking.lookupAttempts + 1);
      return;
    }
    // A pending provider confirmation is not a confirmation (T10): keep reading the booking.
    setBookingStatus(agg, it.id, target, cause, ACTOR, now);
    this.scheduleLookup(agg, now, 1);
  }

  /**
   * Reads a flight booking that has a PNR but no ticket yet. Issued -> the order is confirmed; cancelled by the airline
   * or the provider -> the provider refunds by its rules (a person confirms); still waiting -> read again with back-off,
   * and after the automatic budget a person is asked (TICKETING_DELAYED) while reading continues.
   */
  private async issuanceCheck(agg: OrderAggregate, now: Date): Promise<void> {
    const it = single(agg);
    const ref = it.booking.providerBookingRef;
    const outcome: ExternalOutcome<ProviderBookingState> = ref ? await this.deps.port.refresh(agg, it, ref) : notAvailable('PROVIDER_BOOKING_REF', 'no provider booking id');
    await this.apply(agg.id, (fresh, fi) => {
      if (!awaitingTicket(fresh, fi) || fi.booking.intent) return; // changed meanwhile
      if (outcome.kind === 'SUCCEEDED') {
        const st = outcome.value;
        if (st.status === 'ISSUED' || (st.status === 'CONFIRMED' && st.ticketingStatus === 'ISSUED')) {
          this.applyBooked(fresh, fi, st, 'RECONCILIATION', now);
          return;
        }
        if (st.status === 'CANCELLED') {
          this.cancelledAtProvider(fresh, fi, null, null, 'RECONCILIATION', now, ACTOR, false);
          return;
        }
        if (st.status !== 'CONFIRMED') {
          raiseTask(fresh, 'BOOKING_UNKNOWN', fi.id, `Provider reports ${st.status} for a booking awaiting its ticket`, ACTOR, now);
        } else {
          fi.booking.pnr = st.pnr ?? fi.booking.pnr;
        }
      }
      fi.booking.lookupAttempts += 1;
      if (fi.booking.lookupAttempts >= this.deps.policy.maxAutomaticLookups) {
        raiseTask(fresh, 'TICKETING_DELAYED', fi.id, 'Flight booked and paid, ticket not issued yet after automatic checks (checking continues)', ACTOR, now);
      }
      this.scheduleLookup(fresh, now, fi.booking.lookupAttempts + 1);
    });
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
    const all = sentReferences(it);
    const refs = !abandonIfMissing && it.booking.clientReference ? [it.booking.clientReference] : this.deps.port.lookupScope(it) === 'PER_PREBOOK' ? all.slice(0, 1) : all;
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
      this.scheduleLookup(fresh, now, fi.booking.lookupAttempts + 1);
    });
  }

  private async expire(agg: OrderAggregate, now: Date): Promise<void> {
    const it = single(agg);
    if (sentReferences(it).length > 0) {
      // A book call was sent before: make sure no booking exists under any reference before abandoning (T19).
      await this.lookup(agg, now, true);
      return;
    }
    // Booked on the customer's return only: a customer who was shown the payment form, paid and never came back may
    // hold a payment authorization (the provider releases it); without the form no money is involved.
    const mayHold = this.deps.port.bookTrigger(it) === 'CUSTOMER_RETURN' && agg.payment!.providerSecretIssuedAt !== null;
    await this.apply(agg.id, (fresh, fi) => this.fail(fresh, fi, 'CHECKOUT_EXPIRED', 'COMMAND', now, mayHold));
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
      if (op === 'SERVICES') {
        // Which payment intent is in force is unknown, and no payment form was shown yet: the checkout stops.
        this.fail(fresh, fi, 'SERVICES_UNCONFIRMED', 'UPSTREAM_RESULT', now, false);
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

  // ------------------------------------------------------------------ payment form and services (ADR-0013)

  /**
   * The client secret for the customer's browser, while the payment is open. The first hand-out is recorded: from then
   * on the customer may pay, so the payment intent must not change any more (no services after it).
   */
  async issuePaymentSecret(orderId: string): Promise<string | null> {
    let secret: string | null = null;
    await this.apply(orderId, (fresh, fi) => {
      const p = fresh.payment!;
      secret = null;
      if (fresh.status !== 'PROCESSING' || p.status !== 'PENDING' || fi.booking.status !== 'PREPARED' || fi.booking.intent || !p.providerClientSecret) return;
      if (!p.providerSecretIssuedAt) {
        const now = this.deps.clock();
        p.providerSecretIssuedAt = now.toISOString();
        audit(fresh, 'provider_managed.payment_form_opened', 'customer', now, { itemId: fi.id });
      }
      secret = p.providerClientSecret;
    });
    return secret;
  }

  /**
   * Attaches seats/bags the customer chose (and accepted at `expectedCharge`, quote `quoteVersionId`) before any payment
   * form was shown. The intent is stored before the call; a lost answer is resolved by reading the prebook, never by
   * attaching again. The new payment intent replaces the old one only when the provider charges exactly the accepted
   * amount; otherwise the checkout ends before any payment.
   */
  async attachServices(
    orderId: string,
    request: { quoteVersionId: string; expectedCharge: Money; supplierCost: Money; selections: readonly ServiceSelection[] },
    actor: string,
  ): Promise<AttachServicesResult> {
    const agg = await this.deps.store.load(orderId);
    const it = single(agg);
    const now = this.deps.clock();
    const p = agg.payment!;
    const port = this.deps.port;
    if (!port.attachServices || !port.readPayment) throw new DomainError('CAPABILITY_NOT_AVAILABLE', 'Services cannot be added to this booking', { httpStatus: 422 });
    const open = agg.status === 'PROCESSING' && it.booking.status === 'PREPARED' && p.status === 'PENDING' && p.providerTransaction !== null && !p.providerSecretIssuedAt;
    const expired = p.payBy !== null && new Date(p.payBy).getTime() <= now.getTime();
    if (!open || expired) throw new DomainError('ILLEGAL_TRANSITION', 'Services can only be added before payment', { httpStatus: 409 });
    if (it.booking.intent) throw new DomainError('VERSION_CONFLICT', 'A provider call for this order is in flight', { httpStatus: 409, retryable: true });
    if (request.expectedCharge.currency !== p.amount.currency || request.selections.length === 0) {
      throw new DomainError('VALIDATION_FAILED', 'Services must be priced in the payment currency', { httpStatus: 422 });
    }
    const before = p.providerTransaction!.transactionId;
    it.booking.intent = { op: 'SERVICES', ...this.lease(now) };
    audit(agg, 'provider_managed.services_requested', actor, now, {
      itemId: it.id,
      count: request.selections.length,
      expectedCharge: { currency: request.expectedCharge.currency, minor: request.expectedCharge.minor.toString() },
    });
    await this.deps.store.save(agg);

    let outcome = await port.attachServices(agg, it, request.selections);
    // A lost answer is read back; from then on only a successful read can tell what is in force.
    const lost = outcome.kind === 'UNKNOWN';
    if (lost) outcome = await port.readPayment(agg, it);
    let result: AttachServicesResult = { outcome: 'FAILED' };
    await this.apply(orderId, (fresh, fi) => {
      fi.booking.intent = null;
      const fp = fresh.payment!;
      if (!lost && (outcome.kind === 'REJECTED' || outcome.kind === 'CAPABILITY_NOT_AVAILABLE')) {
        const code = outcome.kind === 'REJECTED' ? outcome.code : `CAPABILITY_NOT_AVAILABLE:${outcome.capability}`;
        audit(fresh, 'provider_managed.services_rejected', actor, now, { itemId: fi.id, code });
        result = { outcome: 'REJECTED', code };
        return;
      }
      if (outcome.kind !== 'SUCCEEDED') {
        this.fail(fresh, fi, 'SERVICES_UNCONFIRMED', 'UPSTREAM_RESULT', now, false);
        result = { outcome: 'FAILED' };
        return;
      }
      const v = outcome.value;
      if (v.transactionId === before) {
        if (v.amountToCharge.currency !== fp.amount.currency || v.amountToCharge.minor !== fp.amount.minor) {
          // Same intent at another amount: not what the provider documents; which amount the form would charge is unclear.
          this.fail(fresh, fi, 'SERVICES_UNCONFIRMED', 'UPSTREAM_RESULT', now, false);
          result = { outcome: 'FAILED' };
          return;
        }
        // Unchanged: nothing was attached; the current payment intent stays.
        audit(fresh, 'provider_managed.services_rejected', actor, now, { itemId: fi.id, code: 'NOT_ATTACHED' });
        result = { outcome: 'REJECTED', code: 'NOT_ATTACHED' };
        return;
      }
      if (v.amountToCharge.currency !== request.expectedCharge.currency || v.amountToCharge.minor !== request.expectedCharge.minor) {
        // K15: a different amount needs a new acceptance; the new intent is never shown (no money involved).
        this.fail(fresh, fi, 'QUOTE_CHANGED:CHARGE_AMOUNT', 'UPSTREAM_RESULT', now, false);
        emit(fresh, 'order.quote_changed', { orderId: fresh.id, differences: ['CHARGE_AMOUNT'] });
        result = { outcome: 'PRICE_CHANGED' };
        return;
      }
      fp.providerTransaction = { prebookRef: fp.providerTransaction!.prebookRef, transactionId: v.transactionId };
      fp.providerClientSecret = v.clientSecret;
      fp.amount = v.amountToCharge;
      fresh.chargeTotal = v.amountToCharge;
      fi.chargeAllocation = v.amountToCharge;
      fi.supplierCost = request.supplierCost;
      fi.quoteVersionId = request.quoteVersionId;
      audit(fresh, 'provider_managed.services_attached', actor, now, {
        itemId: fi.id,
        quoteVersionId: request.quoteVersionId,
        amount: { currency: v.amountToCharge.currency, minor: v.amountToCharge.minor.toString() },
        transactionId: v.transactionId,
      });
      result = { outcome: 'ATTACHED', amount: v.amountToCharge };
    });
    return result;
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
    if (agg.status === 'CONFIRMED' && (it.booking.status === 'CONFIRMED' || it.booking.status === 'ISSUED') && it.booking.providerBookingRef && !it.booking.intent) {
      answered = await this.verifyBooked(agg, now, actor);
    } else {
      const action = decideProviderManaged(agg, now, 'FINALIZE', this.deps.port.bookTrigger(it) === 'CUSTOMER_RETURN');
      if (action.type !== 'PREBOOK') {
        const lookupsBefore = it.booking.lookupAttempts;
        await this.run(orderId, 'FINALIZE', 1);
        const after = await this.deps.store.load(orderId);
        answered = !((single(after).booking.status === 'UNKNOWN' || awaitingTicket(after, single(after))) && single(after).booking.lookupAttempts > lookupsBefore);
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
   * Cancels a confirmed booking at the provider (staff command, `orders.cancel` checked by the caller), also a paid
   * flight still waiting for its ticket. The intent is stored before the call; a lost answer is resolved by reading the
   * booking, never by sending the cancel again. A cancellation the airline still has to confirm is read until final.
   * A cancellation the customer asked for on the site (`requestedByCustomer`) that the provider refuses opens a task, so
   * someone contacts the customer.
   */
  async cancel(
    orderId: string,
    actor: string,
    reason: string,
    context: { expectedPenalty: Money | null; customerAcceptedFee: boolean; requestedByCustomer?: boolean } = { expectedPenalty: null, customerAcceptedFee: false },
  ): Promise<StaffCancelResult> {
    const agg = await this.deps.store.load(orderId);
    const it = single(agg);
    const now = this.deps.clock();
    const confirmed = agg.status === 'CONFIRMED' && (it.booking.status === 'CONFIRMED' || it.booking.status === 'ISSUED');
    if ((!confirmed && !awaitingTicket(agg, it)) || !it.booking.providerBookingRef) {
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
      requestedByCustomer: context.requestedByCustomer === true,
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
      if (outcome.kind === 'SUCCEEDED' && outcome.value.status === 'CANCEL_PENDING') {
        // Accepted, the airline has not confirmed yet (flights, HTTP 202): read the booking until it is final.
        setCancellation(fresh, fi.id, 'PROVIDER_PENDING', 'UPSTREAM_RESULT', actor, now);
        fi.booking.lookupAttempts = 0;
        const penalty = outcome.value.penalty;
        audit(fresh, 'provider_managed.cancel_pending', actor, now, { itemId: fi.id, estimatedPenalty: penalty ? { currency: penalty.currency, minor: penalty.minor.toString() } : null });
        this.scheduleLookup(fresh, now, 1);
        result = { outcome: 'PENDING', penalty };
        return;
      }
      if (outcome.kind === 'REJECTED' || outcome.kind === 'CAPABILITY_NOT_AVAILABLE') {
        setBookingStatus(fresh, fi.id, fi.booking.preCancelStatus ?? 'CONFIRMED', 'UPSTREAM_RESULT', actor, now);
        setCancellation(fresh, fi.id, 'REJECTED', 'UPSTREAM_RESULT', actor, now);
        const code = outcome.kind === 'REJECTED' ? outcome.code : `CAPABILITY_NOT_AVAILABLE:${outcome.capability}`;
        audit(fresh, 'provider_managed.cancel_rejected', actor, now, { itemId: fi.id, code });
        if (context.requestedByCustomer) raiseTask(fresh, 'CUSTOMER_CANCEL_REJECTED', fi.id, `The customer cancelled on the site; the provider refused (${code}). The booking stands.`, actor, now);
        // A flight still waiting for its ticket goes on being read.
        if (awaitingTicket(fresh, fi)) this.scheduleLookup(fresh, now, 1);
        result = { outcome: 'REJECTED', code };
        return;
      }
      // UNKNOWN (timeout, 5xx, unreadable answer) or a success that does not say CANCELLED.
      setBookingStatus(fresh, fi.id, 'UNKNOWN', 'UPSTREAM_RESULT', actor, now);
      fi.booking.unknownOperation = 'CANCEL';
      fi.booking.lookupAttempts = 0;
      setCancellation(fresh, fi.id, 'UNKNOWN', 'UPSTREAM_RESULT', actor, now);
      raiseTask(fresh, 'CANCELLATION_UNKNOWN', fi.id, 'Cancel answer lost; the booking is being checked automatically (the cancel is not re-sent)', actor, now);
      this.scheduleLookup(fresh, now, 1);
      result = { outcome: 'UNKNOWN' };
    });
    return result;
  }

  /** Resolves a lost or pending cancellation by reading the booking. */
  private async cancelLookup(agg: OrderAggregate, now: Date): Promise<void> {
    const it = single(agg);
    const ref = it.booking.providerBookingRef;
    const outcome: ExternalOutcome<ProviderBookingState> = ref
      ? await this.deps.port.refresh(agg, it, ref)
      : notAvailable('PROVIDER_BOOKING_REF', 'no provider booking id');
    await this.apply(agg.id, (fresh, fi) => {
      const lost = fi.booking.status === 'UNKNOWN' && fi.booking.unknownOperation === 'CANCEL';
      if ((!lost && fi.booking.status !== 'CANCEL_PENDING') || fi.booking.intent) return;
      if (outcome.kind === 'SUCCEEDED') {
        const st = outcome.value.status;
        if (st === 'CANCELLED') {
          this.cancelledAtProvider(fresh, fi, null, null, 'RECONCILIATION', now, ACTOR, true);
          return;
        }
        if (st === 'CONFIRMED' || st === 'ISSUED') {
          // The cancel did not take effect. It is not re-sent automatically: staff may cancel again. A flight that
          // was waiting for its ticket goes back to waiting (its issuance is read again).
          const back = awaitingTicketBefore(fresh, fi) ? 'CONFIRMED' : st;
          setBookingStatus(fresh, fi.id, back, 'RECONCILIATION', ACTOR, now);
          fi.booking.unknownOperation = null;
          fi.booking.lookupAttempts = 0;
          setCancellation(fresh, fi.id, 'REJECTED', 'RECONCILIATION', ACTOR, now);
          audit(fresh, 'provider_managed.cancel_not_applied', ACTOR, now, { itemId: fi.id });
          if (awaitingTicket(fresh, fi)) this.scheduleLookup(fresh, now, 1);
          return;
        }
        if (st === 'CANCEL_PENDING' && lost) {
          // The lost answer was an accepted request: the airline still has to confirm.
          setBookingStatus(fresh, fi.id, 'CANCEL_PENDING', 'RECONCILIATION', ACTOR, now);
          fi.booking.unknownOperation = null;
          setCancellation(fresh, fi.id, 'PROVIDER_PENDING', 'RECONCILIATION', ACTOR, now);
        }
      }
      fi.booking.lookupAttempts += 1;
      if (fi.booking.lookupAttempts >= this.deps.policy.maxAutomaticLookups) {
        raiseTask(fresh, 'CANCELLATION_UNKNOWN', fi.id, 'Cancellation not final at the provider after automatic checks (checking continues)', ACTOR, now);
      }
      this.scheduleLookup(fresh, now, fi.booking.lookupAttempts + 1);
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
