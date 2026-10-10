import type { Money } from '@texholiday/pricing';
import type { CancellationPolicySnapshot, OpaqueRef, ProductType, ProviderEnvironment, ProviderManagedTransactionRef } from '../common';
import type { ExternalOutcome } from '../outcome';

/**
 * Whether an operation has side effects upstream. Side-effecting operations need a persisted intent first.
 * CREATES_PROVIDER_SESSION: creates a provider-side session (quote/prebook) that is not a reservation and
 * holds no money of ours, so an abandoned one has no consequence.
 */
export type OperationEffect = 'READ_ONLY' | 'CREATES_PROVIDER_SESSION' | 'CREATES_PROVIDER_RESERVATION' | 'CANCELS_PROVIDER_RESERVATION' | 'MODIFIES_PROVIDER_RESERVATION';

/**
 * How a lost response of a side-effecting call can be resolved.
 * - CLIENT_REFERENCE_LOOKUP: query by our unique client reference (Nuitee hotel, Welcome).
 * - DOCUMENTED_IDEMPOTENCY_KEY: the provider documents safe replay with the same key.
 * - NONE: only manual reconciliation; the call must never be repeated automatically.
 */
export type LostResponseResolution = 'CLIENT_REFERENCE_LOOKUP' | 'DOCUMENTED_IDEMPOTENCY_KEY' | 'NONE';

export interface OperationSpec {
  effect: OperationEffect;
  lostResponse: LostResponseResolution;
}

/**
 * - NONE: no hold step.
 * - PREBOOK_VALIDATION: prebook validates price/availability; inventory is NOT guaranteed (PREPARED).
 * - INVENTORY_HOLD: the provider documents a real inventory hold with expiry (HELD).
 */
export type HoldSemantics = 'NONE' | 'PREBOOK_VALIDATION' | 'INVENTORY_HOLD';

export interface ConnectorDescriptor {
  connectorId: string;
  providerId: string;
  productType: ProductType;
  environment: ProviderEnvironment;
  isMock: boolean;
  /** Sources (sources.lock.json ids) the request/response schemas were built from. */
  requiredSources: readonly string[];
  operations: Readonly<Record<string, OperationSpec>>;
  holdSemantics: HoldSemantics;
  /** Lower = easier/cheaper to undo. Used to order package confirmation (§13.8). */
  reversibilityRank: number;
  /** Upper bound of asynchronous confirmation in seconds, if the provider documents one; null = unknown. */
  maxAsyncConfirmationSeconds: number | null;
  /** Whether a confirmed booking requires a separate issuance (flight ticketing) before it is final. */
  requiresIssuance: boolean;
}

/** Normalized provider booking result. PNR/booking id alone is not a ticket (T08). */
export interface ProviderBookingState {
  status: 'PREPARED' | 'HELD' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'ISSUED' | 'CANCEL_PENDING' | 'CANCELLED' | 'FAILED';
  providerBookingRef: OpaqueRef | null;
  clientReference: string;
  pnr: string | null;
  ticketNumbers: readonly string[];
  /** Ticket issuance (flights). NOT_APPLICABLE for products without issuance. */
  ticketingStatus: 'NOT_APPLICABLE' | 'PENDING' | 'ISSUED' | 'FAILED';
  voucherReady: boolean;
  holdExpiresAt: string | null;
  supplierCost: Money | null;
  /** Commission the provider reports on this booking (paid out to us later, ADR-0006); null if not reported. */
  providerCommission: Money | null;
}

/** How the supplier is paid for a booking. Each product exposes only the variants it documents. */
export type HotelFunding = { kind: 'ACCOUNT_CARD' } | { kind: 'CREDIT_LINE' } | { kind: 'PROVIDER_MANAGED'; transaction: ProviderManagedTransactionRef };
export type FlightFunding = { kind: 'PROVIDER_MANAGED'; transaction: ProviderManagedTransactionRef } | { kind: 'ACCOUNT_CARD' } | { kind: 'CREDIT_LINE' };
/**
 * Experiences: the current public contract documents only the provider-managed flow. Independent
 * funding variants are intentionally absent until G03 (no hotel CREDIT enum copied here).
 */
export type ExperienceFunding = { kind: 'PROVIDER_MANAGED'; transaction: ProviderManagedTransactionRef };
export type TransferFunding = { kind: 'CREDIT_LINE' };

export interface QuotedOffer {
  offerRef: OpaqueRef;
  productType: ProductType;
  price: Money;
  /** Margin the provider already applied to `price`; zero for net rates. */
  providerAppliedMargin: Money;
  suggestedSellingPrice: Money | null;
  payAtProperty: readonly Money[];
  cancellation: CancellationPolicySnapshot;
  expiresAt: string | null;
}

