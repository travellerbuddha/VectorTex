import type { DrizzleOrderStore, QuoteRepository } from '@texholiday/db';
import { freeCancellation, type OrderAggregate, type QuoteVersionSnapshot } from '@texholiday/domain';
import { toJson } from '@texholiday/pricing';
import type { CancellationView, OrderStage, OrderView, QuoteView } from './views';

/**
 * Customer view of an order (§14), shared by the site (order pages) and the worker (customer e-mails, P16): no provider
 * ids, no internal codes, no other people's data.
 */
export function cancellationView(c: QuoteVersionSnapshot['cancellation']): CancellationView {
  const free = freeCancellation(c);
  return {
    refundable: c.refundable,
    freeUntil: free.kind === 'FREE_UNTIL' ? free.lastFreeInstant.toISOString() : null,
    steps: c.steps.map((s) => ({ from: s.from, penalty: toJson(s.penalty) })),
  };
}

export function quoteView(q: QuoteVersionSnapshot, termsVersion: string): QuoteView {
  const o = q.option as {
    hotelId: string;
    hotelName: string;
    address: string | null;
    photo: string | null;
    room: QuoteView['room'];
    checkin: string;
    checkout: string;
    nights: number;
    rooms: QuoteView['rooms'];
  };
  return {
    quoteVersionId: q.id,
    expiresAt: q.expiresAt,
    hotel: { hotelId: o.hotelId, name: o.hotelName, address: o.address, photo: o.photo },
    room: o.room,
    checkin: o.checkin,
    checkout: o.checkout,
    nights: o.nights,
    rooms: o.rooms,
    total: toJson(q.chargeNow),
    payAtProperty: q.payAtProperty.map(toJson),
    cancellation: cancellationView(q.cancellation),
    termsVersion,
    paymentProvider: 'NUITEE',
  };
}

export function orderStage(agg: OrderAggregate): OrderStage {
  const it = agg.items[0]!;
  const p = agg.payment!;
  if (agg.status === 'CONFIRMED') return 'CONFIRMED';
  if (agg.status === 'ACTION_REQUIRED') return 'NEEDS_ATTENTION';
  if (agg.status === 'CANCELLED') {
    if (it.booking.status === 'CANCELLED') return 'CANCELLED';
    const code = it.booking.failureCode ?? agg.compensationReason ?? '';
    if (code === 'CHECKOUT_EXPIRED') return 'EXPIRED';
    if (code.startsWith('QUOTE_CHANGED')) return 'PRICE_CHANGED';
    return 'FAILED';
  }
  if (p.status === 'NEW') return 'PREPARING_PAYMENT';
  if (it.booking.intent?.op === 'BOOK' || it.booking.status === 'UNKNOWN' || it.booking.status === 'PENDING_CONFIRMATION') return 'CONFIRMING';
  if (p.status === 'PENDING' && it.booking.status === 'PREPARED') return 'AWAITING_PAYMENT';
  return 'CONFIRMING';
}

export async function loadOrderView(store: DrizzleOrderStore, quotes: QuoteRepository, orderId: string, termsVersion: string): Promise<OrderView> {
  const agg = await store.load(orderId);
  const it = agg.items[0]!;
  const q = await quotes.get(it.quoteVersionId);
  return {
    orderId,
    stage: orderStage(agg),
    paymentHoldMayExist: agg.tasks.some((t) => t.reason === 'PROVIDER_PAYMENT_HOLD'),
    bookingReference: agg.status === 'CONFIRMED' ? it.booking.providerBookingRef : null,
    voucherReady: it.booking.voucherReady,
    payBy: agg.payment!.payBy,
    quote: quoteView(q!, termsVersion),
  };
}
