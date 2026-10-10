import type { MoneyJson } from '@texholiday/pricing';

/** Customer-facing shapes (§14): no provider ids, no internal codes, no personal data of other people. */

export interface CancellationView {
  refundable: boolean;
  /** Last instant without a penalty (ISO, UTC); null when non-refundable or no penalty steps. */
  freeUntil: string | null;
  steps: ReadonlyArray<{ from: string; penalty: MoneyJson }>;
}

export interface HotelOfferView {
  key: string;
  roomName: string | null;
  boardType: string | null;
  boardName: string | null;
  total: MoneyJson;
  /** Average per night (display only; nightly prices may differ). */
  perNightAverage: MoneyJson;
  payAtProperty: readonly MoneyJson[];
  cancellation: CancellationView;
}

export interface HotelResultView {
  hotelId: string;
  name: string;
  photo: string | null;
  address: string | null;
  city: string | null;
  rating: number | null;
  stars: number | null;
  from: MoneyJson;
  offers: readonly HotelOfferView[];
}

export interface HotelSearchView {
  sessionId: string;
  expiresAt: string;
  currency: string;
  nights: number;
  paymentMode: 'PROVIDER_MANAGED';
  hotels: readonly HotelResultView[];
  /** Offers left out: below the hotel's suggested public price, not priced exactly, or not payable online. */
  hidden: { belowSuggestedPrice: number; notPriced: number; notPayableOnline: number };
}

export interface QuoteView {
  product: 'HOTEL';
  quoteVersionId: string;
  expiresAt: string;
  hotel: { hotelId: string; name: string; address: string | null; photo: string | null };
  room: { name: string | null; boardType: string | null; boardName: string | null };
  checkin: string;
  checkout: string;
  nights: number;
  rooms: ReadonlyArray<{ occupancyNumber: number; adults: number; childAges: readonly number[] }>;
  total: MoneyJson;
  payAtProperty: readonly MoneyJson[];
  cancellation: CancellationView;
  termsVersion: string;
  paymentProvider: 'NUITEE';
}

export type OrderStage =
  | 'PREPARING_PAYMENT'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMING'
  /** Flight booked and paid (airline PNR), ticket not issued yet: not confirmed to the customer (T08). */
  | 'ISSUING'
  | 'CONFIRMED'
  | 'PRICE_CHANGED'
  | 'EXPIRED'
  | 'FAILED'
  /** A confirmed booking that was cancelled afterwards (by us at the customer's request, or at the provider). */
  | 'CANCELLED'
  | 'NEEDS_ATTENTION';

export interface OrderView {
  orderId: string;
  stage: OrderStage;
  /** True when the customer may have a payment authorization without a booking (provider releases it). */
  paymentHoldMayExist: boolean;
  /** Hotels: the provider booking id. Flights: the airline booking code (PNR), shown once ticketed. */
  bookingReference: string | null;
  voucherReady: boolean;
  payBy: string | null;
  quote: QuoteView | FlightQuoteView;
  /** Flights only: issued ticket numbers (empty until ticketed or when the provider does not report them). */
  ticketNumbers: readonly string[];
}

/** Online cancellation of a hotel booking by its customer (T27, ADR-0021). */
export type CustomerCancellationView =
  /** Can be cancelled now. A fee above zero must be accepted exactly as shown. */
  | { state: 'AVAILABLE'; expectedFee: MoneyJson; paid: MoneyJson; freeUntil: string | null }
  /** A cancellation was sent and its result is being checked. */
  | { state: 'IN_PROGRESS' }
  /** Not offered online: nothing would be refunded, or the stay has started. */
  | { state: 'NOT_AVAILABLE'; reason: 'NO_REFUND' | 'STAY_STARTED' };

export interface CustomerCancelResult {
  /** CANCELLED: done. REJECTED: the provider refused; the booking stands and our team is told. UNKNOWN: being checked. */
  outcome: 'CANCELLED' | 'PENDING' | 'REJECTED' | 'UNKNOWN';
  order: OrderView;
  cancellation: CustomerCancellationView | null;
}

// ---------------------------------------------------------------- flights

export type PassengerType = 'ADULT' | 'CHILD' | 'INFANT';

export interface FlightSegmentView {
  origin: { code: string; name: string | null };
  destination: { code: string; name: string | null };
  /** Airport-local date-time as published (no offset). */
  departureLocal: string;
  arrivalLocal: string;
  carrier: { code: string; name: string | null };
  /** Set when another airline operates the flight. */
  operatedBy: string | null;
  flightNumber: string | null;
  durationMinutes: number | null;
  cabin: string | null;
  /** En-route technical stops inside the segment. */
  stopCount: number;
}

