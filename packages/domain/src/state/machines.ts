import { defineMachine } from './machine';

export type PaymentStatus =
  | 'NEW'
  | 'PENDING'
  | 'REQUIRES_ACTION'
  | 'FRAUD_REVIEW'
  | 'AUTHORIZED'
  | 'CAPTURE_PENDING'
  | 'CAPTURED'
  | 'DECLINED'
  | 'VOID_PENDING'
  | 'VOIDED'
  | 'REFUND_PENDING'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'UNKNOWN';

/** Payment attempt lifecycle (§7). Webhooks cannot move it backwards: only listed edges exist. */
export const paymentMachine = defineMachine<PaymentStatus>({
  name: 'payment',
  unknownState: 'UNKNOWN',
  terminal: ['DECLINED', 'VOIDED', 'REFUNDED'],
  transitions: {
    NEW: ['PENDING', 'DECLINED', 'UNKNOWN'],
    PENDING: ['REQUIRES_ACTION', 'FRAUD_REVIEW', 'AUTHORIZED', 'CAPTURED', 'DECLINED', 'UNKNOWN'],
    REQUIRES_ACTION: ['PENDING', 'FRAUD_REVIEW', 'AUTHORIZED', 'CAPTURED', 'DECLINED', 'UNKNOWN'],
    FRAUD_REVIEW: ['AUTHORIZED', 'CAPTURED', 'DECLINED', 'VOID_PENDING', 'UNKNOWN'],
    AUTHORIZED: ['CAPTURE_PENDING', 'VOID_PENDING', 'DECLINED'],
    // Definitive capture rejection leaves the authorization as it was (or expired -> DECLINED).
    CAPTURE_PENDING: ['CAPTURED', 'AUTHORIZED', 'DECLINED', 'UNKNOWN'],
    CAPTURED: ['REFUND_PENDING'],
    VOID_PENDING: ['VOIDED', 'AUTHORIZED', 'UNKNOWN'],
    VOIDED: [],
    DECLINED: [],
    REFUND_PENDING: ['PARTIALLY_REFUNDED', 'REFUNDED', 'CAPTURED', 'UNKNOWN'],
    PARTIALLY_REFUNDED: ['REFUND_PENDING'],
    REFUNDED: [],
    UNKNOWN: [
      'PENDING',
      'REQUIRES_ACTION',
      'FRAUD_REVIEW',
      'AUTHORIZED',
      'CAPTURED',
      'DECLINED',
      'VOIDED',
      'PARTIALLY_REFUNDED',
      'REFUNDED',
    ],
  },
});

/** Payment statuses in which a second attempt/gateway must not start (rule 6, T21). */
export const PAYMENT_BLOCKING_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  'NEW',
  'PENDING',
  'REQUIRES_ACTION',
  'FRAUD_REVIEW',
  'AUTHORIZED',
  'CAPTURE_PENDING',
  'CAPTURED',
  'VOID_PENDING',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'UNKNOWN',
]);

export type BookingStatus =
  | 'NEW'
  | 'PREPARED'
  | 'HELD'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'ISSUED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'FAILED'
  | 'UNKNOWN';

