import {
  exactDecimal,
  fetchTransport,
  notAvailable,
  opaque,
  type CallEvidence,
  type ConnectorDescriptor,
  type ExternalOutcome,
  type FlightBaggage,
  type FlightBookingState,
  type FlightCancellationQuote,
  type FlightCancelResult,
  type FlightConnector,
  type FlightContact,
  type FlightFunding,
  type FlightOffer,
  type FlightPassenger,
  type FlightPassengerType,
  type FlightPrebook,
  type FlightSearchCriteria,
  type FlightSegment,
  type FlightVerification,
  type HttpTransport,
  type OpaqueRef,
  type ProviderBookingState,
  type ProviderManagedTransactionRef,
} from '@texholiday/contracts';
import { D, fromMajor, type Money } from '@texholiday/pricing';
import { classifyHttp, type ParsedHttp } from '../http-outcome';

/**
 * Nuitee (liteAPI) flights connector built from the pinned contracts: nuitee-openapi-flights (rates, verify, prebooks,
 * bookings, cancellations), nuitee-ref-flight-prebooks (payment options, platform fees), nuitee-guide-flight-experience
 * (payment lifecycle, idempotent booking), nuitee-guide-flights-support-billing (servicing) and
 * nuitee-guide-user-payment (payment component). Sandbox behaviour observed on 2026-10-09 is noted where it differs.
 */
export const NUITEE_FLIGHT_REQUIRED_SOURCES = [
  'nuitee-openapi-flights',
  'nuitee-ref-flight-prebooks',
  'nuitee-guide-flight-experience',
  'nuitee-guide-flights-support-billing',
  'nuitee-guide-user-payment',
] as const;

export interface NuiteeFlightConfig {
  apiKey: string;
  environment: 'sandbox' | 'production';
  /** https://api.liteapi.travel/v3.0 */
  baseUrl: string;
  /** Our wait for search/verify/prebook. The endpoints take no provider-side timeout parameter. */
  searchTimeoutSeconds: number;
  /** Our wait for book/get/cancel. Sandbox answered GET /flights/bookings/{id} in up to ~23 s (2026-10-09). */
  bookTimeoutSeconds: number;
}

type Json = Record<string, unknown>;
type Parsed = Extract<ParsedHttp, { ok: true }>['parsed'];

/** Documented "offer expired / search again" codes (verify 404, prebook 404, book 404). */
const OFFER_GONE_CODES = new Set([42004, 42015, 42017, 42018, 42019, 43004, 43015, 43017, 43019, 45029, 45063, 45084, 45033]);

const PASSENGER_TYPE: Record<FlightPassengerType, number> = { ADULT: 0, CHILD: 1, INFANT: 2 };
const PER_PASSENGER_KEY: Record<FlightPassengerType, string> = { ADULT: 'adult', CHILD: 'child', INFANT: 'infant' };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is Json => obj(x) !== null) : []);
const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