// ---------------- Hotel ----------------

export interface HotelOccupancy {
  /** 1-based, in the order the rooms were searched (§8). */
  occupancyNumber: number;
  adults: number;
  childAges: readonly number[];
}

export interface HotelSearchCriteria {
  /** Exactly one target: hotel ids, a place id (from place search) or a country/city. */
  hotelIds?: readonly string[];
  placeId?: string;
  city?: { countryCode: string; cityName: string };
  checkin: string;
  checkout: string;
  occupancies: readonly HotelOccupancy[];
  guestNationality: string;
  currency: string;
  margin: { basisPoints: number } | null;
  /** Listing pages: cheapest N rates per hotel. */
  maxRatesPerHotel?: number;
  /** Maximum number of hotels. */
  limit?: number;
}

/** Hotel content returned with a rates search (name, photo, address, rating). */
export interface HotelSummary {
  hotelId: string;
  name: string;
  mainPhoto: string | null;
  thumbnail: string | null;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  rating: number | null;
  stars: number | null;
}

/** One room offer in a hotel search, with what the customer sees about the room. */
export type HotelOffer = QuotedOffer & {
  hotelId: string;
  occupancyNumbers: readonly number[];
  room: { name: string | null; boardType: string | null; boardName: string | null };
  /** Provider payment types accepted for this offer (e.g. NUITEE_PAY, TRANSACTION_ID, ACC_CREDIT_CARD). */
  paymentTypes: readonly string[];
};

export interface PlaceSuggestion {
  placeId: string;
  name: string;
  address: string;
  types: readonly string[];
}

export interface HotelRoomGuest {
  occupancyNumber: number;
  leadGuest: { firstName: string; lastName: string; email: string };
}

export interface HotelConnector {
  descriptor(): ConnectorDescriptor;
  searchRates(criteria: HotelSearchCriteria): Promise<ExternalOutcome<readonly HotelOffer[]>>;
  /** Rates plus hotel content for listing pages. */
  searchHotelRates(criteria: HotelSearchCriteria): Promise<ExternalOutcome<{ offers: readonly HotelOffer[]; hotels: readonly HotelSummary[] }>>;
  /** Destination autocomplete. */
  searchPlaces(input: { text: string; language: string }): Promise<ExternalOutcome<readonly PlaceSuggestion[]>>;
  prebook(input: { offerRef: OpaqueRef; usePaymentSdk: boolean; clientReference: string }): Promise<
    ExternalOutcome<{
      prebookRef: OpaqueRef;
      offer: QuotedOffer;
      providerManagedTransaction: ProviderManagedTransactionRef | null;
      /** usePaymentSdk only: short-lived secret for the provider payment component (never our API key). */
      paymentClientSecret: string | null;
      /** Provider-reported changes since search; any true flag needs a new customer acceptance. */
      changeFlags: { price: boolean; cancellation: boolean; board: boolean };
    }>
  >;
  book(input: {
    prebookRef: OpaqueRef;
    clientReference: string;
    holder: { firstName: string; lastName: string; email: string; phone: string };
    guests: readonly HotelRoomGuest[];
    funding: HotelFunding;
  }): Promise<ExternalOutcome<ProviderBookingState>>;
  lookupByClientReference(clientReference: string): Promise<ExternalOutcome<ProviderBookingState | null>>;
  getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>>;
  /**
   * `refundAmount` is the provider's `refund_amount` as reported (null when absent). Who receives it (our account card,
   * or the customer for payment-SDK bookings) is not documented and is never assumed.
   */
  cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null; refundAmount: Money | null }>>;
}

// ---------------- Flight ----------------

export type FlightPassengerType = 'ADULT' | 'CHILD' | 'INFANT';
export type FlightCabin = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';

export interface FlightSearchCriteria {
  /** One leg = one way; two legs = return or open jaw. Dates are local departure dates (YYYY-MM-DD). */
  legs: ReadonlyArray<{ origin: string; destination: string; date: string }>;
  adults: number;
  childAges: readonly number[];
  infantAges: readonly number[];
  cabinClass: FlightCabin | null;
  /** Point of sale (ISO 3166-1 alpha-2); null = provider default. */
  pointOfSale: string | null;
  currency: string;
  /** Fare markup the provider adds to the price (approved pricing policy, ADR-0006); null = no markup. */
  margin: { basisPoints: number } | null;
}