/** Provider booking lifecycle. PREPARED = validated offer; HELD only for proven inventory holds. */
export const bookingMachine = defineMachine<BookingStatus>({
  name: 'booking',
  unknownState: 'UNKNOWN',
  terminal: ['CANCELLED', 'FAILED'],
  transitions: {
    NEW: ['PREPARED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'UNKNOWN'],
    PREPARED: ['HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'CANCELLED', 'UNKNOWN'],
    HELD: ['PENDING_CONFIRMATION', 'CONFIRMED', 'FAILED', 'CANCEL_PENDING', 'CANCELLED', 'UNKNOWN'],
    PENDING_CONFIRMATION: ['CONFIRMED', 'FAILED', 'CANCEL_PENDING', 'UNKNOWN'],
    CONFIRMED: ['ISSUED', 'CANCEL_PENDING'],
    ISSUED: ['CANCEL_PENDING'],
    // A rejected cancellation returns the booking to where it was.
    CANCEL_PENDING: ['CANCELLED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'ISSUED', 'UNKNOWN'],
    CANCELLED: [],
    FAILED: [],
    UNKNOWN: ['PREPARED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'ISSUED', 'CANCEL_PENDING', 'CANCELLED', 'FAILED'],
  },
});

export type TicketingStatus = 'NOT_REQUIRED' | 'PENDING' | 'ISSUED' | 'FAILED' | 'UNKNOWN';

/** Flight ticket issuance, tracked separately from the PNR/booking confirmation (T08). */
export const ticketingMachine = defineMachine<TicketingStatus>({
  name: 'ticketing',
  unknownState: 'UNKNOWN',
  terminal: ['NOT_REQUIRED', 'ISSUED', 'FAILED'],
  transitions: {
    NOT_REQUIRED: [],
    PENDING: ['ISSUED', 'FAILED', 'UNKNOWN'],
    ISSUED: [],
    FAILED: [],
    UNKNOWN: ['PENDING', 'ISSUED', 'FAILED'],
  },
});

export type CancellationStatus = 'QUOTED' | 'EXPIRED' | 'REQUESTED' | 'PROVIDER_PENDING' | 'COMPLETED' | 'REJECTED' | 'UNKNOWN';

/** A cancellation request. COMPLETED means the provider cancelled; it says nothing about refunds. */
export const cancellationMachine = defineMachine<CancellationStatus>({
  name: 'cancellation',
  unknownState: 'UNKNOWN',
  terminal: ['EXPIRED', 'COMPLETED', 'REJECTED'],
  transitions: {
    QUOTED: ['REQUESTED', 'EXPIRED'],
    EXPIRED: [],
    REQUESTED: ['PROVIDER_PENDING', 'COMPLETED', 'REJECTED', 'UNKNOWN'],
    PROVIDER_PENDING: ['COMPLETED', 'REJECTED', 'UNKNOWN'],
    COMPLETED: [],
    REJECTED: [],
    UNKNOWN: ['PROVIDER_PENDING', 'COMPLETED', 'REJECTED'],
  },
});

export type RefundStatus = 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

/** One customer refund movement (our gateway). Provider-managed refunds are tracked, never re-paid. */
export const refundMachine = defineMachine<RefundStatus>({
  name: 'refund',
  unknownState: 'UNKNOWN',
  terminal: ['SUCCEEDED', 'FAILED'],
  transitions: {
    REQUESTED: ['PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'],
    PENDING: ['SUCCEEDED', 'FAILED', 'UNKNOWN'],
    SUCCEEDED: [],
    FAILED: [],
    UNKNOWN: ['PENDING', 'SUCCEEDED', 'FAILED'],
  },
});

export type OrderStatus = 'DRAFT' | 'PROCESSING' | 'CONFIRMED' | 'ACTION_REQUIRED' | 'COMPENSATING' | 'CANCELLED';

export const orderMachine = defineMachine<OrderStatus>({
  name: 'order',
  terminal: ['CANCELLED'],
  transitions: {
    DRAFT: ['PROCESSING', 'CANCELLED'],
    PROCESSING: ['CONFIRMED', 'ACTION_REQUIRED', 'COMPENSATING'],
    CONFIRMED: ['ACTION_REQUIRED', 'COMPENSATING', 'CANCELLED'],
    ACTION_REQUIRED: ['PROCESSING', 'CONFIRMED', 'COMPENSATING', 'CANCELLED'],
    COMPENSATING: ['CANCELLED', 'ACTION_REQUIRED'],
    CANCELLED: [],
  },
});

/** Reason codes of OperationTasks. BOOKED_UNPAID is a task reason, never an order status (§7). */
export type OperationTaskReason =
  | 'BOOKED_UNPAID'
  | 'BOOKING_UNKNOWN'
  | 'PAYMENT_UNKNOWN'
  | 'CANCELLATION_UNKNOWN'
  | 'REFUND_UNKNOWN'
  | 'COMPENSATION_FAILED'
  | 'AUTHORIZATION_EXPIRING'
  | 'PAYMENT_MISMATCH'
  | 'FRAUD_REVIEW'
  | 'VOUCHER_DELAYED'
  | 'TICKETING_DELAYED'
  | 'SUPPLIER_LOSS_RECORDED';

export type DocumentStatus = 'PENDING' | 'READY';
