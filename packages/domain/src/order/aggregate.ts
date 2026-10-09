import type {
  FraudVerdict,
  FundingMethod,
  HoldSemantics,
  OpaqueRef,
  PaymentRoute,
  ProductType,
  ProviderEnvironment,
} from '@texholiday/contracts';
import type { Money } from '@texholiday/pricing';
import {
  bookingMachine,
  cancellationMachine,
  orderMachine,
  paymentMachine,
  ticketingMachine,
  type BookingStatus,
  type CancellationStatus,
  type OperationTaskReason,
  type OrderStatus,
  type PaymentStatus,
  type TicketingStatus,
} from '../state/machines';
import type { TransitionCause } from '../state/machine';

export type BookingOperation = 'PREBOOK' | 'BOOK' | 'CANCEL';
export type PaymentOperation = 'CAPTURE' | 'VOID';

/** A side-effecting call that was persisted before it was sent. */
export interface Intent<Op extends string> {
  op: Op;
  startedAt: string;
  leaseUntil: string;
  workerId: string;
}

export interface BookingState {
  id: string;
  status: BookingStatus;
  /** Unique per BOOK intent; also used for lookups after a lost response. */
  clientReference: string | null;
  clientReferenceSeq: number;
  providerBookingRef: OpaqueRef | null;
  prebookRef: OpaqueRef | null;
  prebookExpiresAt: string | null;
  pnr: string | null;
  ticketNumbers: readonly string[];
  ticketing: TicketingStatus;
  voucherReady: boolean;
  cancellation: CancellationStatus | null;
  /** Status before a cancellation was requested, restored if the provider rejects it. */
  preCancelStatus: BookingStatus | null;
  intent: Intent<BookingOperation> | null;
  /** Which operation produced the current UNKNOWN (drives the right lookup). */
  unknownOperation: BookingOperation | null;
  lookupAttempts: number;
  failureCode: string | null;
}

export interface OrderItemState {
  id: string;
  productType: ProductType;
  providerId: string;
  connectorId: string;
  quoteVersionId: string;
  /** This item's share of the customer charge (recorded allocation, used for refunds). */
  chargeAllocation: Money;
  supplierCost: Money;
  funding: { method: FundingMethod; capabilityId: string };
  connector: { holdSemantics: HoldSemantics; reversibilityRank: number; requiresIssuance: boolean; needsPrebook: boolean };
  booking: BookingState;
}

export interface PaymentState {
  id: string;
  /** When the attempt was created; no authorization can be older than this. */
  createdAt: string;
  gatewayId: string;
  status: PaymentStatus;
  amount: Money;
  sessionRef: string | null;
  gatewayPaymentId: string | null;
  fraud: FraudVerdict;
  authorizationExpiresAt: string | null;
  /** Verified gateway amount/currency/order/attempt did not match ours (T14). */
  mismatch: boolean;
  /** A capture was definitively rejected while bookings were confirmed (T26). */
  captureRejected: boolean;
  intent: Intent<PaymentOperation> | null;
  unknownOperation: PaymentOperation | 'AUTHORIZE' | null;
  itemTransactions: ReadonlyArray<{ itemId: string; gatewayItemTransactionId: string; amount: Money }>;
}

export interface TaskState {
  /** Assigned by the store when persisted. */
  id?: string;
  reason: OperationTaskReason;
  itemId: string | null;
  status: 'OPEN' | 'RESOLVED';
  detail: string;
}

export interface PendingEvent {
  type: string;
  payload: Record<string, unknown>;
  /** Earliest time a worker may process it (delayed reconciliation). */
  availableAt: string | null;
}

export interface AuditEntry {
  action: string;
  actor: string;
  at: string;
  detail: Record<string, unknown>;
}

export interface SupplierLoss {
  /** Assigned by the store when persisted. */
  id?: string;
  itemId: string;
  amount: Money;
  reason: string;
}

export interface OrderAggregate {
  id: string;
  version: number;
  environment: ProviderEnvironment;
  status: OrderStatus;
  route: PaymentRoute;
  chargeTotal: Money;
  compensationReason: string | null;
  items: OrderItemState[];
  payment: PaymentState | null;
  tasks: TaskState[];
  supplierLosses: SupplierLoss[];
  /** Appended during a mutation, persisted in the same transaction as the state change. */
  pendingEvents: PendingEvent[];
  pendingAudit: AuditEntry[];
}

