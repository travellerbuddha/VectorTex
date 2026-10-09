import type { OperationTaskReason } from '../state/machines';
import { confirmationOrder, hasOpenTask, itemFinallySucceeded, type OrderAggregate } from './aggregate';

export interface OrchestrationPolicy {
  /** From the approved risk policy: stop automation this long before the authorization expires. */
  authorizationSafetyMarginSeconds: number;
  /** After this many inconclusive lookups the order goes to ACTION_REQUIRED (lookups continue). */
  maxAutomaticLookups: number;
  /** Lease for a side-effecting call; must exceed the provider's documented long-operation budget. */
  intentLeaseSeconds: number;
  /** Delay before the next read-only reconciliation attempt. */
  reconcileDelaySeconds: (attempt: number) => number;
}

export type NextAction =
  | { type: 'DONE' }
  | { type: 'WAIT'; reason: string; itemId?: string }
  | { type: 'EXPIRE_INTENT'; target: 'BOOKING'; itemId: string }
  | { type: 'EXPIRE_INTENT'; target: 'PAYMENT' }
  | { type: 'RETRIEVE_PAYMENT' }
  | { type: 'LOOKUP_BOOKING'; itemId: string }
  | { type: 'REFRESH_BOOKING'; itemId: string }
  | { type: 'PREBOOK'; itemId: string }
  | { type: 'BOOK'; itemId: string }
  | { type: 'CAPTURE' }
  | { type: 'VOID' }
  | { type: 'CANCEL_BOOKING'; itemId: string }
  | { type: 'DISCARD_PREPARED'; itemId: string }
  | { type: 'START_COMPENSATION'; reason: string }
  | { type: 'MARK_ORDER_CONFIRMED' }
  | { type: 'MARK_ORDER_CANCELLED'; reason: string }
  | { type: 'RAISE_ACTION_REQUIRED'; reason: OperationTaskReason; itemId: string | null; detail: string }
  | { type: 'RAISE_TASK'; reason: OperationTaskReason; itemId: string | null; detail: string };

const leaseActive = (leaseUntil: string, now: Date) => new Date(leaseUntil).getTime() > now.getTime();

/**
 * Decides the single next step for an own-gateway order (package or single item). Pure function of
 * persisted state: a crashed or duplicated worker re-derives the same decision from the database.
 *
 * Invariants enforced here (spec §13):
 * - Nothing side-effecting happens before a server-verified authorization.
 * - While any payment or booking is UNKNOWN only read-only reconciliation runs.
 * - One capture, only after every required item reached final success.
 * - Compensation cancels created bookings before voiding; it never refunds automatically.
 */