export class NuiteeFlightConnector implements FlightConnector {
  constructor(
    private readonly cfg: NuiteeFlightConfig,
    private readonly transport: HttpTransport = fetchTransport,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  descriptor(): ConnectorDescriptor {
    return {
      connectorId: 'nuitee-flight',
      providerId: 'nuitee',
      productType: 'FLIGHT',
      environment: this.cfg.environment,
      isMock: false,
      requiredSources: NUITEE_FLIGHT_REQUIRED_SOURCES,
      operations: {
        searchRates: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        verify: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        // "This is when the seat is held. The provider reservation is created here" (flight guide); nothing returns a
        // prebook without its id, so a lost answer cannot be found again. No money moves: paying needs its secret.
        prebook: { effect: 'CREATES_PROVIDER_RESERVATION', lostResponse: 'NONE' },
        // "Idempotent: returns the existing booking (HTTP 200) if one already exists for the given prebookId".
        book: { effect: 'CREATES_PROVIDER_RESERVATION', lostResponse: 'DOCUMENTED_IDEMPOTENCY_KEY' },
        getBooking: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        cancellationQuote: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        // "Retries while cancellation is still pending are idempotent"; GET shows cancelIntentAt / the final status.
        cancel: { effect: 'CANCELS_PROVIDER_RESERVATION', lostResponse: 'DOCUMENTED_IDEMPOTENCY_KEY' },
      },
      // The guide says the seat is held at prebook, but no hold expiry is returned: nothing relies on the hold.
      holdSemantics: 'PREBOOK_VALIDATION',
      // Fares are mostly non-refundable and a ticket cannot be undone like a hotel booking: confirm flights last.
      reversibilityRank: 90,
      // Not documented. Sandbox moved PENDING_CONFIRMATION -> CONFIRMED in ~1-3 minutes (2026-10-09).
      maxAsyncConfirmationSeconds: null,
      requiresIssuance: true,
    };
  }

  // ------------------------------------------------------------------ HTTP

  private async send(operation: string, method: 'GET' | 'POST', path: string, body: Json | null, timeoutSeconds: number): Promise<ParsedHttp> {
    const at = this.clock().toISOString();
    const result = await this.transport.send({
      method,
      url: `${this.cfg.baseUrl}${path}`,
      headers: { 'x-api-key': this.cfg.apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: timeoutSeconds * 1000,
    });
    // 4xx bodies carry the provider's numeric code, which decides between "search again" and other refusals.
    return classifyHttp(result, `nuitee.flight.${operation}`, this.cfg.environment, at, undefined, { passThrough4xx: true });
  }

  private errorOf(json: unknown): { code: number | null; message: string } | null {
    const e = obj(obj(json)?.error);
    if (!e) return null;
    return { code: int(e.code), message: String(e.description ?? e.message ?? 'error') };
  }

  /**
   * A 4xx answer is a definitive refusal; the provider code is kept for operations. 429 (4290 "too many requests",
   * seen in sandbox, not in the OpenAPI) is not a refusal of the request itself: UNKNOWN, so it is asked again later.
   */
  private refused(http: Extract<ParsedHttp, { ok: true }>): ExternalOutcome<never> {
    if (http.status === 429) return this.unknown(http.evidence);
    const err = this.errorOf(http.json);
    const code = err?.code ?? null;
    if (code !== null && OFFER_GONE_CODES.has(code)) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_OFFER_EXPIRED', message: err?.message ?? 'offer expired', evidence: http.evidence };
    return { kind: 'REJECTED', code: code !== null ? `NUITEE_${code}` : `HTTP_${http.status}`, message: err?.message ?? 'refused', evidence: http.evidence };
  }

  private unknown(evidence: CallEvidence, reason: 'AMBIGUOUS' | 'MALFORMED_RESPONSE' = 'AMBIGUOUS'): ExternalOutcome<never> {
    return { kind: 'UNKNOWN', reason, evidence };
  }

  private money(parsed: Parsed, o: Json | null, key: string, currency: unknown): Money | null {
    if (!o || typeof currency !== 'string') return null;
    const amount = exactDecimal(parsed, o, key);
    if (amount === null) return null;
    try {
      return fromMajor(amount, currency);
    } catch {
      return null;
    }
  }

  /** `{ display: { amount, currency } }` (cancellation quotes, vouchers). */
  private displayAmount(parsed: Parsed, v: unknown): Money | null {
    const display = obj(obj(v)?.display);
    return this.money(parsed, display, 'amount', display?.currency);
  }

  private envMatches(booking: Json): boolean {
    // A record from the other environment never updates ours (T15). The documented examples omit the field.
    const env = booking.providerEnvironment;
    return env === undefined || env === null || env === this.cfg.environment;
  }

  // ------------------------------------------------------------------ mapping

  private segments(journey: Json, segmentFares: Json[]): FlightSegment[] | null {
    const out: FlightSegment[] = [];
    for (const s of arr(journey.segments)) {
      const carrier = obj(s.carrier) ?? {};
      const origin = str(s.originCode);
      const destination = str(s.destinationCode);
      const departure = str(s.departureTime);
      const arrival = str(s.arrivalTime);
      const marketing = str(carrier.marketingCode);
      const key = str(s.segmentKey);
      if (!origin || !destination || !departure || !arrival || !marketing || !key) return null;
      const fare = segmentFares.find((f) => f.segmentKey === key);
      out.push({
        segmentKey: key,
        direction: s.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
        origin: { code: origin, name: str(s.originName) },
        destination: { code: destination, name: str(s.destinationName) },
        departureLocal: departure,
        arrivalLocal: arrival,
        marketingCarrier: { code: marketing, name: str(carrier.marketingName) },
        operatingCarrier: { code: str(carrier.operatingCode) ?? marketing, name: str(carrier.operatingName) ?? str(carrier.marketingName) },
        flightNumber: str(obj(s.flight)?.marketingNumber),
        durationMinutes: int(obj(s.duration)?.minutes),
        stopCount: int(s.stopCount) ?? 0,
        cabin: str(fare?.cabin),
        fareFamily: str(fare?.fareFamily),
      });
    }
    return out.length > 0 ? out : null;
  }

  /**
   * One offer of a journey. `journey` holds the segments; `offer` the price and rules (in verify both are the journey).
   * An offer we cannot price exactly, or priced in another currency than asked, is dropped: never shown with a guess.
   */
  private offer(parsed: Parsed, journey: Json, offer: Json, offerRef: OpaqueRef, currency: string | null, passengerTypes: readonly FlightPassengerType[]): FlightOffer | null {
    const display = obj(obj(offer.pricing)?.display);
    if (!display) return null;
    const cur = display.currency;
    if (typeof cur !== 'string' || (currency !== null && cur !== currency)) return null;
    const price = this.money(parsed, display, 'total', cur);
    const base = this.money(parsed, display, 'base', cur);
    const taxes = this.money(parsed, display, 'taxes', cur);
    const fees = this.money(parsed, display, 'fees', cur);
    if (!price || !base || !taxes || !fees || price.minor <= 0n) return null;
    const perPassenger: Partial<Record<FlightPassengerType, Money>> = {};
    const per = obj(display.perPassenger);
    for (const t of passengerTypes) {
      const p = obj(per?.[PER_PASSENGER_KEY[t]]);
      const m = this.money(parsed, p, 'total', p?.currency);
      if (!m || m.currency !== cur) return null;
      perPassenger[t] = m;
    }
    const segments = this.segments(journey, arr(offer.segmentFares));
    const terms = obj(offer.terms);
    const journeyKey = str(journey.journeyKey);
    if (!segments || !terms || !journeyKey || typeof terms.refundable !== 'boolean') return null;
    const fare = obj(offer.fare);
    const baggage: FlightBaggage[] = arr(obj(offer.baggage)?.included).map((b) => ({
      bagType: str(b.bagType) ?? 'unknown',
      pieces: int(b.pieces) ?? 0,
      weightKg: typeof b.weightKg === 'number' && Number.isFinite(b.weightKg) ? b.weightKg : null,
      passengerType: str(b.passengerType),
    }));
    const expiration = str(offer.expiration);
    return {
      offerRef,
      journeyKey,
      price,
      supplier: { base, taxes, fees },
      perPassenger,
      segments,
      terms: {
        refundable: terms.refundable,
        changeable: terms.changeable === true,
        hasRefundFee: terms.hasRefundFee === true || obj(terms.refundFee) !== null,
        hasChangeFee: terms.hasChangeFee === true || obj(terms.changeFee) !== null,
        summary: arr(terms.summary)
          .map((m) => ({ level: str(m.level) ?? 'info', message: str(m.message) ?? '' }))
          .filter((m) => m.message !== ''),
      },
      includedBaggage: baggage,
      fareFamily: str(fare?.family),
      seatsRemaining: int(fare?.seatsRemaining),
      expiresAt: expiration && !Number.isNaN(Date.parse(expiration)) ? new Date(expiration).toISOString() : null,
    };
  }

  private locators(booking: Json): Array<{ airline: string; pnr: string }> {
    const raw = [...arr(booking.airlineLocators), ...arr(obj(obj(booking.order)?.reference)?.airlineBookings)];
    const out: Array<{ airline: string; pnr: string }> = [];
    for (const l of raw) {
      const pnr = str(l.airlinePnr) ?? str(l.pnr);
      const airline = str(l.airlineCode);
      if (pnr && airline && !out.some((o) => o.airline === airline && o.pnr === pnr)) out.push({ airline, pnr });
    }
    return out;
  }

  /**
   * Normalized booking status (OpenAPI): CREATED and PENDING_CONFIRMATION are not confirmed yet; CONFIRMED includes
   * ticketed bookings (TICKETED -> CONFIRMED), so issuance is read from ticketData.ticketedAt / order.status, never from
   * a PNR (T08). Sandbox 2026-10-09/10: book answered PENDING_CONFIRMATION, GET then CREATED; later CONFIRMED with an
   * airline PNR and ticketData.ticketedAt about three minutes after booking (order.status stayed "created").
   */
  private bookingState(parsed: Parsed, b: Json, clientReference: string): FlightBookingState | null {
    const raw = typeof b.status === 'string' ? b.status.toUpperCase() : '';
    const bookingId = str(b.bookingId);
    if (!bookingId) return null;
    const ticketedAt = str(obj(b.ticketData)?.ticketedAt);
    const ticketed = ticketedAt !== null || str(obj(b.order)?.status)?.toLowerCase() === 'ticketed';
    const cancelRequestedAt = str(b.cancelIntentAt);
    let status: ProviderBookingState['status'];
    // cancelIntentAt on a booking that is not cancelled yet = cancellation requested, awaiting the airline (sandbox
    // 2026-10-09: also on CREATED bookings cancelled before confirmation).
    if ((raw === 'CREATED' || raw === 'PENDING_CONFIRMATION' || raw === 'CONFIRMED') && cancelRequestedAt) status = 'CANCEL_PENDING';
    else if (raw === 'CREATED' || raw === 'PENDING_CONFIRMATION') status = 'PENDING_CONFIRMATION';
    else if (raw === 'CONFIRMED') status = ticketed ? 'ISSUED' : 'CONFIRMED';
    else if (raw === 'CANCELLED' || raw === 'CANCELLED_WITH_CHARGES') status = 'CANCELLED';
    else return null;
    const pricing = obj(b.pricing);
    const locators = this.locators(b);
    const tags = obj(b.customTags);
    return {
      status,
      providerBookingRef: opaque(bookingId),
      clientReference: str(tags?.TH_REF) ?? clientReference,
      pnr: locators[0]?.pnr ?? null,
      // The OpenAPI documents a confirmation id and a timestamp only; sandbox (2026-10-10) also returned
      // ticketData.tickets[] with ticketNumber and status "issued". Read when present, never required.
      ticketNumbers: arr(obj(b.ticketData)?.tickets)
        .filter((t) => str(t.status)?.toLowerCase() !== 'void')
        .map((t) => str(t.ticketNumber))
        .filter((n): n is string => n !== null),
      ticketingStatus: ticketed ? 'ISSUED' : status === 'CANCELLED' ? 'NOT_APPLICABLE' : 'PENDING',
      voucherReady: ticketed && status !== 'CANCELLED',
      holdExpiresAt: null,
      // "Grand total charged to the customer" (pricing.totalAmount). payment.amount is not used: sandbox reported it
      // ~3% below totalAmount with no documented reason (saglayici-sorulari).
      supplierCost: this.money(parsed, pricing, 'totalAmount', pricing?.currency),
      // distributorCommission has no documented currency and was never returned in sandbox: not mapped.
      providerCommission: null,
      bookingReference: str(b.bookingRef),
      airlineLocators: locators,
      ticketedAt,
      ticketLimitAt: str(b.ticketLimitTime) ?? str(obj(b.order)?.ticketLimitTime),
      cancelRequestedAt,
      paymentStatus: str(b.paymentStatus),
    };
  }

  private passengerTypes(c: { adults: number; childAges: readonly number[]; infantAges: readonly number[] }): FlightPassengerType[] {
    return [...(c.adults > 0 ? (['ADULT'] as const) : []), ...(c.childAges.length > 0 ? (['CHILD'] as const) : []), ...(c.infantAges.length > 0 ? (['INFANT'] as const) : [])];
  }

  // ------------------------------------------------------------------ operations

  async searchRates(criteria: FlightSearchCriteria): Promise<ExternalOutcome<readonly FlightOffer[]>> {
    if (criteria.legs.length === 0 || criteria.legs.some((l) => !IATA.test(l.origin) || !IATA.test(l.destination) || !DATE.test(l.date) || l.origin === l.destination)) {
      return notAvailable('FLIGHT_LEGS', 'Each leg needs IATA origin/destination codes and a YYYY-MM-DD date');
    }
    if (!Number.isInteger(criteria.adults) || criteria.adults < 1) return notAvailable('PASSENGERS', 'At least one adult');
    // "number of infants cannot exceed number of adults, each infant must be accompanied by an adult" (41012).
    if (criteria.infantAges.length > criteria.adults) return notAvailable('PASSENGERS', 'One infant per adult at most');
    if ([...criteria.childAges, ...criteria.infantAges].some((a) => !Number.isInteger(a) || a < 0)) return notAvailable('PASSENGERS', 'Ages must be whole years');
    if (!/^[A-Z]{3}$/.test(criteria.currency)) return notAvailable('CURRENCY', 'ISO 4217 currency code');
    if (criteria.pointOfSale !== null && !COUNTRY.test(criteria.pointOfSale)) return notAvailable('POINT_OF_SALE', 'ISO 3166-1 alpha-2 country code');
    const body: Json = {
      legs: criteria.legs.map((l) => ({ origin: l.origin, destination: l.destination, date: l.date })),
      adults: criteria.adults,
      ...(criteria.childAges.length > 0 ? { children: criteria.childAges.length, childrenAges: [...criteria.childAges] } : {}),
      ...(criteria.infantAges.length > 0 ? { infants: criteria.infantAges.length, infantAges: [...criteria.infantAges] } : {}),
      ...(criteria.cabinClass ? { cabinClass: criteria.cabinClass } : {}),
      currency: criteria.currency,
      ...(criteria.pointOfSale ? { country: criteria.pointOfSale } : {}),
      // Always explicit: rateSearch "takes precedence over any airline/route overrides configured for your account", so
      // only the approved pricing policy decides the fare markup (ADR-0006). Seat, bag and penalty markups are not sent
      // and follow the account configuration (business input, G06).
      margin: { rateSearch: criteria.margin ? new D(criteria.margin.basisPoints).div(100).toNumber() : 0 },
    };
    const http = await this.send('searchRates', 'POST', '/flights/rates', body, this.cfg.searchTimeoutSeconds);
    if (!http.ok) return http.outcome;
    if (http.status >= 400) return this.refused(http);
    if (http.status === 204) return { kind: 'SUCCEEDED', value: [], evidence: http.evidence };
    const data = obj(http.json)?.data;
    if (!Array.isArray(data)) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const types = this.passengerTypes(criteria);
    const offers: FlightOffer[] = [];
    const seen = new Set<string>();
    for (const group of arr(data)) {
      for (const journey of arr(group.journeys)) {
        const candidates = [...arr(journey.offers), ...(obj(journey.cheapestOffer) ? [journey.cheapestOffer as Json] : [])];
        for (const o of candidates) {
          const id = str(o.offerId);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const mapped = this.offer(http.parsed, journey, o, opaque(id), criteria.currency, types);
          if (mapped) offers.push(mapped);
        }
      }
    }
    return { kind: 'SUCCEEDED', value: offers, evidence: http.evidence };
  }

  async verify(input: { offerRef: OpaqueRef }): Promise<ExternalOutcome<FlightVerification>> {
    const http = await this.send('verify', 'POST', '/flights/verify', { offerId: input.offerRef }, this.cfg.searchTimeoutSeconds);
    if (!http.ok) return http.outcome;
    if (http.status >= 400) return this.refused(http);
    const item = arr(obj(http.json)?.data)[0];
    const journey = obj(item?.journey);
    if (!item || !journey) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const counts = obj(journey.passengers);
    const types: FlightPassengerType[] = [
      ...((int(counts?.adults) ?? 1) > 0 ? (['ADULT'] as const) : []),
      ...((int(counts?.children) ?? 0) > 0 ? (['CHILD'] as const) : []),
      ...((int(counts?.infants) ?? 0) > 0 ? (['INFANT'] as const) : []),
    ];
    // "The offerId is not returned in the JSON body (use the same id you sent)".
    const offer = this.offer(http.parsed, journey, journey, input.offerRef, null, types);
    if (!offer) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const changes = obj(item.changes);
    return {
      kind: 'SUCCEEDED',
      value: {
        offer,
        changes: {
          price: changes?.priceChanged === true,
          fare: changes?.fareChanged === true,
          cabin: changes?.cabinChanged === true,
          messages: Array.isArray(changes?.messages) ? (changes.messages as unknown[]).filter((m): m is string => typeof m === 'string') : [],
        },
      },
      evidence: http.evidence,
    };
  }

  private passengerBody(p: FlightPassenger): Json | string {
    if (!str(p.firstName) || !str(p.lastName)) return 'Passenger names are required (as on the travel document)';
    if (!DATE.test(p.birthDate)) return 'Birth date must be YYYY-MM-DD';
    if (p.gender !== 'M' && p.gender !== 'F') return 'Gender must be M or F (provider contract)';
    if (!COUNTRY.test(p.nationality)) return 'Nationality must be an ISO country code';
    if (p.document && (!str(p.document.number) || !COUNTRY.test(p.document.issuingCountry) || !DATE.test(p.document.expiresOn))) return 'Document number, issuing country and expiry are required';
    return {
      firstName: p.firstName.trim(),
      lastName: p.lastName.trim(),
      ...(p.middleName ? { middleName: p.middleName.trim() } : {}),
      birthday: p.birthDate,
      gender: p.gender,
      nationality: p.nationality,
      passengerType: PASSENGER_TYPE[p.type],
      ...(p.document
        ? { documentType: p.document.type, documentNumber: p.document.number.trim(), documentIssueCountry: p.document.issuingCountry, documentExpiry: p.document.expiresOn }
        : {}),
    };
  }

  async prebook(input: { offerRef: OpaqueRef; usePaymentSdk: boolean; contact: FlightContact; passengers: readonly FlightPassenger[] }): Promise<ExternalOutcome<FlightPrebook>> {
    const c = input.contact;
    if (!str(c.firstName) || !str(c.lastName) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return notAvailable('CONTACT', 'Contact name and e-mail are required');
    // Sandbox 2026-10-09: a placeholder number was refused as HTTP 500 (53099), i.e. as an unknown outcome.
    if (!/^\d{1,4}$/.test(c.phoneCountryCode) || !/^\d{6,14}$/.test(c.phoneNumber)) return notAvailable('CONTACT', 'Phone country code and number, digits only');
    if (input.passengers.length === 0 || !input.passengers.some((p) => p.type === 'ADULT')) return notAvailable('PASSENGERS', 'At least one adult passenger');
    const passengers: Json[] = [];
    for (const p of input.passengers) {
      const body = this.passengerBody(p);
      if (typeof body === 'string') return notAvailable('PASSENGERS', body);
      passengers.push(body);
    }
    const http = await this.send(
      'prebook',
      'POST',
      '/flights/prebooks',
      {
        offerId: input.offerRef,
        usePaymentSdk: input.usePaymentSdk,
        contact: { email: c.email.trim(), firstName: c.firstName.trim(), lastName: c.lastName.trim(), phoneCountryCode: c.phoneCountryCode, phoneNumber: c.phoneNumber },
        passengers,
      },
      this.cfg.searchTimeoutSeconds,
    );
    // No answer: a provider reservation may exist, but without its id and secret nobody can pay or book it.
    if (!http.ok) return http.outcome;
    if (http.status >= 400) return this.refused(http);
    const d = arr(obj(http.json)?.data)[0];
    const prebookId = str(d?.prebookId);
    if (!d || !prebookId) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    // "price: Total price to charge (in the currency field)"; "currency: ISO 4217 code for price and secretKey".
    const amountToCharge = this.money(http.parsed, d, 'price', d.currency);
    if (!amountToCharge) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    let tx: ProviderManagedTransactionRef | null = null;
    let secret: string | null = null;
    if (input.usePaymentSdk) {
      const transactionId = str(d.transactionId);
      secret = str(d.secretKey);
      if (!transactionId || !secret) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
      tx = { __brand: 'ProviderManagedTransactionRef', providerId: 'nuitee', productType: 'FLIGHT', prebookRef: opaque(prebookId), transactionId: opaque(transactionId), environment: this.cfg.environment };
    }
    const services = obj(d.servicesAttachable);
    return {
      kind: 'SUCCEEDED',
      value: {
        prebookRef: opaque(prebookId),
        amountToCharge,
        providerManagedTransaction: tx,
        paymentClientSecret: secret,
        paymentTypes: Array.isArray(d.paymentTypes) ? (d.paymentTypes as unknown[]).filter((t): t is string => typeof t === 'string') : [],
        servicesAttachable: services !== null && arr(services.groups).length > 0,
      },
      evidence: http.evidence,
    };
  }

  private paymentFor(funding: FlightFunding, prebookRef: OpaqueRef): { ok: true; payment: Json } | { ok: false; refused: string } {
    switch (funding.kind) {
      case 'PROVIDER_MANAGED': {
        const t = funding.transaction;
        if (t.providerId !== 'nuitee' || t.productType !== 'FLIGHT' || t.prebookRef !== prebookRef || t.environment !== this.cfg.environment) {
          return { ok: false, refused: 'Transaction does not belong to this Nuitee flight prebook/environment' };
        }
        return { ok: true, payment: { method: 'TRANSACTION_ID', transactionId: t.transactionId } };
      }
      case 'ACCOUNT_CARD':
        return { ok: true, payment: { method: 'ACC_CREDIT_CARD' } };
      case 'CREDIT_LINE':
        // Credit-line bookings are real bookings; never outside production.
        if (this.cfg.environment !== 'production') return { ok: false, refused: 'CREDIT is never used outside production (it books for real)' };
        return { ok: true, payment: { method: 'CREDIT' } };
    }
  }

  /**
   * Books a paid prebook. The documented lost-response resolution is to repeat this call with the same prebook: the
   * provider returns the existing booking (HTTP 200). 409 (concurrent book, duplicate, already ticketed) and 5xx are
   * UNKNOWN for the same reason. A 4xx refusal after the customer paid means "paid, not booked": the caller hands it to
   * operations (the refund path is a provider question, saglayici-sorulari).
   *
   * Sandbox 2026-10-09: a booking sent before any payment was accepted and confirmed (paymentStatus "succeeded", then
   * "completed"); the guide says production fails it. Callers therefore book only after the payment component returned.
   */
  async book(input: { prebookRef: OpaqueRef; clientReference: string; funding: FlightFunding }): Promise<ExternalOutcome<FlightBookingState>> {
    const funding = this.paymentFor(input.funding, input.prebookRef);
    if (!funding.ok) return notAvailable('FUNDING', funding.refused);
    if (!/^[\w.:-]{6,64}$/.test(input.clientReference)) return notAvailable('CLIENT_REFERENCE', 'clientReference must be a unique 6-64 character id');
    const http = await this.send(
      'book',
      'POST',
      // The documented path answers 307 -> "/v3.0/flights/bookings/" (sandbox, 2026-10-09); our transport never
      // follows redirects (the API key must not travel), so the canonical path is called directly.
      '/flights/bookings/',
      // customTags: "up to 5 user-defined key/value labels persisted with the booking" -> our reference for audit.
      { prebookId: input.prebookRef, payment: funding.payment, customTags: { TH_REF: input.clientReference } },
      this.cfg.bookTimeoutSeconds,
    );
    if (!http.ok) return http.outcome;
    if (http.status === 409) return this.unknown(http.evidence);
    if (http.status >= 400) return this.refused(http);
    const booking = obj(arr(obj(http.json)?.data)[0]?.booking);
    if (!booking || !this.envMatches(booking)) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const state = this.bookingState(http.parsed, booking, input.clientReference);
    if (!state) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    // The prebook is ours alone; a booking carrying another reference of ours needs a person to look at it.
    if (state.clientReference !== input.clientReference) return this.unknown(http.evidence);
    return { kind: 'SUCCEEDED', value: state, evidence: http.evidence };
  }

  async getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightBookingState>> {
    const http = await this.send('getBooking', 'GET', `/flights/bookings/${encodeURIComponent(providerBookingRef)}`, null, this.cfg.bookTimeoutSeconds);
    if (!http.ok) return http.outcome;
    if (http.status === 404) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_BOOKING_NOT_FOUND', message: this.errorOf(http.json)?.message ?? 'booking not found', evidence: http.evidence };
    if (http.status >= 400) return this.refused(http);
    const booking = obj(arr(obj(http.json)?.data)[0]?.booking);
    if (!booking || !this.envMatches(booking) || booking.bookingId !== providerBookingRef) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const state = this.bookingState(http.parsed, booking, '');
    return state ? { kind: 'SUCCEEDED', value: state, evidence: http.evidence } : this.unknown(http.evidence, 'MALFORMED_RESPONSE');
  }

  /** Sandbox 2026-10-09: answered HTTP 500 (59099) for confirmed and cancelled bookings alike -> UNKNOWN. */
  async cancellationQuote(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightCancellationQuote>> {
    const http = await this.send('cancellationQuote', 'GET', `/flights/bookings/${encodeURIComponent(providerBookingRef)}/cancellations`, null, this.cfg.bookTimeoutSeconds);
    if (!http.ok) return http.outcome;
    if (http.status >= 400) return this.refused(http);
    const q = arr(obj(http.json)?.data)[0];
    const confidence = str(q?.confidence);
    if (!q || !confidence) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const expiresAt = str(q.expiresAt);
    return {
      kind: 'SUCCEEDED',
      value: {
        confidence,
        refundable: q.isRefundable === true,
        voidable: q.isVoidable === true,
        refund: this.displayAmount(http.parsed, q.refund),
        penalty: this.displayAmount(http.parsed, q.penalty),
        destination: str(q.destination) ?? 'unknown',
        vouchers: arr(q.vouchers).length,
        expiresAt: expiresAt && !Number.isNaN(Date.parse(expiresAt)) ? new Date(expiresAt).toISOString() : null,
      },
      evidence: http.evidence,
    };
  }

  /**
   * HTTP 200 = final (CANCELLED / CANCELLED_WITH_CHARGES), HTTP 202 = accepted, awaiting the airline (the booking keeps
   * its status, with cancelIntentAt). 409 covers "already cancelled", "concurrent cancellation" and "not yet final" alike: UNKNOWN, resolved
   * by reading the booking. Sandbox 2026-10-09: 200 CANCELLED, fee 0, full refund, destination "agency_deposit" for a
   * confirmed booking paid in the payment component; 202 with status CREATED, fee 0 and refund 0 for a booking cancelled
   * before it was confirmed (repeats answered the same; the cancellation quote said 49007 "already in progress").
   */
  async cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<FlightCancelResult>> {
    const http = await this.send('cancel', 'POST', `/flights/bookings/${encodeURIComponent(providerBookingRef)}/cancellations`, null, this.cfg.bookTimeoutSeconds);
    if (!http.ok) return http.outcome;
    if (http.status === 409) return this.unknown(http.evidence);
    if (http.status === 404) return { kind: 'REJECTED', code: 'NUITEE_FLIGHT_BOOKING_NOT_FOUND', message: this.errorOf(http.json)?.message ?? 'booking not found', evidence: http.evidence };
    if (http.status >= 400) return this.refused(http);
    const d = obj(obj(http.json)?.data);
    const status = typeof d?.status === 'string' ? d.status.toUpperCase() : '';
    if (!d || d.bookingId !== providerBookingRef || typeof d.currency !== 'string') return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const final = http.status === 200 && (status === 'CANCELLED' || status === 'CANCELLED_WITH_CHARGES');
    // The OpenAPI lists only CONFIRMED for 202; sandbox answered 202 with CREATED for a booking not yet confirmed.
    const pending = http.status === 202 && (status === 'CONFIRMED' || status === 'CREATED' || status === 'PENDING_CONFIRMATION');
    if (!final && !pending) return this.unknown(http.evidence);
    return {
      kind: 'SUCCEEDED',
      value: {
        status: final ? 'CANCELLED' : 'CANCEL_PENDING',
        providerBookingRef,
        clientReference: '',
        pnr: null,
        ticketNumbers: [],
        ticketingStatus: 'NOT_APPLICABLE',
        voucherReady: false,
        holdExpiresAt: null,
        supplierCost: null,
        providerCommission: null,
        bookingReference: null,
        airlineLocators: [],
        ticketedAt: null,
        ticketLimitAt: null,
        cancelRequestedAt: null,
        paymentStatus: null,
        // "with margin applied"; on idempotent pending repeats often 0, so a pending answer is an estimate only.
        penalty: this.money(http.parsed, d, 'cancellation_fee', d.currency),
        refundAmount: this.money(http.parsed, d, 'refund_amount', d.currency),
        destination: str(d.destination),
        vouchers: arr(d.vouchers).length,
      },
      evidence: http.evidence,
    };
  }
}