export function item(agg: OrderAggregate, itemId: string): OrderItemState {
  const found = agg.items.find((i) => i.id === itemId);
  if (!found) throw new Error(`Order ${agg.id} has no item ${itemId}`);
  return found;
}

export function audit(agg: OrderAggregate, action: string, actor: string, at: Date, detail: Record<string, unknown> = {}): void {
  agg.pendingAudit.push({ action, actor, at: at.toISOString(), detail });
}

export function emit(agg: OrderAggregate, type: string, payload: Record<string, unknown>, availableAt: Date | null = null): void {
  agg.pendingEvents.push({ type, payload, availableAt: availableAt ? availableAt.toISOString() : null });
}

export function setOrderStatus(agg: OrderAggregate, to: OrderStatus, cause: TransitionCause, actor: string, at: Date, reason: string): void {
  if (agg.status === to) return;
  orderMachine.assertTransition(agg.status, to, cause);
  audit(agg, 'order.status', actor, at, { from: agg.status, to, reason });
  agg.status = to;
  emit(agg, 'order.status_changed', { orderId: agg.id, status: to, reason });
}

export function setBookingStatus(agg: OrderAggregate, itemId: string, to: BookingStatus, cause: TransitionCause, actor: string, at: Date): void {
  const it = item(agg, itemId);
  if (it.booking.status === to) return;
  bookingMachine.assertTransition(it.booking.status, to, cause);
  audit(agg, 'booking.status', actor, at, { itemId, from: it.booking.status, to });
  it.booking.status = to;
}

export function setTicketing(agg: OrderAggregate, itemId: string, to: TicketingStatus, cause: TransitionCause, actor: string, at: Date): void {
  const it = item(agg, itemId);
  if (it.booking.ticketing === to) return;
  ticketingMachine.assertTransition(it.booking.ticketing, to, cause);
  audit(agg, 'ticketing.status', actor, at, { itemId, from: it.booking.ticketing, to });
  it.booking.ticketing = to;
}

export function setCancellation(agg: OrderAggregate, itemId: string, to: CancellationStatus, cause: TransitionCause, actor: string, at: Date): void {
  const it = item(agg, itemId);
  const from = it.booking.cancellation;
  if (from === to) return;
  if (from !== null) cancellationMachine.assertTransition(from, to, cause);
  audit(agg, 'cancellation.status', actor, at, { itemId, from, to });
  it.booking.cancellation = to;
}

export function setPaymentStatus(agg: OrderAggregate, to: PaymentStatus, cause: TransitionCause, actor: string, at: Date): void {
  const p = agg.payment;
  if (!p) throw new Error(`Order ${agg.id} has no payment attempt`);
  if (p.status === to) return;
  paymentMachine.assertTransition(p.status, to, cause);
  audit(agg, 'payment.status', actor, at, { from: p.status, to });
  p.status = to;
}

/** Opens a task unless an identical open task already exists. Tasks are never silently closed. */
export function raiseTask(agg: OrderAggregate, reason: OperationTaskReason, itemId: string | null, detail: string, actor: string, at: Date): boolean {
  if (agg.tasks.some((t) => t.status === 'OPEN' && t.reason === reason && t.itemId === itemId)) return false;
  agg.tasks.push({ reason, itemId, status: 'OPEN', detail });
  audit(agg, 'task.opened', actor, at, { reason, itemId });
  emit(agg, 'task.opened', { orderId: agg.id, reason, itemId });
  return true;
}

export function hasOpenTask(agg: OrderAggregate, reason: OperationTaskReason, itemId: string | null = null): boolean {
  return agg.tasks.some((t) => t.status === 'OPEN' && t.reason === reason && t.itemId === itemId);
}

/** Final provider success for one item. A flight PNR without issued tickets is not final (T08). */
export function itemFinallySucceeded(it: OrderItemState): boolean {
  if (it.booking.status === 'ISSUED') return true;
  if (it.booking.status !== 'CONFIRMED') return false;
  return !it.connector.requiresIssuance || it.booking.ticketing === 'ISSUED';
}

/** Confirmation order (§13.8): easier/cheaper to undo first, ticketing last; ties by item id. */
export function confirmationOrder(agg: OrderAggregate): OrderItemState[] {
  return [...agg.items].sort((a, b) => {
    const ra = a.connector.reversibilityRank + (a.connector.requiresIssuance ? 1_000 : 0);
    const rb = b.connector.reversibilityRank + (b.connector.requiresIssuance ? 1_000 : 0);
    return ra === rb ? a.id.localeCompare(b.id) : ra - rb;
  });
}