export interface FlightJourneyView {
  direction: 'OUTBOUND' | 'INBOUND';
  departure: { code: string; name: string | null; local: string };
  arrival: { code: string; name: string | null; local: string };
  /** Changes of aircraft (segments - 1). */
  connections: number;
  segments: readonly FlightSegmentView[];
}

/** Fare rules as published; fee amounts are usually not published and come from a cancellation quote later. */
export interface FlightTermsView {
  refundable: boolean;
  changeable: boolean;
  refundFee: boolean;
  changeFee: boolean;
}

export interface FlightOfferView {
  key: string;
  total: MoneyJson;
  perPassenger: Readonly<Partial<Record<PassengerType, MoneyJson>>>;
  journeys: readonly FlightJourneyView[];
  terms: FlightTermsView;
  baggage: ReadonlyArray<{ bagType: string; pieces: number; weightKg: number | null }>;
  fareFamily: string | null;
  seatsRemaining: number | null;
}

export interface FlightCriteriaView {
  origin: string;
  destination: string;
  departDate: string;
  returnDate: string | null;
  adults: number;
  childAges: readonly number[];
  infantAges: readonly number[];
  cabinClass: string | null;
}

export interface FlightSearchView {
  sessionId: string;
  expiresAt: string;
  currency: string;
  paymentMode: 'PROVIDER_MANAGED';
  criteria: FlightCriteriaView;
  offers: readonly FlightOfferView[];
  /** Offers left out because they could not be priced exactly under the approved policy. */
  hidden: { notPriced: number };
}

/** A seat or bag on the booking (customer wording; no provider ids). */
export interface FlightServiceLine {
  passengerIndex: number;
  category: 'SEAT' | 'BAGGAGE';
  /** Provider wording, e.g. "Seat 12A", "Checked bag 20kg". */
  name: string;
  seat: string | null;
  baggage: { pieces: number; weightKg: number | null } | null;
  /** "IST → AYT" for the flight the service belongs to; null when not stated. */
  segment: string | null;
  price: MoneyJson;
}

/** Seats and bags the customer may still add before paying (ADR-0013). */
export interface FlightServicesOfferView {
  orderId: string;
  /** False: nothing to offer any more (go to the payment page). */
  open: boolean;
  currency: string;
  /** What the payment charges now (fare plus services already added). */
  current: MoneyJson;
  passengers: ReadonlyArray<{ index: number; type: PassengerType; name: string }>;
  segments: ReadonlyArray<{
    label: string;
    seats: ReadonlyArray<{ key: string; number: string; row: number | null; column: string | null; type: string | null; available: boolean; price: MoneyJson; forType: 'ALL' | PassengerType }>;
    bags: ReadonlyArray<{ key: string; name: string; pieces: number; weightKg: number | null; price: MoneyJson; forType: 'ALL' | PassengerType }>;
  }>;
  added: readonly FlightServiceLine[];
  /** Services can be added until then (provider), never later than the payment deadline. */
  until: string | null;
}

export interface FlightQuoteView {
  product: 'FLIGHT';
  quoteVersionId: string;
  expiresAt: string;
  /** "IST → AYT" */
  title: string;
  journeys: readonly FlightJourneyView[];
  passengers: { adults: number; childAges: readonly number[]; infantAges: readonly number[] };
  cabinClass: string | null;
  total: MoneyJson;
  perPassenger: Readonly<Partial<Record<PassengerType, MoneyJson>>>;
  terms: FlightTermsView;
  baggage: ReadonlyArray<{ bagType: string; pieces: number; weightKg: number | null }>;
  fareFamily: string | null;
  /** The airline's price when the fare was checked differed from the search result (shown before acceptance). */
  priceChangedFrom: MoneyJson | null;
  /** Seats and bags added before payment; `fare` is the total without them. */
  services: readonly FlightServiceLine[];
  fare: MoneyJson;
  termsVersion: string;
  paymentProvider: 'NUITEE';
}

export type PaymentSessionView =
  | { state: 'READY'; provider: 'NUITEE'; publicKey: 'live' | 'sandbox' | 'mock'; secretKey: string; payBy: string | null }
  | { state: 'NOT_READY' | 'CLOSED'; stage: OrderStage };
