import { createHash } from 'node:crypto';
import { CapabilityNotAvailableError, DomainError, type FlightAirport, type FlightConnector, type FlightOffer, type FlightPassenger, type FlightSegment, type FlightService, type TravelerRef } from '@texholiday/contracts';
import { CheckoutRepository, IdempotencyRepository, QuoteRepository, SearchSessionRepository, type CoreDb } from '@texholiday/db';
import { QuoteError, assertQuoteUsable, type OrderAggregate, type ProviderManagedOrchestrator, type QuoteVersionSnapshot, type RouteOption } from '@texholiday/domain';
import { PricingPolicyError, add, computeSellPrice, equals, flightMarginForSearch, fromJson, toJson, type Money, type MoneyJson, type PricingPolicyVersion } from '@texholiday/pricing';
import { orderAccessToken } from './access';
import { flightQuoteView, type FlightQuoteOption } from './order-view';
import type { TransientPassengerDetails } from './nuitee-flight-pm-port';
import type { BookingSettings } from './settings';
import { InputValidationError, flightCheckoutInput, flightSearchInput, flightServicesInput, parse, type FlightCheckoutInput, type FlightSearchInput } from './validation';
import type { FlightJourneyView, FlightOfferView, FlightQuoteView, FlightSearchView, FlightServiceLine, FlightServicesOfferView, FlightTermsView, OrderView, PassengerType } from './views';

const FLIGHT_PROVIDER = 'nuitee';
const FLIGHT_CONNECTOR_ID = 'nuitee-flight';
/** Shown at most per search (cheapest first). */
const DEFAULT_MAX_OFFERS = 50;

interface StoredFlightOffer {
  key: string;
  offerRef: string;
  sell: MoneyJson;
  perPassenger: Partial<Record<PassengerType, MoneyJson>>;
  journeys: FlightJourneyView[];
  terms: FlightTermsView;
  baggage: Array<{ bagType: string; pieces: number; weightKg: number | null }>;
  fareFamily: string | null;
  seatsRemaining: number | null;
}

interface StoredFlightResults {
  offers: StoredFlightOffer[];
  pricingPolicy: { id: string; version: number };
  capabilityId: string;
  hidden: FlightSearchView['hidden'];
}

