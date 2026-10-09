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
  bookingReference: string | null;
  voucherReady: boolean;
  payBy: string | null;
  quote: QuoteView;
}

export type PaymentSessionView =
  | { state: 'READY'; provider: 'NUITEE'; publicKey: 'live' | 'sandbox' | 'mock'; secretKey: string; payBy: string | null }
  | { state: 'NOT_READY' | 'CLOSED'; stage: OrderStage };
