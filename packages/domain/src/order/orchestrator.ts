import {
  VersionConflictError,
  type ExternalOutcome,
  type GatewayPaymentRef,
  type GatewayPaymentSnapshot,
  type OpaqueRef,
  type OwnedPaymentGateway,
  type ProviderBookingState,
} from '@texholiday/contracts';
import { add, equals, money, type Money } from '@texholiday/pricing';
import type { QuoteDifference } from '../quote';
import { bookingMachine, paymentMachine, type BookingStatus, type PaymentStatus } from '../state/machines';
import {
  audit,
  emit,
  item,
  raiseTask,
  setBookingStatus,
  setCancellation,
  setOrderStatus,
  setPaymentStatus,
  setTicketing,
  type BookingOperation,
  type OrderAggregate,
  type OrderItemState,
  type PaymentOperation,
} from './aggregate';
import { decideNextAction, type NextAction, type OrchestrationPolicy } from './decide';

/** Persistence port. save() is atomic with pendingEvents/pendingAudit and checks the version. */
export interface OrderStore {
  load(orderId: string): Promise<OrderAggregate>;
  /** Persists the aggregate if the stored version equals agg.version; returns the new version. */
  save(agg: OrderAggregate): Promise<number>;
}

export interface PrebookResult {
  prebookRef: OpaqueRef;
  expiresAt: string | null;
  /** True only when the connector documents a real inventory hold. */
  inventoryHeld: boolean;
  /** Differences between the fresh offer and the accepted quote version. */
  differences: readonly QuoteDifference[];
}

/** Product-specific booking calls for one order item, built from stored quote/traveler data. */
export interface ItemBookingPort {
  prebook(agg: OrderAggregate, it: OrderItemState, clientReference: string): Promise<ExternalOutcome<PrebookResult>>;
  book(agg: OrderAggregate, it: OrderItemState, clientReference: string): Promise<ExternalOutcome<ProviderBookingState>>;
  /** Resolves a lost response using the documented mechanism (client reference lookup). */
  lookup(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderBookingState | null>>;
  refresh(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderBookingState>>;
  cancel(agg: OrderAggregate, it: OrderItemState): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null }>>;
}

export interface OrchestratorDeps {
  store: OrderStore;
  gateway(gatewayId: string): OwnedPaymentGateway;
  bookings(it: OrderItemState): ItemBookingPort;
  clock(): Date;
  workerId: string;
  /** Server egress IP sent to the gateway for capture/void (never the customer's card data). */
  serverIp: string;
  policy: OrchestrationPolicy;
}

export interface StepResult {
  action: NextAction;
  progressed: boolean;
  /** True when the step queued an immediate follow-up (vs. a delayed reconciliation or a wait). */
  continueNow: boolean;
}

const ACTOR = 'system:orchestrator';

function gatewayRef(agg: OrderAggregate): GatewayPaymentRef {
  const p = agg.payment;
  if (!p?.gatewayPaymentId) throw new Error(`Order ${agg.id}: no gateway payment id`);
  return { __brand: 'GatewayPaymentRef', gatewayId: p.gatewayId, gatewayPaymentId: p.gatewayPaymentId, environment: agg.environment };
}

function bookingStatusFromProvider(state: ProviderBookingState): BookingStatus {
  switch (state.status) {
    case 'PREPARED':
    case 'HELD':
    case 'PENDING_CONFIRMATION':
    case 'CONFIRMED':
    case 'ISSUED':
    case 'CANCEL_PENDING':
    case 'CANCELLED':
    case 'FAILED':
      return state.status;
  }
}

/**
 * Executes one decided step. Every side-effecting call is preceded by a saved intent (version-checked),
 * so two workers can never both send it (T17), and a crash leaves an intent that expires into UNKNOWN.
 */
export class PackageOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async step(orderId: string): Promise<StepResult> {
    const agg = await this.deps.store.load(orderId);
    const now = this.deps.clock();
    const action = decideNextAction(agg, now, this.deps.policy);
    this.continueNow = false;
    try {
      const progressed = await this.execute(agg, action, now);
      return { action, progressed, continueNow: progressed && this.continueNow };
    } catch (err) {
      if (err instanceof VersionConflictError) return { action, progressed: false, continueNow: false };
      throw err;
    }
  }

