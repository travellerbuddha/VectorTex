import type { DrizzleOrderStore, QuoteRepository } from '@texholiday/db';
import { awaitingTicket, freeCancellation, type OrderAggregate, type QuoteVersionSnapshot } from '@texholiday/domain';
import { toJson, type MoneyJson } from '@texholiday/pricing';
import type { CancellationView, FlightJourneyView, FlightQuoteView, FlightServiceLine, FlightTermsView, OrderStage, OrderView, PassengerType, QuoteView } from './views';

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
    product: 'HOTEL',
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

/** What a flight quote version stores in `option` (customer-facing facts of the verified offer). */
export interface FlightQuoteOption {
  title: string;
  legs: ReadonlyArray<{ origin: string; destination: string; date: string }>;
  journeys: readonly FlightJourneyView[];
  passengers: { adults: number; childAges: readonly number[]; infantAges: readonly number[] };
  cabinClass: string | null;
  perPassenger: Partial<Record<PassengerType, MoneyJson>>;
  terms: FlightTermsView;
  baggage: ReadonlyArray<{ bagType: string; pieces: number; weightKg: number | null }>;
  fareFamily: string | null;
  capabilityId: string;
  /** The search price, when verification changed it. */
  priceChangedFrom: MoneyJson | null;
  /** The provider's offer id stops working at this instant. */
  offerExpiresAt: string | null;
  /** Segment keys of the provider journey, in journey order (services are attached per segment). */
  segmentKeys?: string[];
  /** Ancillaries the approved policy sells for this quote (a markup is set for them, ADR-0013). */
  extras?: { seats: boolean; bags: boolean };
  /** Services added before payment and the fare total without them (later quote versions only). */
  services?: FlightServiceLine[];
  fare?: MoneyJson;
}

export function flightQuoteView(q: QuoteVersionSnapshot, termsVersion: string): FlightQuoteView {
  const o = q.option as unknown as FlightQuoteOption;
  return {
    product: 'FLIGHT',
    quoteVersionId: q.id,
    expiresAt: q.expiresAt,
    title: o.title,
    journeys: o.journeys,
    passengers: o.passengers,
    cabinClass: o.cabinClass,
    total: toJson(q.chargeNow),
    perPassenger: o.perPassenger,
    terms: o.terms,
    baggage: o.baggage,
    fareFamily: o.fareFamily,
    priceChangedFrom: o.priceChangedFrom,
    services: o.services ?? [],
    fare: o.fare ?? toJson(q.chargeNow),
    termsVersion,
    paymentProvider: 'NUITEE',
  };
}

export function anyQuoteView(q: QuoteVersionSnapshot, termsVersion: string): QuoteView | FlightQuoteView {
  return q.productType === 'FLIGHT' ? flightQuoteView(q, termsVersion) : quoteView(q, termsVersion);
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
  if (p.status === 'NEW' || it.booking.intent?.op === 'SERVICES') return 'PREPARING_PAYMENT';
  if (awaitingTicket(agg, it)) return 'ISSUING';
  if (it.booking.intent?.op === 'BOOK' || it.booking.status === 'UNKNOWN' || it.booking.status === 'PENDING_CONFIRMATION') return 'CONFIRMING';
  if (p.status === 'PENDING' && it.booking.status === 'PREPARED') return 'AWAITING_PAYMENT';
  return 'CONFIRMING';
}

export async function loadOrderView(store: DrizzleOrderStore, quotes: QuoteRepository, orderId: string, termsVersion: string): Promise<OrderView> {
  const agg = await store.load(orderId);
  const it = agg.items[0]!;
  const q = await quotes.get(it.quoteVersionId);
  const flight = it.productType === 'FLIGHT';
  return {
    orderId,
    stage: orderStage(agg),
    paymentHoldMayExist: agg.tasks.some((t) => t.reason === 'PROVIDER_PAYMENT_HOLD'),
    // A flight is identified by the airline's booking code (PNR) once it is ticketed.
    bookingReference: agg.status !== 'CONFIRMED' ? null : flight ? it.booking.pnr : it.booking.providerBookingRef,
    voucherReady: it.booking.voucherReady,
    payBy: agg.payment!.payBy,
    quote: anyQuoteView(q!, termsVersion),
    ticketNumbers: flight && agg.status === 'CONFIRMED' ? [...it.booking.ticketNumbers] : [],
  };
}