export interface FlightSegment {
  segmentKey: string;
  direction: 'OUTBOUND' | 'INBOUND';
  origin: { code: string; name: string | null };
  destination: { code: string; name: string | null };
  /** Airport-local times as the provider sends them (no offset). */
  departureLocal: string;
  arrivalLocal: string;
  marketingCarrier: { code: string; name: string | null };
  operatingCarrier: { code: string; name: string | null };
  flightNumber: string | null;
  durationMinutes: number | null;
  /** En-route technical stops inside the segment (0 = non-stop). */
  stopCount: number;
  cabin: string | null;
  fareFamily: string | null;
}

/** Fare rules as published with the offer. Amounts of refund/change fees are often not published. */
export interface FlightTerms {
  refundable: boolean;
  changeable: boolean;
  /** The provider signalled a refund/change fee, even when the amount is not published. */
  hasRefundFee: boolean;
  hasChangeFee: boolean;
  /** Provider wording with severity (info/warning/danger); shown only after review of the wording. */
  summary: ReadonlyArray<{ level: string; message: string }>;
}

export interface FlightBaggage {
  /** personal, cabin or checked (provider wording kept). */
  bagType: string;
  pieces: number;
  weightKg: number | null;
  passengerType: string | null;
}

/**
 * A priced flight offer. `price` is the total for all passengers including the provider-added markup and any platform
 * fees passed on. No cancellation schedule exists for flights: the cost of a cancellation is known only from a
 * cancellation quote after booking.
 */
export interface FlightOffer {
  offerRef: OpaqueRef;
  journeyKey: string;
  price: Money;
  /** Supplier values (never include the markup). */
  supplier: { base: Money; taxes: Money; fees: Money };
  /**
   * The markup in `price`: price - (base + taxes + fees). The provider does not send the amount, but documents that
   * only the total carries it; sandbox 2026-10-10 matched a 10% rateSearch to within rounding on 132 offers.
   */
  appliedMarkup: Money;
  perPassenger: Readonly<Partial<Record<FlightPassengerType, Money>>>;
  segments: readonly FlightSegment[];
  terms: FlightTerms;
  includedBaggage: readonly FlightBaggage[];
  fareFamily: string | null;
  seatsRemaining: number | null;
  /** The offer id stops working at this instant (search again). */
  expiresAt: string | null;
}

export interface FlightVerification {
  offer: FlightOffer;
  /** Any true flag needs a new customer acceptance before prebook. */
  changes: { price: boolean; fare: boolean; cabin: boolean; messages: readonly string[] };
}

/** Passenger as on the travel document. Collected only under the approved identity policy (G06). */
export interface FlightPassenger {
  type: FlightPassengerType;
  firstName: string;
  lastName: string;
  middleName: string | null;
  birthDate: string;
  gender: 'M' | 'F';
  nationality: string;
  document: { type: 'passport' | 'id_card'; number: string; issuingCountry: string; expiresOn: string } | null;
}

export interface FlightContact {
  email: string;
  firstName: string;
  lastName: string;
  /** Without "+" (e.g. 90). */
  phoneCountryCode: string;
  phoneNumber: string;
}

export interface FlightPrebook {
  prebookRef: OpaqueRef;
  /** What the payment component charges (prebook price and currency). Compared with the accepted quote by the caller. */
  amountToCharge: Money;
  providerManagedTransaction: ProviderManagedTransactionRef | null;
  /** usePaymentSdk only: short-lived secret for the provider payment component (never our API key). */
  paymentClientSecret: string | null;
  paymentTypes: readonly string[];
  /** Seats/bags can be attached before booking (not offered yet). */
  servicesAttachable: boolean;
}

/** Provider booking state plus the flight facts operations need. PNR alone is not a ticket (T08). */
export type FlightBookingState = ProviderBookingState & {
  /** Provider booking reference shown to the customer (FH-…); null when the answer omitted it. */
  bookingReference: string | null;
  airlineLocators: ReadonlyArray<{ airline: string; pnr: string }>;
  ticketedAt: string | null;
  /** Ticket must be issued by then (provider deadline). */
  ticketLimitAt: string | null;
  /** A cancellation was requested and awaits airline confirmation. */
  cancelRequestedAt: string | null;
  /** Provider payment status as reported, unnormalized (documented: pending, completed, failed, not_required). */
  paymentStatus: string | null;
};

export interface FlightCancellationQuote {
  /** confirmed | estimated | heuristic | unknown (provider wording). */
  confidence: string;
  refundable: boolean;
  voidable: boolean;
  /** Potential maximum refund, not guaranteed; null when not quoted. */
  refund: Money | null;
  penalty: Money | null;
  /** Where refunded money goes (original_payment, agency_deposit, voucher, …); never assumed. */
  destination: string;
  vouchers: number;
  expiresAt: string | null;
}

