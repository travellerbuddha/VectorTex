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
  termsVersion: string;
  paymentProvider: 'NUITEE';
}

export type PaymentSessionView =
  | { state: 'READY'; provider: 'NUITEE'; publicKey: 'live' | 'sandbox' | 'mock'; secretKey: string; payBy: string | null }
  | { state: 'NOT_READY' | 'CLOSED'; stage: OrderStage };
