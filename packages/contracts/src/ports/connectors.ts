import type { Money } from '@texholiday/pricing';
import type { CancellationPolicySnapshot, OpaqueRef, ProductType, ProviderEnvironment, ProviderManagedTransactionRef, TravelerRef } from '../common';
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
  hotelIds: readonly string[];
  checkin: string;
  checkout: string;
  occupancies: readonly HotelOccupancy[];
  guestNationality: string;
  currency: string;
  margin: { basisPoints: number } | null;
}

export interface HotelRoomGuest {
  occupancyNumber: number;
  leadGuest: { firstName: string; lastName: string; email: string };
}

export interface HotelConnector {
  descriptor(): ConnectorDescriptor;
  searchRates(criteria: HotelSearchCriteria): Promise<ExternalOutcome<readonly (QuotedOffer & { hotelId: string; occupancyNumbers: readonly number[] })[]>>;
  prebook(input: { offerRef: OpaqueRef; usePaymentSdk: boolean; clientReference: string }): Promise<
    ExternalOutcome<{
      prebookRef: OpaqueRef;
      offer: QuotedOffer;
      providerManagedTransaction: ProviderManagedTransactionRef | null;
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
  cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null; refundToUs: Money | null }>>;
}

// ---------------- Flight ----------------

export interface FlightConnector {
  descriptor(): ConnectorDescriptor;
  searchRates(criteria: {
    legs: ReadonlyArray<{ origin: string; destination: string; date: string }>;
    adults: number;
    childAges: readonly number[];
    infants: number;
    sellingCountry: string;
    currency: string;
  }): Promise<ExternalOutcome<readonly QuotedOffer[]>>;
  verify(input: { offerRef: OpaqueRef }): Promise<ExternalOutcome<QuotedOffer>>;
  prebook(input: { offerRef: OpaqueRef; clientReference: string; travelers: readonly TravelerRef[]; funding: FlightFunding['kind'] }): Promise<
    ExternalOutcome<{ prebookRef: OpaqueRef; offer: QuotedOffer; providerManagedTransaction: ProviderManagedTransactionRef | null }>
  >;
  book(input: { prebookRef: OpaqueRef; clientReference: string; funding: FlightFunding }): Promise<ExternalOutcome<ProviderBookingState>>;
  getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>>;
  lookupByClientReference(clientReference: string): Promise<ExternalOutcome<ProviderBookingState | null>>;
  cancellationQuote(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<{ penalty: Money; refundToUs: Money; quoteRef: OpaqueRef; expiresAt: string | null }>>;
  cancel(input: { providerBookingRef: OpaqueRef; quoteRef: OpaqueRef }): Promise<ExternalOutcome<ProviderBookingState>>;
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