export type FlightCancelResult = FlightBookingState & {
  penalty: Money | null;
  refundAmount: Money | null;
  destination: string | null;
  vouchers: number;
};

export interface FlightAirport {
  iata: string;
  name: string;
  city: string | null;
  country: string | null;
}

export interface FlightConnector {
  descriptor(): ConnectorDescriptor;
  /** Airport autocomplete (name, city or IATA code; at least 2 characters). */
  searchAirports(input: { text: string }): Promise<ExternalOutcome<readonly FlightAirport[]>>;
  searchRates(criteria: FlightSearchCriteria): Promise<ExternalOutcome<readonly FlightOffer[]>>;
  verify(input: { offerRef: OpaqueRef }): Promise<ExternalOutcome<FlightVerification>>;
  prebook(input: {
    offerRef: OpaqueRef;
    usePaymentSdk: boolean;
    contact: FlightContact;
    passengers: readonly FlightPassenger[];
  }): Promise<ExternalOutcome<FlightPrebook>>;
  /** Idempotent per prebook: a repeat returns the existing booking (the lost-response resolution). */
  book(input: { prebookRef: OpaqueRef; clientReference: string; funding: FlightFunding }): Promise<ExternalOutcome<FlightBookingState>>;
  getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightBookingState>>;
  cancellationQuote(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightCancellationQuote>>;
  /** CANCEL_PENDING while the airline has not confirmed (HTTP 202); repeats are idempotent while pending. */
  cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightCancelResult>>;
}

// ---------------- Experience ----------------

export interface ExperienceQuestion {
  id: string;
  label: string;
  required: boolean;
  appliesTo: 'BOOKING' | 'PARTICIPANT';
  /** Validation schema from the provider, preserved as-is for dynamic forms. */
  schema: unknown;
}

export interface ExperienceConnector {
  descriptor(): ConnectorDescriptor;
  bookingOptions(input: { productRef: OpaqueRef; date: string; participantCategories: Readonly<Record<string, number>>; currency: string }): Promise<
    ExternalOutcome<ReadonlyArray<QuotedOffer & { optionRef: OpaqueRef; startTime: string | null; questions: readonly ExperienceQuestion[] }>>
  >;
  prebook(input: {
    optionRef: OpaqueRef;
    clientReference: string;
    participants: ReadonlyArray<{ category: string; travelerId: string }>;
    answers: Readonly<Record<string, unknown>>;
  }): Promise<ExternalOutcome<{ prebookRef: OpaqueRef; offer: QuotedOffer; expiresAt: string | null; providerManagedTransaction: ProviderManagedTransactionRef | null }>>;
  book(input: { prebookRef: OpaqueRef; clientReference: string; funding: ExperienceFunding }): Promise<ExternalOutcome<ProviderBookingState>>;
  getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>>;
  lookupByClientReference(clientReference: string): Promise<ExternalOutcome<ProviderBookingState | null>>;
  cancelPreview(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<{ penalty: Money; refundToCustomerByProvider: Money | null }>>;
  cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { refundPending: boolean }>>;
}

// ---------------- Transfer ----------------

export interface TransferQuoteRequest {
  pickup: { kind: 'AIRPORT'; iata: string; flightNumber: string } | { kind: 'ADDRESS'; address: string; lat: number; lng: number };
  dropoff: { kind: 'AIRPORT'; iata: string } | { kind: 'ADDRESS'; address: string; lat: number; lng: number };
  /** Local date-time at pickup with its IANA timezone (DST checked, T11). */
  pickupLocal: { dateTime: string; timezone: string };
  passengers: number;
  luggage: number;
  childSeats: number;
  currency: string;
}

export interface TransferConnector {
  descriptor(): ConnectorDescriptor;
  /** Returns firm quotes only; estimates are flagged and cannot be sold (T12). */
  quote(input: TransferQuoteRequest): Promise<ExternalOutcome<ReadonlyArray<QuotedOffer & { firm: boolean; vehicleClass: string; capacity: number }>>>;
  book(input: {
    offerRef: OpaqueRef;
    bookingReference: string;
    passengerBookingReference: string;
    leadPassenger: { firstName: string; lastName: string; email: string; phone: string };
    funding: TransferFunding;
  }): Promise<ExternalOutcome<ProviderBookingState>>;
  lookupByReference(bookingReference: string): Promise<ExternalOutcome<ProviderBookingState | null>>;
  getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>>;
  cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null }>>;
}

export type AnyConnector = HotelConnector | FlightConnector | ExperienceConnector | TransferConnector;