export function decideNextAction(agg: OrderAggregate, now: Date, policy: OrchestrationPolicy): NextAction {
  if (agg.status === 'CONFIRMED' || agg.status === 'CANCELLED') return { type: 'DONE' };
  if (agg.status === 'DRAFT') return { type: 'WAIT', reason: 'ORDER_NOT_SUBMITTED' };
  if (agg.route.mode !== 'OWN_GATEWAY') return { type: 'WAIT', reason: 'NOT_AN_OWN_GATEWAY_ORDER' };
  const p = agg.payment;
  if (!p) return { type: 'WAIT', reason: 'NO_PAYMENT_ATTEMPT' };

  // 1. Calls in flight: wait for them, or turn an expired lease into UNKNOWN (never into FAILED).
  for (const it of agg.items) {
    const intent = it.booking.intent;
    if (intent) return leaseActive(intent.leaseUntil, now) ? { type: 'WAIT', reason: 'CALL_IN_FLIGHT', itemId: it.id } : { type: 'EXPIRE_INTENT', target: 'BOOKING', itemId: it.id };
  }
  if (p.intent) return leaseActive(p.intent.leaseUntil, now) ? { type: 'WAIT', reason: 'CALL_IN_FLIGHT' } : { type: 'EXPIRE_INTENT', target: 'PAYMENT' };

  // 2. Unknowns: read-only reconciliation only, in every order status.
  if (p.status === 'UNKNOWN') return { type: 'RETRIEVE_PAYMENT' };
  const unknownItem = [...agg.items].sort((a, b) => a.id.localeCompare(b.id)).find((i) => i.booking.status === 'UNKNOWN');
  if (unknownItem) {
    if (unknownItem.booking.lookupAttempts >= policy.maxAutomaticLookups && agg.status === 'PROCESSING') {
      return { type: 'RAISE_ACTION_REQUIRED', reason: 'BOOKING_UNKNOWN', itemId: unknownItem.id, detail: 'Lookups did not resolve the booking outcome' };
    }
    return { type: 'LOOKUP_BOOKING', itemId: unknownItem.id };
  }

  if (agg.status === 'ACTION_REQUIRED') return { type: 'WAIT', reason: 'AWAITING_OPERATOR' };
  if (agg.status === 'COMPENSATING') return decideCompensation(agg);

  // 3. PROCESSING: payment gate.
  switch (p.status) {
    case 'NEW':
    case 'PENDING':
    case 'REQUIRES_ACTION':
      return { type: 'WAIT', reason: 'AWAITING_CUSTOMER_PAYMENT' };
    case 'CAPTURE_PENDING':
    case 'VOID_PENDING':
      // Pending without an intent means a crash between steps: query, do not repeat.
      return { type: 'RETRIEVE_PAYMENT' };
    case 'DECLINED':
    case 'VOIDED':
      return agg.items.some((i) => i.booking.status !== 'NEW')
        ? { type: 'RAISE_ACTION_REQUIRED', reason: 'BOOKED_UNPAID', itemId: null, detail: `Payment ${p.status} after bookings started` }
        : { type: 'MARK_ORDER_CANCELLED', reason: `PAYMENT_${p.status}` };
    case 'REFUND_PENDING':
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return { type: 'RAISE_ACTION_REQUIRED', reason: 'PAYMENT_MISMATCH', itemId: null, detail: `Unexpected payment status ${p.status} while processing` };
    default:
      break;
  }

  if (p.mismatch) return { type: 'START_COMPENSATION', reason: 'PAYMENT_MISMATCH' };
  if (p.fraud === 'REJECTED') return { type: 'START_COMPENSATION', reason: 'FRAUD_REJECTED' };
  if (p.status === 'FRAUD_REVIEW' || p.fraud === 'REVIEW') {
    // T16: no irreversible booking or ticketing while fraud review is open.
    return hasOpenTask(agg, 'FRAUD_REVIEW')
      ? { type: 'WAIT', reason: 'FRAUD_REVIEW' }
      : { type: 'RAISE_TASK', reason: 'FRAUD_REVIEW', itemId: null, detail: 'Gateway fraud review must clear before booking' };
  }

  if (p.status === 'CAPTURED') {
    return agg.items.every(itemFinallySucceeded)
      ? { type: 'MARK_ORDER_CONFIRMED' }
      : { type: 'RAISE_ACTION_REQUIRED', reason: 'PAYMENT_MISMATCH', itemId: null, detail: 'Captured before all bookings were final' };
  }

  // p.status === 'AUTHORIZED'
  if (p.captureRejected) {
    return { type: 'RAISE_ACTION_REQUIRED', reason: 'BOOKED_UNPAID', itemId: null, detail: 'Capture was definitively rejected after bookings succeeded' };
  }
  const failed = agg.items.find((i) => i.booking.status === 'FAILED');
  if (failed) return { type: 'START_COMPENSATION', reason: `ITEM_FAILED:${failed.id}` };
  const cancelled = agg.items.find((i) => i.booking.status === 'CANCELLED');
  if (cancelled) return { type: 'START_COMPENSATION', reason: `ITEM_CANCELLED:${cancelled.id}` };

  if (agg.items.every(itemFinallySucceeded)) return { type: 'CAPTURE' };

  if (p.authorizationExpiresAt) {
    const stopAt = new Date(p.authorizationExpiresAt).getTime() - policy.authorizationSafetyMarginSeconds * 1000;
    if (now.getTime() >= stopAt) {
      return { type: 'RAISE_ACTION_REQUIRED', reason: 'AUTHORIZATION_EXPIRING', itemId: null, detail: 'Authorization safety margin reached before all bookings were final' };
    }
  }

  // 4. Sequential confirmation in reversibility order; wait for each item to be final.
  for (const it of confirmationOrder(agg)) {
    if (itemFinallySucceeded(it)) continue;
    const b = it.booking;
    switch (b.status) {
      case 'NEW':
        return it.connector.needsPrebook ? { type: 'PREBOOK', itemId: it.id } : { type: 'BOOK', itemId: it.id };
      case 'PREPARED':
      case 'HELD':
        if (b.prebookExpiresAt && new Date(b.prebookExpiresAt).getTime() <= now.getTime()) {
          return { type: 'START_COMPENSATION', reason: `PREBOOK_EXPIRED:${it.id}` };
        }
        return { type: 'BOOK', itemId: it.id };
      case 'PENDING_CONFIRMATION':
      case 'CANCEL_PENDING':
        return { type: 'REFRESH_BOOKING', itemId: it.id };
      case 'CONFIRMED':
        if (b.ticketing === 'FAILED') return { type: 'START_COMPENSATION', reason: `TICKETING_FAILED:${it.id}` };
        return { type: 'REFRESH_BOOKING', itemId: it.id };
      default:
        return { type: 'WAIT', reason: `UNEXPECTED_BOOKING_STATE:${b.status}`, itemId: it.id };
    }
  }
  return { type: 'WAIT', reason: 'NOTHING_TO_DO' };
}