  /**
   * Server-side payment reconciliation, triggered by a browser return, a verified webhook or a sweeper.
   * The trigger itself proves nothing (T13): only the gateway's retrieve result changes the payment state.
   */
  async reconcilePayment(orderId: string): Promise<boolean> {
    const agg = await this.deps.store.load(orderId);
    if (!agg.payment || agg.payment.intent) return false;
    this.continueNow = false;
    try {
      return await this.retrievePayment(agg, this.deps.clock());
    } catch (err) {
      if (err instanceof VersionConflictError) return false;
      throw err;
    }
  }

  /** Runs steps until the order waits or is done (bounded). Used by the worker and tests. */
  async drive(orderId: string, maxSteps = 50): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (let i = 0; i < maxSteps; i += 1) {
      const r = await this.step(orderId);
      results.push(r);
      if (!r.continueNow) break;
    }
    return results;
  }

  private continueNow = false;

  private advanceLater(agg: OrderAggregate, now: Date, attempt: number): void {
    const delay = this.deps.policy.reconcileDelaySeconds(attempt);
    emit(agg, 'order.advance', { orderId: agg.id }, new Date(now.getTime() + delay * 1000));
    this.continueNow = false;
  }

  private advanceNow(agg: OrderAggregate): void {
    emit(agg, 'order.advance', { orderId: agg.id });
    this.continueNow = true;
  }

  private lease(now: Date) {
    return {
      startedAt: now.toISOString(),
      leaseUntil: new Date(now.getTime() + this.deps.policy.intentLeaseSeconds * 1000).toISOString(),
      workerId: this.deps.workerId,
    };
  }

  /**
   * Saves the result of an external call. If another worker changed the order meanwhile (e.g. it expired
   * our lease into UNKNOWN), reload and apply the result again as reconciliation evidence.
   */
  private async applyResult(orderId: string, apply: (agg: OrderAggregate, reconciling: boolean) => void): Promise<void> {
    let agg = await this.deps.store.load(orderId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      apply(agg, attempt > 0);
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

  private async execute(agg: OrderAggregate, action: NextAction, now: Date): Promise<boolean> {
    switch (action.type) {
      case 'DONE':
      case 'WAIT':
        return false;

      case 'EXPIRE_INTENT': {
        if (action.target === 'BOOKING') {
          const it = item(agg, action.itemId);
          const op = it.booking.intent?.op as BookingOperation;
          setBookingStatus(agg, it.id, 'UNKNOWN', 'UPSTREAM_RESULT', ACTOR, now);
          it.booking.unknownOperation = op;
          it.booking.intent = null;
          raiseTask(agg, op === 'CANCEL' ? 'CANCELLATION_UNKNOWN' : 'BOOKING_UNKNOWN', it.id, `Lease expired during ${op}`, ACTOR, now);
        } else {
          const p = agg.payment!;
          p.unknownOperation = p.intent?.op ?? null;
          setPaymentStatus(agg, 'UNKNOWN', 'UPSTREAM_RESULT', ACTOR, now);
          p.intent = null;
          raiseTask(agg, 'PAYMENT_UNKNOWN', null, 'Lease expired during payment call', ACTOR, now);
        }
        this.advanceNow(agg);
        await this.deps.store.save(agg);
        return true;
      }

      case 'RETRIEVE_PAYMENT':
        return this.retrievePayment(agg, now);

      case 'LOOKUP_BOOKING':
        return this.lookupBooking(agg, action.itemId, now);

      case 'REFRESH_BOOKING':
        return this.refreshBooking(agg, action.itemId, now);

      case 'PREBOOK':
        return this.prebook(agg, action.itemId, now);

      case 'BOOK':
        return this.book(agg, action.itemId, now);

      case 'CANCEL_BOOKING':
        return this.cancelBooking(agg, action.itemId, now);

      case 'DISCARD_PREPARED':
        setBookingStatus(agg, action.itemId, 'CANCELLED', 'COMMAND', ACTOR, now);
        this.advanceNow(agg);
        await this.deps.store.save(agg);
        return true;

      case 'CAPTURE':
        return this.paymentCall(agg, 'CAPTURE', now);

      case 'VOID':
        return this.paymentCall(agg, 'VOID', now);

      case 'START_COMPENSATION':
        agg.compensationReason = action.reason;
        setOrderStatus(agg, 'COMPENSATING', 'COMMAND', ACTOR, now, action.reason);
        this.advanceNow(agg);
        await this.deps.store.save(agg);
        return true;

      case 'MARK_ORDER_CONFIRMED':
        setOrderStatus(agg, 'CONFIRMED', 'COMMAND', ACTOR, now, 'ALL_ITEMS_FINAL_AND_CAPTURED');
        emit(agg, 'order.confirmed', { orderId: agg.id });
        await this.deps.store.save(agg);
        return true;

      case 'MARK_ORDER_CANCELLED':
        setOrderStatus(agg, 'CANCELLED', 'COMMAND', ACTOR, now, action.reason);
        await this.deps.store.save(agg);
        return true;

      case 'RAISE_ACTION_REQUIRED':
        raiseTask(agg, action.reason, action.itemId, action.detail, ACTOR, now);
        setOrderStatus(agg, 'ACTION_REQUIRED', 'COMMAND', ACTOR, now, action.reason);
        await this.deps.store.save(agg);
        return true;

      case 'RAISE_TASK': {
        const opened = raiseTask(agg, action.reason, action.itemId, action.detail, ACTOR, now);
        if (opened) await this.deps.store.save(agg);
        return false;
      }
    }
  }

  // ---------------------------------------------------------------- payment

  private applySnapshot(agg: OrderAggregate, snap: GatewayPaymentSnapshot, now: Date): void {
    const p = agg.payment!;
    const matches =
      snap.signatureVerified &&
      equals(snap.amount, p.amount) &&
      (snap.paymentAttemptId === null || snap.paymentAttemptId === p.id) &&
      (snap.orderId === null || snap.orderId === agg.id) &&
      snap.ref.environment === agg.environment;
    if (!matches) {
      p.mismatch = true;
      raiseTask(agg, 'PAYMENT_MISMATCH', null, 'Gateway payment does not match the order (amount/currency/ids/environment)', ACTOR, now);
    }
    p.gatewayPaymentId = snap.ref.gatewayPaymentId;
    p.fraud = snap.fraud;
    p.itemTransactions = snap.itemTransactions;
    const mapped: PaymentStatus = snap.status === 'AUTHORIZED' && snap.fraud === 'REVIEW' ? 'FRAUD_REVIEW' : snap.status;
    if (mapped !== p.status && !paymentMachine.canTransition(p.status, mapped, 'RECONCILIATION')) {
      // A stale snapshot (e.g. delayed/out-of-order notification) never moves the payment backwards (T18).
      audit(agg, 'payment.stale_snapshot_ignored', ACTOR, now, { current: p.status, reported: mapped });
      return;
    }
    setPaymentStatus(agg, mapped, 'RECONCILIATION', ACTOR, now);
    if ((mapped === 'AUTHORIZED' || mapped === 'FRAUD_REVIEW') && !p.authorizationExpiresAt) {
      const validity = this.deps.gateway(p.gatewayId).capabilities().authorizationValiditySeconds;
      // Conservative: counted from attempt creation, the earliest moment the authorization could exist.
      if (validity !== null) p.authorizationExpiresAt = new Date(new Date(p.createdAt).getTime() + validity * 1000).toISOString();
      else raiseTask(agg, 'AUTHORIZATION_EXPIRING', null, 'Gateway does not document an authorization lifetime; monitor manually', ACTOR, now);
    }
  }

  private async retrievePayment(agg: OrderAggregate, now: Date): Promise<boolean> {
    const p = agg.payment!;
    const gw = this.deps.gateway(p.gatewayId);
    const outcome = await gw.retrieve({ paymentAttemptId: p.id, sessionRef: p.sessionRef ?? undefined, ref: p.gatewayPaymentId ? gatewayRef(agg) : undefined });
    await this.applyResult(agg.id, (fresh) => {
      const fp = fresh.payment!;
      if (outcome.kind !== 'SUCCEEDED') {
        raiseTask(fresh, 'PAYMENT_UNKNOWN', null, `Payment retrieve: ${outcome.kind}`, ACTOR, now);
        this.advanceLater(fresh, now, 1);
        return;
      }
      const wasUnknownCapture = fp.status === 'UNKNOWN' && fp.unknownOperation === 'CAPTURE';
      this.applySnapshot(fresh, outcome.value, now);
      if (fp.status !== 'UNKNOWN') fp.unknownOperation = null;
      if (wasUnknownCapture && fp.status === 'AUTHORIZED') {
        // The first capture may still be processing upstream: a person decides before any new capture.
        raiseTask(fresh, 'PAYMENT_UNKNOWN', null, 'Capture outcome was unknown and retrieve still shows AUTHORIZED', ACTOR, now);
        if (fresh.status === 'PROCESSING') setOrderStatus(fresh, 'ACTION_REQUIRED', 'COMMAND', ACTOR, now, 'CAPTURE_OUTCOME_AMBIGUOUS');
        return;
      }
      this.advanceNow(fresh);
    });
    return true;
  }

  private async paymentCall(agg: OrderAggregate, op: PaymentOperation, now: Date): Promise<boolean> {
    const p = agg.payment!;
    p.intent = { op, ...this.lease(now) };
    setPaymentStatus(agg, op === 'CAPTURE' ? 'CAPTURE_PENDING' : 'VOID_PENDING', 'COMMAND', ACTOR, now);
    await this.deps.store.save(agg); // VersionConflictError here = another worker owns this step.

    const gw = this.deps.gateway(p.gatewayId);
    const ref = gatewayRef(agg);
    const outcome: ExternalOutcome<unknown> =
      op === 'CAPTURE'
        ? await gw.capture({ ref, amount: p.amount, paymentAttemptId: p.id, ip: this.deps.serverIp })
        : await gw.void({ ref, paymentAttemptId: p.id, ip: this.deps.serverIp, reason: 'OTHER' });

    await this.applyResult(agg.id, (fresh, reconciling) => {
      const fp = fresh.payment!;
      const cause = reconciling || fp.status === 'UNKNOWN' ? 'RECONCILIATION' : 'UPSTREAM_RESULT';
      fp.intent = null;
      switch (outcome.kind) {
        case 'SUCCEEDED':
          setPaymentStatus(fresh, op === 'CAPTURE' ? 'CAPTURED' : 'VOIDED', cause, ACTOR, now);
          fp.unknownOperation = null;
          audit(fresh, `payment.${op.toLowerCase()}`, ACTOR, now, { evidence: outcome.evidence });
          break;
        case 'REJECTED':
          // Definitive refusal: nothing happened upstream. Never retry blindly.
          setPaymentStatus(fresh, 'AUTHORIZED', cause, ACTOR, now);
          if (op === 'CAPTURE') fp.captureRejected = true;
          else raiseTask(fresh, 'COMPENSATION_FAILED', null, `Void rejected: ${outcome.code}`, ACTOR, now);
          if (op === 'VOID' && fresh.status === 'COMPENSATING') setOrderStatus(fresh, 'ACTION_REQUIRED', 'COMMAND', ACTOR, now, 'VOID_REJECTED');
          break;
        case 'UNKNOWN':
        case 'CAPABILITY_NOT_AVAILABLE':
          setPaymentStatus(fresh, 'UNKNOWN', cause, ACTOR, now);
          fp.unknownOperation = op;
          raiseTask(fresh, 'PAYMENT_UNKNOWN', null, `${op} outcome unknown`, ACTOR, now);
          this.advanceLater(fresh, now, 0);
          return;
      }
      this.advanceNow(fresh);
    });
    return true;
  }

  // ---------------------------------------------------------------- bookings

  private applyProviderState(agg: OrderAggregate, itemId: string, state: ProviderBookingState, cause: 'UPSTREAM_RESULT' | 'RECONCILIATION', now: Date): void {
    const it = item(agg, itemId);
    const target = bookingStatusFromProvider(state);
    if (target !== it.booking.status && !bookingMachine.canTransition(it.booking.status, target, cause)) {
      // Older provider state than ours (out-of-order event/poll): never regress (T18).
      audit(agg, 'booking.stale_state_ignored', ACTOR, now, { itemId, current: it.booking.status, reported: target });
      return;
    }
    // Set before the status so a confirmation records the provider-reported commission.
    if (state.providerCommission) it.booking.providerCommission = state.providerCommission;
    setBookingStatus(agg, itemId, target, cause, ACTOR, now);
    it.booking.providerBookingRef = state.providerBookingRef ?? it.booking.providerBookingRef;
    it.booking.pnr = state.pnr ?? it.booking.pnr;
    it.booking.ticketNumbers = state.ticketNumbers.length > 0 ? state.ticketNumbers : it.booking.ticketNumbers;
    it.booking.voucherReady = state.voucherReady;
    if (state.holdExpiresAt) it.booking.prebookExpiresAt = state.holdExpiresAt;
    if (it.connector.requiresIssuance && (target === 'CONFIRMED' || target === 'ISSUED')) {
      const issued = state.ticketingStatus === 'ISSUED' && it.booking.ticketNumbers.length > 0;
      if (issued && it.booking.ticketing !== 'ISSUED') setTicketing(agg, itemId, 'ISSUED', cause, ACTOR, now);
      else if (state.ticketingStatus === 'FAILED' && it.booking.ticketing === 'PENDING') setTicketing(agg, itemId, 'FAILED', cause, ACTOR, now);
    }
    if (target === 'CANCELLED' && it.booking.cancellation && it.booking.cancellation !== 'COMPLETED') {
      setCancellation(agg, itemId, 'COMPLETED', cause, ACTOR, now);
    }
    if (target !== 'UNKNOWN') it.booking.unknownOperation = null;
  }

  private async prebook(agg: OrderAggregate, itemId: string, now: Date): Promise<boolean> {
    const it = item(agg, itemId);
    it.booking.clientReferenceSeq += 1;
    const clientReference = `${it.booking.id}-${it.booking.clientReferenceSeq}`;
    it.booking.clientReference = clientReference;
    it.booking.intent = { op: 'PREBOOK', ...this.lease(now) };
    await this.deps.store.save(agg);

    const outcome = await this.deps.bookings(it).prebook(agg, it, clientReference);
    await this.applyResult(agg.id, (fresh, reconciling) => {
      const fi = item(fresh, itemId);
      const cause = reconciling || fi.booking.status === 'UNKNOWN' ? 'RECONCILIATION' : 'UPSTREAM_RESULT';
      fi.booking.intent = null;
      switch (outcome.kind) {
        case 'SUCCEEDED': {
          const held = outcome.value.inventoryHeld && fi.connector.holdSemantics === 'INVENTORY_HOLD';
          setBookingStatus(fresh, itemId, held ? 'HELD' : 'PREPARED', cause, ACTOR, now);
          fi.booking.prebookRef = outcome.value.prebookRef;
          fi.booking.prebookExpiresAt = outcome.value.expiresAt;
          if (outcome.value.differences.length > 0) {
            // K15/T04: a changed price or condition needs a new quote and explicit acceptance.
            fresh.compensationReason = `QUOTE_CHANGED:${itemId}:${outcome.value.differences.join('+')}`;
            setOrderStatus(fresh, 'COMPENSATING', 'COMMAND', ACTOR, now, fresh.compensationReason);
          }
          break;
        }
        case 'REJECTED':
          setBookingStatus(fresh, itemId, 'FAILED', cause, ACTOR, now);
          fi.booking.failureCode = outcome.code;
          break;
        case 'UNKNOWN':
          setBookingStatus(fresh, itemId, 'UNKNOWN', cause, ACTOR, now);
          fi.booking.unknownOperation = 'PREBOOK';
          raiseTask(fresh, 'BOOKING_UNKNOWN', itemId, `Prebook outcome unknown (${outcome.reason})`, ACTOR, now);
          this.advanceLater(fresh, now, 0);
          return;
        case 'CAPABILITY_NOT_AVAILABLE':
          setBookingStatus(fresh, itemId, 'FAILED', cause, ACTOR, now);
          fi.booking.failureCode = `CAPABILITY_NOT_AVAILABLE:${outcome.capability}`;
          break;
      }
      this.advanceNow(fresh);
    });
    return true;
  }

  private async book(agg: OrderAggregate, itemId: string, now: Date): Promise<boolean> {
    const it = item(agg, itemId);
    // A new client reference per BOOK intent, persisted before the call (§7 rule 2/4).
    it.booking.clientReferenceSeq += 1;
    const clientReference = `${it.booking.id}-${it.booking.clientReferenceSeq}`;
    it.booking.clientReference = clientReference;
    it.booking.intent = { op: 'BOOK', ...this.lease(now) };
    await this.deps.store.save(agg);

    const outcome = await this.deps.bookings(it).book(agg, it, clientReference);
    await this.applyResult(agg.id, (fresh, reconciling) => {
      const fi = item(fresh, itemId);
      const cause = reconciling || fi.booking.status === 'UNKNOWN' ? 'RECONCILIATION' : 'UPSTREAM_RESULT';
      fi.booking.intent = null;
      switch (outcome.kind) {
        case 'SUCCEEDED':
          this.applyProviderState(fresh, itemId, outcome.value, cause, now);
          if (fi.booking.status === 'PENDING_CONFIRMATION') this.advanceLater(fresh, now, 1);
          break;
        case 'REJECTED':
          setBookingStatus(fresh, itemId, 'FAILED', cause, ACTOR, now);
          fi.booking.failureCode = outcome.code;
          break;
        case 'UNKNOWN':
          setBookingStatus(fresh, itemId, 'UNKNOWN', cause, ACTOR, now);
          fi.booking.unknownOperation = 'BOOK';
          raiseTask(fresh, 'BOOKING_UNKNOWN', itemId, `Book outcome unknown (${outcome.reason})`, ACTOR, now);
          this.advanceLater(fresh, now, 0);
          return;
        case 'CAPABILITY_NOT_AVAILABLE':
          setBookingStatus(fresh, itemId, 'FAILED', cause, ACTOR, now);
          fi.booking.failureCode = `CAPABILITY_NOT_AVAILABLE:${outcome.capability}`;
          break;
      }
      if (fi.booking.status !== 'PENDING_CONFIRMATION') this.advanceNow(fresh);
    });
    return true;
  }

  private async lookupBooking(agg: OrderAggregate, itemId: string, now: Date): Promise<boolean> {
    const it = item(agg, itemId);
    const outcome = await this.deps.bookings(it).lookup(agg, it);
    await this.applyResult(agg.id, (fresh) => {
      const fi = item(fresh, itemId);
      if (fi.booking.status !== 'UNKNOWN') return; // already resolved by someone else
      fi.booking.lookupAttempts += 1;
      if (outcome.kind === 'SUCCEEDED' && outcome.value) {
        const resolvingCancel = fi.booking.unknownOperation === 'CANCEL';
        this.applyProviderState(fresh, itemId, outcome.value, 'RECONCILIATION', now);
        if (resolvingCancel && fi.booking.cancellation === 'UNKNOWN') {
          // The cancel did not take effect (or is still pending upstream). Not re-sent automatically.
          const resolved = item(fresh, itemId).booking.status as BookingStatus;
          setCancellation(fresh, itemId, resolved === 'CANCEL_PENDING' ? 'PROVIDER_PENDING' : 'REJECTED', 'RECONCILIATION', ACTOR, now);
        }
        this.advanceNow(fresh);
        return;
      }
      // Not found or still unknown: no new create/cancel; look again later (T19/T25).
      this.advanceLater(fresh, now, fi.booking.lookupAttempts);
    });
    return true;
  }

  private async refreshBooking(agg: OrderAggregate, itemId: string, now: Date): Promise<boolean> {
    const it = item(agg, itemId);
    const outcome = await this.deps.bookings(it).refresh(agg, it);
    await this.applyResult(agg.id, (fresh) => {
      const fi = item(fresh, itemId);
      if (outcome.kind === 'SUCCEEDED') {
        const key = () => `${fi.booking.status}|${fi.booking.ticketing}|${fi.booking.cancellation}`;
        const before = key();
        this.applyProviderState(fresh, itemId, outcome.value, 'RECONCILIATION', now);
        if (key() !== before) this.advanceNow(fresh);
        else this.advanceLater(fresh, now, ++fi.booking.lookupAttempts);
      } else {
        this.advanceLater(fresh, now, ++fi.booking.lookupAttempts);
      }
    });
    return true;
  }

  private async cancelBooking(agg: OrderAggregate, itemId: string, now: Date): Promise<boolean> {
    const it = item(agg, itemId);
    it.booking.preCancelStatus = it.booking.status;
    setBookingStatus(agg, itemId, 'CANCEL_PENDING', 'COMMAND', ACTOR, now);
    if (it.booking.cancellation === null) it.booking.cancellation = 'REQUESTED';
    it.booking.intent = { op: 'CANCEL', ...this.lease(now) };
    await this.deps.store.save(agg);

    const outcome = await this.deps.bookings(it).cancel(agg, it);
    await this.applyResult(agg.id, (fresh, reconciling) => {
      const fi = item(fresh, itemId);
      const cause = reconciling || fi.booking.status === 'UNKNOWN' ? 'RECONCILIATION' : 'UPSTREAM_RESULT';
      fi.booking.intent = null;
      switch (outcome.kind) {
        case 'SUCCEEDED': {
          this.applyProviderState(fresh, itemId, outcome.value, cause, now);
          if (fi.booking.status === 'CANCEL_PENDING') setCancellation(fresh, itemId, 'PROVIDER_PENDING', cause, ACTOR, now);
          const penalty = outcome.value.penalty;
          if (penalty && penalty.minor > 0n) {
            // Supplier penalty is our loss; it never becomes a hidden customer charge (§13).
            fresh.supplierLosses.push({ itemId, amount: penalty, reason: fresh.compensationReason ?? 'CANCELLATION' });
            raiseTask(fresh, 'SUPPLIER_LOSS_RECORDED', itemId, 'Compensating cancellation incurred a supplier penalty', ACTOR, now);
          }
          break;
        }
        case 'REJECTED':
        case 'CAPABILITY_NOT_AVAILABLE':
          setBookingStatus(fresh, itemId, fi.booking.preCancelStatus ?? 'CONFIRMED', cause, ACTOR, now);
          setCancellation(fresh, itemId, 'REJECTED', cause, ACTOR, now);
          break;
        case 'UNKNOWN':
          setBookingStatus(fresh, itemId, 'UNKNOWN', cause, ACTOR, now);
          fi.booking.unknownOperation = 'CANCEL';
          setCancellation(fresh, itemId, 'UNKNOWN', cause, ACTOR, now);
          raiseTask(fresh, 'CANCELLATION_UNKNOWN', itemId, `Cancel outcome unknown (${outcome.reason})`, ACTOR, now);
          this.advanceLater(fresh, now, 0);
          return;
      }
      this.advanceNow(fresh);
    });
    return true;
  }
}

/** Sum of recorded supplier losses per currency (for finance views and tests). */
export function totalSupplierLoss(agg: OrderAggregate, currency: string): Money {
  return agg.supplierLosses.filter((l) => l.amount.currency === currency).reduce((acc, l) => add(acc, l.amount), money(currency, 0n));
}