export interface FlightSalesDeps {
  /** The order of the access token's owner (404 otherwise). */
  authorizedOrder(orderId: string, token: string | null | undefined): Promise<OrderAggregate>;
  db: CoreDb;
  flights: FlightConnector;
  settings: BookingSettings;
  orchestrator: ProviderManagedOrchestrator;
  details: TransientPassengerDetails;
  clock: () => Date;
  pricingPolicy(): Promise<PricingPolicyVersion>;
  route(currency: string, policy: PricingPolicyVersion): Promise<RouteOption>;
  supportsApiMargin(capabilityId: string): boolean;
  orderView(orderId: string): Promise<OrderView>;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found', { httpStatus: 404 });
const providerUnavailable = () => new DomainError('PROVIDER_UNAVAILABLE', 'The flight provider did not answer; please try again', { httpStatus: 503, retryable: true, action: 'RETRY' });

function journeys(segments: readonly FlightSegment[]): FlightJourneyView[] {
  const out: FlightJourneyView[] = [];
  for (const direction of ['OUTBOUND', 'INBOUND'] as const) {
    const segs = segments.filter((s) => s.direction === direction);
    if (segs.length === 0) continue;
    const first = segs[0]!;
    const last = segs[segs.length - 1]!;
    out.push({
      direction,
      departure: { code: first.origin.code, name: first.origin.name, local: first.departureLocal },
      arrival: { code: last.destination.code, name: last.destination.name, local: last.arrivalLocal },
      connections: segs.length - 1,
      segments: segs.map((s) => ({
        origin: s.origin,
        destination: s.destination,
        departureLocal: s.departureLocal,
        arrivalLocal: s.arrivalLocal,
        carrier: s.marketingCarrier,
        operatedBy: s.operatingCarrier.code !== s.marketingCarrier.code ? (s.operatingCarrier.name ?? s.operatingCarrier.code) : null,
        flightNumber: s.flightNumber,
        durationMinutes: s.durationMinutes,
        cabin: s.cabin,
        stopCount: s.stopCount,
      })),
    });
  }
  return out;
}

const termsView = (o: FlightOffer): FlightTermsView => ({ refundable: o.terms.refundable, changeable: o.terms.changeable, refundFee: o.terms.hasRefundFee, changeFee: o.terms.hasChangeFee });
const baggageView = (o: FlightOffer) => o.includedBaggage.map((b) => ({ bagType: b.bagType, pieces: b.pieces, weightKg: b.weightKg }));
const perPassengerJson = (o: FlightOffer) => Object.fromEntries(Object.entries(o.perPassenger).map(([k, v]) => [k, toJson(v)])) as Partial<Record<PassengerType, MoneyJson>>;

/** Whole years between a birth date and a travel date (both YYYY-MM-DD). */
export function ageOn(birthDate: string, on: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = on.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/**
 * Customer flight sales with the provider-managed payment (ADR-0011, ADR-0012): search → offer key → the provider
 * re-checks the fare (verify) → server-side quote → passengers and contact → prebook with the payment component →
 * book on the customer's return → ticket.
 */
export class FlightSales {
  private readonly quotes: QuoteRepository;
  private readonly checkout: CheckoutRepository;
  private readonly searches: SearchSessionRepository;
  private readonly idempotency: IdempotencyRepository;

  /** Seats and bags before payment (ADR-0013). */
  readonly services: FlightServicesSales;

  constructor(private readonly deps: FlightSalesDeps) {
    this.quotes = new QuoteRepository(deps.db);
    this.checkout = new CheckoutRepository(deps.db);
    this.searches = new SearchSessionRepository(deps.db);
    this.idempotency = new IdempotencyRepository(deps.db);
    this.services = new FlightServicesSales(deps, this.quotes, this.checkout);
  }

  async airports(text: string): Promise<readonly FlightAirport[]> {
    const out = await this.deps.flights.searchAirports({ text });
    if (out.kind === 'SUCCEEDED') return out.value;
    if (out.kind === 'CAPABILITY_NOT_AVAILABLE') return [];
    throw providerUnavailable();
  }

  // ------------------------------------------------------------------ search

  async search(raw: unknown): Promise<FlightSearchView> {
    const input = parse(flightSearchInput, raw);
    const now = this.deps.clock();
    if (Date.parse(`${input.departDate}T23:59:59Z`) + 86_400_000 < now.getTime()) {
      throw new InputValidationError([{ path: 'departDate', message: 'departure date is in the past' }]);
    }
    const policy = await this.deps.pricingPolicy();
    const route = await this.deps.route(input.currency, policy);
    const capabilityId = route.funding[0]!.capabilityId;
    const out = await this.deps.flights.searchRates({
      legs: [{ origin: input.origin, destination: input.destination, date: input.departDate }, ...(input.returnDate ? [{ origin: input.destination, destination: input.origin, date: input.returnDate }] : [])],
      adults: input.adults,
      childAges: input.childAges,
      infantAges: input.infantAges,
      cabinClass: input.cabinClass,
      pointOfSale: this.deps.settings.flightPointOfSale ?? null,
      currency: input.currency,
      // Fare, seat, bag and penalty markups from the approved policy (ADR-0013); categories without a value go out as 0.
      margin: flightMarginForSearch(policy, 'PROVIDER_MANAGED'),
    });
    if (out.kind === 'REJECTED' || out.kind === 'CAPABILITY_NOT_AVAILABLE') {
      throw new DomainError('VALIDATION_FAILED', 'The search could not be run with these criteria', { httpStatus: 422, action: 'FIX_FIELDS' });
    }
    if (out.kind !== 'SUCCEEDED') throw providerUnavailable();

    const hidden = { notPriced: 0 };
    const priced: Array<Omit<StoredFlightOffer, 'key'>> = [];
    for (const offer of out.value) {
      const sell = this.sell(offer, policy, capabilityId);
      if (!sell || sell.currency !== input.currency) {
        hidden.notPriced += 1;
        continue;
      }
      priced.push({
        offerRef: offer.offerRef,
        sell: toJson(sell),
        perPassenger: perPassengerJson(offer),
        journeys: journeys(offer.segments),
        terms: termsView(offer),
        baggage: baggageView(offer),
        fareFamily: offer.fareFamily,
        seatsRemaining: offer.seatsRemaining,
      });
    }
    priced.sort((a, b) => (BigInt(a.sell.minor) < BigInt(b.sell.minor) ? -1 : BigInt(a.sell.minor) > BigInt(b.sell.minor) ? 1 : 0));
    const stored = priced.slice(0, this.deps.settings.maxFlightOffers ?? DEFAULT_MAX_OFFERS).map((o, i) => ({ ...o, key: String(i) }));
    const results: StoredFlightResults = { offers: stored, pricingPolicy: { id: policy.id, version: policy.version }, capabilityId, hidden };
    const expiresAt = new Date(now.getTime() + this.deps.settings.searchTtlSeconds * 1000).toISOString();
    const sessionId = await this.searches.create({
      productType: 'FLIGHT',
      environment: this.deps.settings.environment,
      criteria: input,
      route: route.route,
      results,
      locale: input.locale,
      displayCurrency: input.currency,
      guestNationality: null,
      expiresAt,
    });
    return this.view(sessionId, expiresAt, input, results);
  }

  /** One customer price per offer: the provider price with our policy markup, verified against the approved rule. */
  private sell(offer: FlightOffer, policy: PricingPolicyVersion, capabilityId: string): Money | null {
    try {
      return computeSellPrice({
        productType: 'FLIGHT',
        paymentMode: 'PROVIDER_MANAGED',
        providerPrice: offer.price,
        providerAppliedMargin: offer.appliedMarkup,
        providerSupportsApiMargin: this.deps.supportsApiMargin(capabilityId),
        policy,
      }).sell;
    } catch (err) {
      if (!(err instanceof PricingPolicyError)) throw err;
      return null;
    }
  }

  private view(sessionId: string, expiresAt: string, input: FlightSearchInput, results: StoredFlightResults): FlightSearchView {
    const offers: FlightOfferView[] = results.offers.map((o) => ({
      key: o.key,
      total: o.sell,
      perPassenger: o.perPassenger,
      journeys: o.journeys,
      terms: o.terms,
      baggage: o.baggage,
      fareFamily: o.fareFamily,
      seatsRemaining: o.seatsRemaining,
    }));
    return {
      sessionId,
      expiresAt,
      currency: input.currency,
      paymentMode: 'PROVIDER_MANAGED',
      criteria: {
        origin: input.origin,
        destination: input.destination,
        departDate: input.departDate,
        returnDate: input.returnDate,
        adults: input.adults,
        childAges: input.childAges,
        infantAges: input.infantAges,
        cabinClass: input.cabinClass,
      },
      offers,
      hidden: results.hidden,
    };
  }

  private async session(sessionId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
    const s = await this.searches.get<StoredFlightResults, FlightSearchInput>(sessionId);
    return s && s.environment === this.deps.settings.environment && s.productType === 'FLIGHT' ? s : null;
  }

  /** Re-renders a stored search; prices come from the stored snapshot only. */
  async searchSession(sessionId: string): Promise<FlightSearchView> {
    const s = await this.session(sessionId);
    if (!s) throw notFound();
    if (new Date(s.expiresAt).getTime() <= this.deps.clock().getTime()) throw new QuoteError('QUOTE_EXPIRED', 'Search results expired; please search again');
    return this.view(s.id, s.expiresAt, s.criteria, s.results);
  }

  /** The criteria behind a session, for pre-filling the form (no prices). */
  async searchCriteria(sessionId: string): Promise<FlightSearchInput | null> {
    return (await this.session(sessionId))?.criteria ?? null;
  }

  // ------------------------------------------------------------------ quote

  /**
   * The provider re-checks the fare (verify) and the result becomes an immutable quote version: the price the customer
   * accepts. A price that moved since the search is shown with the old one before acceptance (K15).
   */
  async selectOffer(sessionId: string, key: string): Promise<FlightQuoteView> {
    const s = await this.session(sessionId);
    const now = this.deps.clock();
    if (!s) throw notFound();
    if (new Date(s.expiresAt).getTime() <= now.getTime()) throw new QuoteError('QUOTE_EXPIRED', 'Search results expired; please search again');
    const stored = s.results.offers.find((o) => o.key === key);
    if (!stored) throw notFound();
    const policy = await this.deps.pricingPolicy();
    if (policy.id !== s.results.pricingPolicy.id || policy.version !== s.results.pricingPolicy.version) throw new QuoteError('QUOTE_CHANGED', 'Prices were updated; please search again');

    const out = await this.deps.flights.verify({ offerRef: stored.offerRef as FlightOffer['offerRef'] });
    if (out.kind === 'REJECTED' || out.kind === 'CAPABILITY_NOT_AVAILABLE') throw new QuoteError('QUOTE_EXPIRED', 'This fare is no longer available; please search again');
    if (out.kind !== 'SUCCEEDED') throw providerUnavailable();
    const offer = out.value.offer;
    const sell = this.sell(offer, policy, s.results.capabilityId);
    if (!sell || sell.currency !== s.criteria.currency) throw new QuoteError('QUOTE_CHANGED', 'This fare can no longer be offered; please choose another one');
    const c = s.criteria;
    const offerExpiry = offer.expiresAt ? new Date(offer.expiresAt).getTime() : Number.POSITIVE_INFINITY;
    const expiresAt = new Date(Math.min(now.getTime() + this.deps.settings.quoteTtlSeconds * 1000, offerExpiry));
    if (expiresAt.getTime() <= now.getTime()) throw new QuoteError('QUOTE_EXPIRED', 'This fare is no longer available; please search again');
    const js = journeys(offer.segments);
    const name = (code: string) => js.flatMap((j) => [j.departure, j.arrival]).find((p) => p.code === code)?.name ?? null;
    const place = (code: string) => (name(code) ? `${name(code)} (${code})` : code);
    const option: FlightQuoteOption = {
      title: `${place(c.origin)} → ${place(c.destination)}`,
      legs: [{ origin: c.origin, destination: c.destination, date: c.departDate }, ...(c.returnDate ? [{ origin: c.destination, destination: c.origin, date: c.returnDate }] : [])],
      journeys: js,
      passengers: { adults: c.adults, childAges: c.childAges, infantAges: c.infantAges },
      cabinClass: c.cabinClass,
      perPassenger: perPassengerJson(offer),
      terms: termsView(offer),
      baggage: baggageView(offer),
      fareFamily: offer.fareFamily,
      capabilityId: s.results.capabilityId,
      priceChangedFrom: equals(sell, fromJson(stored.sell)) ? null : stored.sell,
      offerExpiresAt: offer.expiresAt,
      segmentKeys: offer.segments.map((x) => x.segmentKey),
      // Seats/bags are sold only when the approved policy sets their markup (ADR-0013).
      extras: { seats: (flightMarginForSearch(policy, 'PROVIDER_MANAGED')?.seatsBasisPoints ?? null) !== null, bags: (flightMarginForSearch(policy, 'PROVIDER_MANAGED')?.bagsBasisPoints ?? null) !== null },
    };
    const travelers: TravelerRef[] = [
      ...Array.from({ length: c.adults }, (_, i) => ({ travelerId: `a${i + 1}`, type: 'ADULT' as const, age: null })),
      ...c.childAges.map((age, i) => ({ travelerId: `c${i + 1}`, type: 'CHILD' as const, age })),
      ...c.infantAges.map((age, i) => ({ travelerId: `i${i + 1}`, type: 'INFANT' as const, age })),
    ];
    const quoteId = await this.quotes.createQuote('FLIGHT', FLIGHT_PROVIDER);
    const quoteVersionId = await this.quotes.addVersion(quoteId, {
      version: 1,
      environment: this.deps.settings.environment,
      productType: 'FLIGHT',
      providerId: FLIGHT_PROVIDER,
      offerRef: offer.offerRef,
      option: option as unknown as Record<string, unknown>,
      travelers,
      // The provider collects the customer price; its markup (ours) is paid out later (ADR-0006).
      supplierCost: offer.price,
      providerCommission: offer.appliedMarkup,
      sell,
      chargeNow: sell,
      fx: null,
      fees: [],
      payAtProperty: [],
      // Flights publish no penalty schedule: the cost of a cancellation comes from the provider's cancellation quote
      // after booking (ADR-0011). Never read as "free": flight views and staff previews do not use these steps.
      cancellation: {
        timezone: 'UTC',
        refundable: offer.terms.refundable,
        steps: [],
        providerText: `FLIGHT fare rules: ${offer.terms.summary.map((m) => m.message).join(' | ') || 'none published'}`,
      },
      expiresAt: expiresAt.toISOString(),
      pricingPolicy: s.results.pricingPolicy,
    });
    return flightQuoteView((await this.quotes.get(quoteVersionId))!, this.deps.settings.termsVersion);
  }

  async quote(quoteVersionId: string): Promise<FlightQuoteView> {
    if (!/^[0-9a-f-]{36}$/i.test(quoteVersionId)) throw notFound();
    const q = await this.quotes.get(quoteVersionId);
    if (!q || q.environment !== this.deps.settings.environment || q.productType !== 'FLIGHT') throw notFound();
    return flightQuoteView(q, this.deps.settings.termsVersion);
  }

  // ------------------------------------------------------------------ checkout

  /**
   * Guest checkout. Idempotent per key (same body -> same order). Passenger documents are handed to the prebook in
   * memory and never stored (ADR-0012); a repeat of the same request hands them over again if the prebook is still due.
   */
  async createCheckout(raw: unknown): Promise<{ orderId: string; accessToken: string; order: OrderView }> {
    const input = parse(flightCheckoutInput, raw);
    const s = this.deps.settings;
    const begin = await this.idempotency.begin('flight-checkout', input.idempotencyKey, input, 86_400);
    if (begin.state === 'IN_PROGRESS') throw new DomainError('PAYMENT_UNRESOLVED', 'This checkout is already being processed', { httpStatus: 409, retryable: true, action: 'RETRY' });
    let orderId: string;
    if (begin.state === 'COMPLETED') {
      orderId = (begin.body as { orderId: string }).orderId;
    } else {
      try {
        orderId = await this.submit(input);
      } catch (err) {
        // Nothing was created: the customer may fix the input and retry with the same key.
        await this.idempotency.release('flight-checkout', input.idempotencyKey);
        throw err;
      }
      await this.idempotency.complete('flight-checkout', input.idempotencyKey, 201, { orderId });
    }
    this.deps.details.put(orderId, this.passengers(input));
    try {
      // Prebook with the payment session (does nothing when it already exists).
      await this.deps.orchestrator.start(orderId);
    } finally {
      this.deps.details.take(orderId);
    }
    return { orderId, accessToken: orderAccessToken(s.accessTokenSecret, orderId), order: await this.deps.orderView(orderId) };
  }

  private passengers(input: FlightCheckoutInput): FlightPassenger[] {
    return input.passengers.map((p) => ({
      type: p.type,
      firstName: p.firstName,
      lastName: p.lastName,
      middleName: null,
      birthDate: p.birthDate,
      gender: p.gender,
      nationality: p.nationality,
      document: { type: p.document.type, number: p.document.number.toUpperCase(), issuingCountry: p.document.issuingCountry, expiresOn: p.document.expiresOn },
    }));
  }

  /** Passengers must match the searched party: types, counts and ages on the travel dates (IATA). */
  private checkPassengers(input: FlightCheckoutInput, option: FlightQuoteOption): void {
    const issues: Array<{ path: string; message: string }> = [];
    const first = option.legs[0]!.date;
    const last = option.legs[option.legs.length - 1]!.date;
    const count = (t: PassengerType) => input.passengers.filter((p) => p.type === t).length;
    if (count('ADULT') !== option.passengers.adults || count('CHILD') !== option.passengers.childAges.length || count('INFANT') !== option.passengers.infantAges.length) {
      issues.push({ path: 'passengers', message: 'passengers must match the search (adults, children, infants)' });
    }
    input.passengers.forEach((p, i) => {
      const age = ageOn(p.birthDate, first);
      if (p.birthDate > first) issues.push({ path: `passengers.${i}.birthDate`, message: 'birth date after the flight' });
      else if (p.type === 'ADULT' && age < 12) issues.push({ path: `passengers.${i}.birthDate`, message: 'adults are 12 or older on the travel date' });
      else if (p.type === 'CHILD' && (age < 2 || age > 11)) issues.push({ path: `passengers.${i}.birthDate`, message: 'children are 2-11 on the travel date' });
      else if (p.type === 'INFANT' && ageOn(p.birthDate, last) >= 2) issues.push({ path: `passengers.${i}.birthDate`, message: 'infants are under 2 for the whole trip' });
      if (p.document.expiresOn < last) issues.push({ path: `passengers.${i}.document.expiresOn`, message: 'document expires before the last flight' });
    });
    if (issues.length > 0) throw new InputValidationError(issues);
  }

  private async submit(input: FlightCheckoutInput): Promise<string> {
    const s = this.deps.settings;
    const quote = await this.quotes.get(input.quoteVersionId);
    if (!quote || quote.environment !== s.environment || quote.productType !== 'FLIGHT') throw notFound();
    if (input.termsVersion !== s.termsVersion) throw new QuoteError('QUOTE_CHANGED', 'The sales terms were updated; please review them again');
    if (new Date(quote.expiresAt).getTime() <= this.deps.clock().getTime()) throw new QuoteError('QUOTE_EXPIRED', 'The fare expired; please search again');
    const option = quote.option as unknown as FlightQuoteOption;
    this.checkPassengers(input, option);
    const policy = await this.deps.pricingPolicy();
    const route = await this.deps.route(quote.chargeNow.currency, policy);

    await this.quotes.accept(quote.id, input.termsVersion);
    const accepted = (await this.quotes.get(quote.id)) as QuoteVersionSnapshot;
    assertQuoteUsable(accepted, this.deps.clock());

    const c = input.contact;
    const customerId = await this.checkout.createGuestCustomer(c.email, input.locale);
    const payBy = new Date(this.deps.clock().getTime() + s.payBySeconds * 1000).toISOString();
    const { orderId } = await this.checkout.submitOrder({
      customerId,
      environment: s.environment,
      route: route.route,
      chargeTotal: accepted.chargeNow,
      checkoutExpiresAt: payBy,
      items: [
        {
          quoteVersionId: accepted.id,
          productType: 'FLIGHT',
          providerId: FLIGHT_PROVIDER,
          connectorId: FLIGHT_CONNECTOR_ID,
          chargeAllocation: accepted.chargeNow,
          supplierCost: accepted.supplierCost,
          funding: { method: 'PROVIDER_MANAGED', capabilityId: route.funding[0]!.capabilityId },
          connector: { holdSemantics: 'PREBOOK_VALIDATION', reversibilityRank: 90, requiresIssuance: true, needsPrebook: true },
          guests: {
            // First Line support (ADR-0012): the traveller's own contact goes on the booking.
            holder: { firstName: c.firstName, lastName: c.lastName, email: c.email, phone: `+${c.phoneCountryCode}${c.phoneNumber}`, phoneCountryCode: c.phoneCountryCode },
            roomGuests: [],
            passengers: input.passengers.map((p) => ({ type: p.type, firstName: p.firstName, lastName: p.lastName })),
          },
        },
      ],
      payment: { gatewayId: FLIGHT_PROVIDER, mode: 'PROVIDER_MANAGED', idempotencyKey: `flight-checkout:${input.idempotencyKey}`, payBy },
    });
    return orderId;
  }
}

/** The client's key for a provider service: a digest, so provider ids never reach the browser. */
const serviceKey = (ref: string) => createHash('sha256').update(ref).digest('hex').slice(0, 20);

interface ServicesContext {
  agg: OrderAggregate;
  quote: QuoteVersionSnapshot;
  option: FlightQuoteOption;
  passengers: ReadonlyArray<{ type: PassengerType; firstName: string; lastName: string }>;
  services: FlightService[];
  current: Money;
  until: string | null;
}

/** Seats and bags before payment (ADR-0013): offered from the provider's live catalog, attached with a new quote. */
export class FlightServicesSales {
  constructor(
    private readonly deps: FlightSalesDeps,
    private readonly quotes: QuoteRepository,
    private readonly checkout: CheckoutRepository,
  ) {}

  /** Null when nothing can be added any more (the customer goes to payment). */
  private async context(orderId: string, token: string | null | undefined): Promise<ServicesContext | null> {
    const agg = await this.deps.authorizedOrder(orderId, token);
    const it = agg.items[0]!;
    const p = agg.payment!;
    const now = this.deps.clock();
    if (it.productType !== 'FLIGHT' || agg.status !== 'PROCESSING' || it.booking.status !== 'PREPARED' || p.status !== 'PENDING' || p.providerSecretIssuedAt || !p.providerTransaction || it.booking.intent) return null;
    if (p.payBy && new Date(p.payBy).getTime() <= now.getTime()) return null;
    const quote = await this.quotes.get(it.quoteVersionId);
    if (!quote) return null;
    const option = quote.option as unknown as FlightQuoteOption;
    if (!option.extras || (!option.extras.seats && !option.extras.bags)) return null;
    const guests = await this.checkout.guests(it.id);
    if (!guests?.passengers) return null;
    const read = await this.deps.flights.readPrebook(p.providerTransaction.prebookRef);
    if (read.kind !== 'SUCCEEDED') return null;
    const v = read.value;
    // The provider's amount must be the one on the order; anything else is never offered on top of.
    if (v.amountToCharge.currency !== p.amount.currency || v.amountToCharge.minor !== p.amount.minor) return null;
    if (v.providerManagedTransaction?.transactionId !== p.providerTransaction.transactionId) return null;
    const until = [v.servicesExpiresAt, p.payBy].filter((x): x is string => x !== null).sort()[0] ?? null;
    if (until && new Date(until).getTime() <= now.getTime()) return null;
    const services = v.services.filter((x) => x.price.currency === p.amount.currency && (x.category === 'SEAT' ? option.extras!.seats : option.extras!.bags));
    if (services.length === 0) return null;
    return { agg, quote, option, passengers: guests.passengers, services, current: v.amountToCharge, until };
  }

  private segmentLabel(option: FlightQuoteOption, segmentKey: string | null): string | null {
    if (!segmentKey || !option.segmentKeys) return null;
    const i = option.segmentKeys.indexOf(segmentKey);
    const seg = option.journeys.flatMap((j) => j.segments)[i];
    return seg ? `${seg.origin.code} → ${seg.destination.code}${seg.flightNumber ? ` · ${seg.carrier.code} ${seg.flightNumber}` : ''}` : null;
  }

  async offer(orderId: string, token: string | null | undefined): Promise<FlightServicesOfferView> {
    const ctx = await this.context(orderId, token);
    const agg = ctx?.agg ?? (await this.deps.authorizedOrder(orderId, token));
    const quote = ctx?.quote ?? (await this.quotes.get(agg.items[0]!.quoteVersionId));
    const added = ((quote?.option as unknown as FlightQuoteOption | undefined)?.services ?? []) as FlightServiceLine[];
    const closed = { orderId, open: false, currency: agg.payment!.amount.currency, current: toJson(agg.payment!.amount), passengers: [], segments: [], added, until: null };
    if (!ctx) return closed;
    const keys = ctx.option.segmentKeys ?? [...new Set(ctx.services.map((x) => x.segmentKey ?? ''))];
    const segments = keys
      .map((key) => {
        const own = ctx.services.filter((x) => x.segmentKey === key);
        return {
          label: this.segmentLabel(ctx.option, key) ?? key,
          seats: own
            .filter((x) => x.category === 'SEAT' && x.seat)
            .map((x) => ({ key: serviceKey(x.serviceRef), number: x.seat!.number, row: x.seat!.row, column: x.seat!.column, type: x.seat!.type, available: x.seat!.available, price: toJson(x.price), forType: x.passengerType })),
          bags: own
            .filter((x) => x.category === 'BAGGAGE' && x.baggage)
            .map((x) => ({ key: serviceKey(x.serviceRef), name: x.name, pieces: x.baggage!.pieces, weightKg: x.baggage!.weightKg, price: toJson(x.price), forType: x.passengerType })),
        };
      })
      .filter((x) => x.seats.length > 0 || x.bags.length > 0);
    if (segments.length === 0) return closed;
    return {
      orderId,
      open: true,
      currency: ctx.current.currency,
      current: toJson(ctx.current),
      passengers: ctx.passengers.map((p, index) => ({ index, type: p.type, name: `${p.firstName} ${p.lastName}` })),
      segments,
      added,
      until: ctx.until,
    };
  }

  /**
   * Attaches the chosen seats/bags. The customer accepted `expectedTotal` (the page total): it must be exactly the
   * current amount plus the live prices, else nothing is sent (QUOTE_CHANGED). The new total becomes a new, accepted
   * quote version before the provider call; the provider must charge exactly that.
   */
  async attach(orderId: string, token: string | null | undefined, raw: unknown): Promise<{ outcome: 'ATTACHED' | 'REJECTED' | 'PRICE_CHANGED' | 'FAILED'; order: OrderView }> {
    const input = parse(flightServicesInput, raw);
    const ctx = await this.context(orderId, token);
    if (!ctx) throw new DomainError('ILLEGAL_TRANSITION', 'Services can no longer be added to this booking', { httpStatus: 409 });
    const issues: Array<{ path: string; message: string }> = [];
    const byKey = new Map(ctx.services.map((x) => [serviceKey(x.serviceRef), x]));
    const taken = new Set<string>();
    const perPassenger = new Set<string>();
    const chosen: Array<{ service: FlightService; passengerIndex: number }> = [];
    input.selections.forEach((sel, i) => {
      const sv = byKey.get(sel.key);
      const pax = ctx.passengers[sel.passengerIndex];
      if (!sv || !pax) {
        issues.push({ path: `selections.${i}`, message: 'not available any more' });
        return;
      }
      if (sv.passengerType !== 'ALL' && sv.passengerType !== pax.type) issues.push({ path: `selections.${i}`, message: 'not for this passenger type' });
      if (sv.category === 'SEAT' && (pax.type === 'INFANT' || !sv.seat?.available || taken.has(sel.key))) issues.push({ path: `selections.${i}`, message: 'seat not available' });
      const slot = `${sv.category}|${sv.segmentKey}|${sel.passengerIndex}`;
      if (perPassenger.has(slot)) issues.push({ path: `selections.${i}`, message: 'one seat and one bag per passenger and flight' });
      perPassenger.add(slot);
      taken.add(sel.key);
      chosen.push({ service: sv, passengerIndex: sel.passengerIndex });
    });
    if (issues.length > 0) throw new InputValidationError(issues);
    const total = chosen.reduce((acc, c) => add(acc, c.service.price), ctx.current);
    if (input.expectedTotal.currency !== total.currency || input.expectedTotal.minor !== total.minor.toString()) {
      throw new QuoteError('QUOTE_CHANGED', 'Prices changed; please review the total again');
    }
    const base = ctx.quote;
    const lines: FlightServiceLine[] = chosen.map((c) => ({
      passengerIndex: c.passengerIndex,
      category: c.service.category,
      name: c.service.name,
      seat: c.service.seat?.number ?? null,
      baggage: c.service.baggage ? { pieces: c.service.baggage.pieces, weightKg: c.service.baggage.weightKg } : null,
      segment: this.segmentLabel(ctx.option, c.service.segmentKey),
      price: toJson(c.service.price),
    }));
    const added = chosen.reduce((acc, c) => add(acc, c.service.price), fromJson({ currency: total.currency, minor: '0' }));
    const option: FlightQuoteOption = { ...ctx.option, services: [...(ctx.option.services ?? []), ...lines], fare: ctx.option.fare ?? toJson(base.chargeNow) };
    const versionId = await this.quotes.addVersion(base.quoteId, {
      // A refused earlier attempt may have used base.version + 1 already.
      version: await this.quotes.nextVersion(base.quoteId),
      environment: this.deps.settings.environment,
      productType: 'FLIGHT',
      providerId: base.providerId,
      offerRef: base.offerRef,
      option: option as unknown as Record<string, unknown>,
      travelers: base.travelers,
      supplierCost: add(base.supplierCost, added),
      // The fare markup stays the expected commission; seat/bag markups are not reported by the provider.
      providerCommission: base.providerCommission,
      sell: total,
      chargeNow: total,
      fx: null,
      fees: [],
      payAtProperty: [],
      cancellation: base.cancellation,
      expiresAt: base.expiresAt,
      pricingPolicy: base.pricingPolicy,
    });
    // Submitting the page with its total is the customer's acceptance of the new total (K15).
    await this.quotes.accept(versionId, this.deps.settings.termsVersion);
    const result = await this.deps.orchestrator.attachServices(
      orderId,
      { quoteVersionId: versionId, expectedCharge: total, supplierCost: add(base.supplierCost, added), selections: chosen.map((c) => ({ serviceRef: c.service.serviceRef, passengerIndex: c.passengerIndex, quantity: 1 })) },
      'customer',
    );
    return { outcome: result.outcome, order: await this.deps.orderView(orderId) };
  }
}

/** Currencies the flight route is open for (an approved policy with a FLIGHT rule and an open route are needed). */
export async function openFlightCurrencies(currencies: readonly string[], route: (c: string) => Promise<unknown>): Promise<string[]> {
  const open: string[] = [];
  for (const c of currencies) {
    try {
      await route(c);
      open.push(c);
    } catch (err) {
      if (!(err instanceof CapabilityNotAvailableError)) throw err;
    }
  }
  return open;
}