function decideCompensation(agg: OrderAggregate): NextAction {
  const p = agg.payment;
  // Undo in reverse confirmation order (least reversible first was booked last).
  for (const it of [...confirmationOrder(agg)].reverse()) {
    const b = it.booking;
    switch (b.status) {
      case 'CONFIRMED':
      case 'ISSUED':
      case 'HELD':
      case 'PENDING_CONFIRMATION':
        if (b.cancellation === 'REJECTED') {
          return { type: 'RAISE_ACTION_REQUIRED', reason: 'COMPENSATION_FAILED', itemId: it.id, detail: 'Provider rejected the compensating cancellation' };
        }
        return { type: 'CANCEL_BOOKING', itemId: it.id };
      case 'PREPARED':
        return { type: 'DISCARD_PREPARED', itemId: it.id };
      case 'CANCEL_PENDING':
        return { type: 'REFRESH_BOOKING', itemId: it.id };
      default:
        break; // NEW, CANCELLED, FAILED: nothing to undo.
    }
  }
  if (!p) return { type: 'MARK_ORDER_CANCELLED', reason: agg.compensationReason ?? 'COMPENSATED' };
  switch (p.status) {
    case 'AUTHORIZED':
    case 'FRAUD_REVIEW':
      return { type: 'VOID' };
    case 'VOID_PENDING':
    case 'CAPTURE_PENDING':
      return { type: 'RETRIEVE_PAYMENT' };
    case 'NEW':
    case 'PENDING':
    case 'REQUIRES_ACTION':
      return { type: 'WAIT', reason: 'AWAITING_PAYMENT_RESOLUTION' };
    case 'VOIDED':
    case 'DECLINED':
      return { type: 'MARK_ORDER_CANCELLED', reason: agg.compensationReason ?? 'COMPENSATED' };
    default:
      // Captured/refund states: refunds are an approved finance command, never automatic here.
      return { type: 'RAISE_ACTION_REQUIRED', reason: 'COMPENSATION_FAILED', itemId: null, detail: `Compensation reached payment status ${p.status}` };
  }
}
