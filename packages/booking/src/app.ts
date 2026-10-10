import {
  CapabilityNotAvailableError,
  DomainError,
  type CapabilityMatrix,
  type FlightConnector,
  type HotelConnector,
  type ProductType,
  type HotelNameMatch,
  type HotelOffer,
  type HotelSummary,
  type PlaceSuggestion,
  type SourceLock,
} from '@texholiday/contracts';
import { CheckoutRepository, DrizzleOrderStore, HotelListRepository, IdempotencyRepository, PolicyRepository, QuoteRepository, SearchSessionRepository, type CoreDb } from '@texholiday/db';
import {
  ProviderManagedOrchestrator,
  QuoteError,
  assertQuoteUsable,
  type OrderAggregate,
  type QuoteVersionSnapshot,
  type RouteOption,
} from '@texholiday/domain';
import {
  fromJson,
  money,
  providerMarginForSearch,
  toJson,
  type PricingPolicyVersion,
} from '@texholiday/pricing';
import { canAccessOrder, orderAccessToken } from './access';
import { priceHotelOffer, type StoredOffer } from './hotel-offer-pricing';
import { HotelPricing, providerManagedRoute } from './hotel-pricing';
import { HotelListPages, HotelListScanner } from './hotel-lists';
import { HotelListPriceChecks } from './hotel-list-accuracy';
import { cancellationView, loadOrderView, orderStage, quoteView } from './order-view';
import { NuiteeHotelProviderManagedPort } from './nuitee-pm-port';
import { NuiteeFlightProviderManagedPort, ProductProviderManagedPort, TransientPassengerDetails } from './nuitee-flight-pm-port';
import { FlightSales, openFlightCurrencies } from './flights';
import { StaffOrderCommands } from './staff-orders';
import { customerCancellation } from './cancellation';
import { ProviderCommissions } from './commissions';
import type { BookingSettings } from './settings';
import { checkoutInput, hotelSearchInput, parse, type HotelSearchInput } from './validation';
import type { CancellationView, CustomerCancellationView, CustomerCancelResult, HotelOfferView, HotelResultView, HotelSearchView, OrderStage, OrderView, PaymentSessionView, QuoteView } from './views';

const HOTEL_PROVIDER = 'nuitee';
const HOTEL_CONNECTOR_ID = 'nuitee-hotel';
interface StoredResults {
  hotels: HotelSummary[];
  offers: StoredOffer[];
  pricingPolicy: { id: string; version: number };
  capabilityId: string;
  hidden: HotelSearchView['hidden'];
}

export interface BookingAppDeps {
  db: CoreDb;
  hotels: HotelConnector;
  /** Flight sales are off without a flight connector. */
  flights?: FlightConnector | null;
  matrix: CapabilityMatrix;
  sourceLock: SourceLock;
  settings: BookingSettings;
  clock?: () => Date;
  workerId?: string;
  /** Side work that must never fail a customer request reports here (e.g. list price checks). */
  log?: { warn(msg: string, meta?: Record<string, unknown>): void };
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found', { httpStatus: 404 });
const providerUnavailable = () => new DomainError('PROVIDER_UNAVAILABLE', 'The hotel provider did not answer; please try again', { httpStatus: 503, retryable: true, action: 'RETRY' });

function nightsBetween(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}

const storedCancellation = (c: StoredOffer['cancellation']): QuoteVersionSnapshot['cancellation'] => ({ ...c, steps: c.steps.map((s) => ({ from: s.from, penalty: fromJson(s.penalty) })) });

/**
 * Application services for the hotel booking flow (spec §14) with the provider-managed payment (ADR-0008):
 * search → offer key → server-side quote → guest checkout → provider payment component → finalize → status.
 */
export class BookingApp {
  readonly orchestrator: ProviderManagedOrchestrator;
  /** Staff commands for /yonetim (permission-checked). */
  readonly staff: StaffOrderCommands;
  /** Provider commissions: earning after the stay and payouts recorded by finance (ADR-0019). */
  readonly commissions: ProviderCommissions;
  /** Customer flight sales (null when no flight connector is configured). */
  readonly flights: FlightSales | null;
  /** Hotel prices as the search computes them, with their fingerprint (ADR-0014). */
  readonly hotelPricing: HotelPricing;
  /** Read model of the hotel list and hotel pages (ADR-0014). */
  readonly hotelLists: HotelListPages;
  readonly hotelListRepository: HotelListRepository;
  /** Live searches compared with list prices, and the panel report (ADR-0014). */
  readonly hotelListPriceChecks: HotelListPriceChecks;
  private readonly policies: PolicyRepository;
  private readonly quotes: QuoteRepository;
  private readonly checkout: CheckoutRepository;
  private readonly searches: SearchSessionRepository;
  private readonly idempotency: IdempotencyRepository;
  private readonly store: DrizzleOrderStore;
  private readonly clock: () => Date;

  constructor(private readonly deps: BookingAppDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.policies = new PolicyRepository(deps.db);
    this.quotes = new QuoteRepository(deps.db);
    this.checkout = new CheckoutRepository(deps.db);
    this.searches = new SearchSessionRepository(deps.db);
    this.idempotency = new IdempotencyRepository(deps.db);
    this.store = new DrizzleOrderStore(deps.db);
    const s = deps.settings;
    // Passenger documents live only between the checkout request and its prebook (ADR-0012).
    const details = new TransientPassengerDetails(10 * 60_000, this.clock);
    this.orchestrator = new ProviderManagedOrchestrator({
      store: this.store,
      port: new ProductProviderManagedPort({
        HOTEL: new NuiteeHotelProviderManagedPort(deps.hotels, this.quotes, this.checkout),
        ...(deps.flights ? { FLIGHT: new NuiteeFlightProviderManagedPort(deps.flights, this.quotes, this.checkout, details) } : {}),
      }),
      clock: this.clock,
      workerId: deps.workerId ?? `booking-${process.pid}`,
      policy: {
        intentLeaseSeconds: s.intentLeaseSeconds,
        // Quick retries while the customer is on the payment form, then every few minutes until the deadline.
        finalizeRetrySeconds: (attempt) => Math.min(20 * 2 ** Math.max(0, attempt - 1), 300),
        maxAutomaticLookups: s.maxAutomaticLookups,
      },
    });
    this.hotelPricing = new HotelPricing({
      matrix: deps.matrix,
      sourceLock: deps.sourceLock,
      policies: this.policies,
      settings: { environment: s.environment, policyId: s.policyId, currencies: s.currencies, maxRatesPerHotel: s.maxRatesPerHotel, enforceRateParity: s.enforceRateParity },
    });
    this.hotelListRepository = new HotelListRepository(deps.db);
    this.hotelLists = new HotelListPages({ repo: this.hotelListRepository, pricing: this.hotelPricing, clock: this.clock });
    this.hotelListPriceChecks = new HotelListPriceChecks({ repo: this.hotelListRepository, pricing: this.hotelPricing, clock: this.clock });
    this.staff = new StaffOrderCommands(deps.db, this.store, this.orchestrator, s.environment, this.clock, deps.flights ?? null);
    this.commissions = new ProviderCommissions({ db: deps.db, environment: s.environment, orchestrator: this.orchestrator, clock: this.clock });
    this.flights = deps.flights
      ? new FlightSales({
          db: deps.db,
          flights: deps.flights,
          settings: s,
          orchestrator: this.orchestrator,
          details,
          clock: this.clock,
          pricingPolicy: () => this.pricingPolicy(),
          route: (currency, policy) => this.route(currency, policy, 'FLIGHT'),
          supportsApiMargin: (id) => this.supportsApiMargin(id),
          orderView: (orderId) => this.view(orderId),
          authorizedOrder: (orderId, token) => this.authorized(orderId, token),
        })
      : null;
  }

  // ------------------------------------------------------------------ routing & pricing

  private async pricingPolicy(): Promise<PricingPolicyVersion> {
    const p = await this.policies.activePricing(this.deps.settings.policyId);
    if (!p) throw new CapabilityNotAvailableError('Sales are closed: no approved pricing policy', ['pricing policy not approved']);
    return p;
  }

  /** The route is chosen on the server (§4.1); shared with the hotel list scanner (ADR-0014). */
  private async route(currency: string, policy: PricingPolicyVersion, productType: ProductType = 'HOTEL'): Promise<RouteOption> {
    return providerManagedRoute({ ...this.deps, policies: this.policies }, currency, policy, productType);
  }

  /** A list price scanner on this process's hotel connector (the worker runs it; the MOCK web uses it in tests). */
  hotelListScanner(workerId: string, opts: { sleep?: (ms: number) => Promise<void> } = {}): HotelListScanner {
    const tech = this.deps.settings.hotelLists ?? { refreshHours: 24, callsPerSecond: 1, candidates: 100, contentRefreshDays: 7 };
    return new HotelListScanner({ repo: this.hotelListRepository, hotels: this.deps.hotels, pricing: this.hotelPricing, tech, workerId, clock: this.clock, ...opts });
  }

  private supportsApiMargin(capabilityId: string): boolean {
    return this.deps.matrix.supplierCapabilities.find((c) => c.id === capabilityId)?.supportsApiMargin === true;
  }

  // ------------------------------------------------------------------ search

  async places(text: string, language: 'tr' | 'en'): Promise<readonly PlaceSuggestion[]> {
    const out = await this.deps.hotels.searchPlaces({ text, language });
    if (out.kind === 'SUCCEEDED') return out.value;
    if (out.kind === 'CAPABILITY_NOT_AVAILABLE') return [];
    throw providerUnavailable();
  }

  /** Hotels by name in one country, for editors picking hotel codes of a list (ADR-0014); staff routes only. */
  async hotelsByName(name: string, countryCode: string, language: 'tr' | 'en'): Promise<readonly HotelNameMatch[]> {
    const out = await this.deps.hotels.searchHotelsByName({ name, countryCode, language });
    if (out.kind === 'SUCCEEDED') return out.value;
    if (out.kind === 'CAPABILITY_NOT_AVAILABLE' || out.kind === 'REJECTED') {
      throw new DomainError('VALIDATION_FAILED', 'Type 2-80 characters of the hotel name and pick a country', { httpStatus: 422, action: 'FIX_FIELDS' });
    }
    throw providerUnavailable();
  }

  async searchHotels(raw: unknown): Promise<HotelSearchView> {
    const input: HotelSearchInput = parse(hotelSearchInput, raw);
    const now = this.clock();
    if (Date.parse(`${input.checkin}T23:59:59Z`) + 86_400_000 < now.getTime()) {
      throw new DomainError('VALIDATION_FAILED', 'Check-in date is in the past', { httpStatus: 422, action: 'FIX_FIELDS' });
    }
    const policy = await this.pricingPolicy();
    const route = await this.route(input.currency, policy);
    const capabilityId = route.funding[0]!.capabilityId;
    const margin = providerMarginForSearch(policy, 'HOTEL', 'PROVIDER_MANAGED');
    const occupancies = input.rooms.map((r, i) => ({ occupancyNumber: i + 1, adults: r.adults, childAges: r.childAges }));
    const target = 'placeId' in input.target ? { placeId: input.target.placeId } : 'hotelIds' in input.target ? { hotelIds: input.target.hotelIds } : { city: input.target };
    const out = await this.deps.hotels.searchHotelRates({
      ...target,
      checkin: input.checkin,
      checkout: input.checkout,
      occupancies,
      guestNationality: input.nationality,
      currency: input.currency,
      margin,
      maxRatesPerHotel: this.deps.settings.maxRatesPerHotel,
      limit: this.deps.settings.maxHotels,
      ...(input.boardType ? { boardType: input.boardType } : {}),
    });
    if (out.kind === 'REJECTED' || out.kind === 'CAPABILITY_NOT_AVAILABLE') {
      throw new DomainError('VALIDATION_FAILED', 'The search could not be run with these criteria', { httpStatus: 422, action: 'FIX_FIELDS' });
    }
    if (out.kind !== 'SUCCEEDED') throw providerUnavailable();

    const hidden = { belowSuggestedPrice: 0, notPriced: 0, notPayableOnline: 0 };
    const stored: StoredOffer[] = [];
    for (const offer of out.value.offers) {
      const priced = this.priceOffer(offer, policy, capabilityId, hidden);
      if (priced) stored.push({ ...priced, key: String(stored.length) });
    }
    const hotelIds = new Set(stored.map((o) => o.hotelId));
    const results: StoredResults = {
      hotels: out.value.hotels.filter((h) => hotelIds.has(h.hotelId)),
      offers: stored,
      pricingPolicy: { id: policy.id, version: policy.version },
      capabilityId,
      hidden,
    };
    await this.checkListPrices(input, stored);
    const expiresAt = new Date(now.getTime() + this.deps.settings.searchTtlSeconds * 1000).toISOString();
    const sessionId = await this.searches.create({
      productType: 'HOTEL',
      environment: this.deps.settings.environment,
      criteria: { ...input, occupancies },
      route: route.route,
      results,
      locale: input.locale,
      displayCurrency: input.currency,
      guestNationality: input.nationality,
      expiresAt,
    });
    return this.searchView(sessionId, expiresAt, input, results, hidden);
  }

  /** Compares this search with the stored list prices; never fails the search (ADR-0014). */
  private async checkListPrices(input: HotelSearchInput, offers: readonly StoredOffer[]): Promise<void> {
    try {
      await this.hotelListPriceChecks.record({
        currency: input.currency,
        nationality: input.nationality,
        checkin: input.checkin,
        checkout: input.checkout,
        rooms: input.rooms,
        boardType: input.boardType,
        requestedHotelIds: 'hotelIds' in input.target ? input.target.hotelIds : null,
        offers,
      });
    } catch (err) {
      this.deps.log?.warn('list price check not recorded', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** One customer price per offer, exactly as hotel list pages price it (ADR-0014). */
  private priceOffer(offer: HotelOffer, policy: PricingPolicyVersion, capabilityId: string, hidden: HotelSearchView['hidden']): Omit<StoredOffer, 'key'> | null {
    return priceHotelOffer(offer, policy, { supportsApiMargin: this.supportsApiMargin(capabilityId), enforceRateParity: this.deps.settings.enforceRateParity }, hidden);
  }

  private searchView(sessionId: string, expiresAt: string, input: HotelSearchInput, results: StoredResults, hidden: HotelSearchView['hidden']): HotelSearchView {
    const nights = nightsBetween(input.checkin, input.checkout);
    const byHotel = new Map<string, HotelOfferView[]>();
    for (const o of results.offers) {
      const total = fromJson(o.sell);
      const view: HotelOfferView = {
        key: o.key,
        roomName: o.room.name,
        boardType: o.room.boardType,
        boardName: o.room.boardName,
        total: o.sell,
        perNightAverage: toJson(money(total.currency, total.minor / BigInt(nights))),
        payAtProperty: o.payAtProperty,
        cancellation: cancellationView(storedCancellation(o.cancellation)),
      };
      byHotel.set(o.hotelId, [...(byHotel.get(o.hotelId) ?? []), view]);
    }
    const hotels: HotelResultView[] = [];
    for (const [hotelId, offers] of byHotel) {
      const sorted = [...offers].sort((a, b) => (BigInt(a.total.minor) < BigInt(b.total.minor) ? -1 : BigInt(a.total.minor) > BigInt(b.total.minor) ? 1 : 0));
      const h = results.hotels.find((x) => x.hotelId === hotelId);
      hotels.push({
        hotelId,
        name: h?.name ?? hotelId,
        photo: h?.mainPhoto ?? h?.thumbnail ?? null,
        address: h?.address ?? null,
        city: h?.city ?? null,
        rating: h?.rating ?? null,
        stars: h?.stars ?? null,
        from: sorted[0]!.total,
        offers: sorted,
      });
    }
    hotels.sort((a, b) => (BigInt(a.from.minor) < BigInt(b.from.minor) ? -1 : 1));
    return { sessionId, expiresAt, currency: input.currency, nights, paymentMode: 'PROVIDER_MANAGED', hotels, hidden };
  }

  /** Re-renders a stored search (GET /search-sessions/{id}); prices come from the stored snapshot only. */
  async searchSession(sessionId: string): Promise<HotelSearchView> {
    const session = await this.searches.get<StoredResults, HotelSearchInput>(sessionId);
    if (!session || session.environment !== this.deps.settings.environment || session.productType !== 'HOTEL') throw notFound();
    if (new Date(session.expiresAt).getTime() <= this.clock().getTime()) throw new QuoteError('QUOTE_EXPIRED', 'Search results expired; please search again');
    return this.searchView(session.id, session.expiresAt, session.criteria, session.results, session.results.hidden);
  }

  /** Currencies a customer can pay in right now (an approved policy and an open route are needed). */
  async availableCurrencies(): Promise<string[]> {
    const policy = await this.policies.activePricing(this.deps.settings.policyId);
    if (!policy) return [];
    const open: string[] = [];
    for (const c of this.deps.settings.currencies) {
      try {
        await this.route(c, policy);
        open.push(c);
      } catch (err) {
        if (!(err instanceof CapabilityNotAvailableError)) throw err;
      }
    }
    return open;
  }

  /** Currencies a customer can buy flights in right now (approved policy with a FLIGHT rule, open route). */
  async availableFlightCurrencies(): Promise<string[]> {
    if (!this.flights) return [];
    const policy = await this.policies.activePricing(this.deps.settings.policyId);
    if (!policy || !policy.rules.some((r) => r.productType === 'FLIGHT' && r.paymentMode === 'PROVIDER_MANAGED')) return [];
    return openFlightCurrencies(this.deps.settings.currencies, (c) => this.route(c, policy, 'FLIGHT'));
  }

  /** The search criteria behind a session, for pre-filling the form (no prices). */
  async searchCriteria(sessionId: string): Promise<HotelSearchInput | null> {
    const session = await this.searches.get<StoredResults, HotelSearchInput>(sessionId);
    return session && session.environment === this.deps.settings.environment ? session.criteria : null;
  }

  // ------------------------------------------------------------------ quote

  /** Turns an offer key into an immutable, server-side quote version (the price the customer accepts). */
  async selectOffer(sessionId: string, key: string): Promise<QuoteView> {
    const session = await this.searches.get<StoredResults, HotelSearchInput & { occupancies: Array<{ occupancyNumber: number; adults: number; childAges: number[] }> }>(sessionId);
    const now = this.clock();
    if (!session || session.environment !== this.deps.settings.environment) throw notFound();
    if (new Date(session.expiresAt).getTime() <= now.getTime()) throw new QuoteError('QUOTE_EXPIRED', 'Search results expired; please search again');
    const offer = session.results.offers.find((o) => o.key === key);
    if (!offer) throw notFound();
    const policy = await this.pricingPolicy();
    if (policy.id !== session.results.pricingPolicy.id || policy.version !== session.results.pricingPolicy.version) {
      throw new QuoteError('QUOTE_CHANGED', 'Prices were updated; please search again');
    }
    const hotel = session.results.hotels.find((h) => h.hotelId === offer.hotelId);
    const c = session.criteria;
    const quoteId = await this.quotes.createQuote('HOTEL', HOTEL_PROVIDER);
    const sell = fromJson(offer.sell);
    const option = {
      hotelId: offer.hotelId,
      hotelName: hotel?.name ?? offer.hotelId,
      address: hotel?.address ?? null,
      photo: hotel?.mainPhoto ?? hotel?.thumbnail ?? null,
      room: offer.room,
      checkin: c.checkin,
      checkout: c.checkout,
      nights: nightsBetween(c.checkin, c.checkout),
      rooms: c.occupancies.filter((o) => offer.occupancyNumbers.includes(o.occupancyNumber)),
      occupancyNumbers: offer.occupancyNumbers,
      capabilityId: session.results.capabilityId,
      // Older search sessions (before ADR-0009) carry no parity record.
      rateParity: offer.rateParity ?? null,
    };
    const travelers = option.rooms.flatMap((r) => [
      ...Array.from({ length: r.adults }, (_, i) => ({ travelerId: `r${r.occupancyNumber}a${i + 1}`, type: 'ADULT' as const, age: null })),
      ...r.childAges.map((age, i) => ({ travelerId: `r${r.occupancyNumber}c${i + 1}`, type: (age < 2 ? 'INFANT' : 'CHILD') as 'INFANT' | 'CHILD', age })),
    ]);
    const quoteVersionId = await this.quotes.addVersion(quoteId, {
      version: 1,
      environment: this.deps.settings.environment,
      productType: 'HOTEL',
      providerId: HOTEL_PROVIDER,
      offerRef: offer.offerRef as QuoteVersionSnapshot['offerRef'],
      option,
      travelers,
      supplierCost: fromJson(offer.price),
      providerCommission: fromJson(offer.commission),
      sell,
      chargeNow: sell,
      fx: null,
      fees: [],
      payAtProperty: offer.payAtProperty.map(fromJson),
      cancellation: storedCancellation(offer.cancellation),
      expiresAt: new Date(now.getTime() + this.deps.settings.quoteTtlSeconds * 1000).toISOString(),
      pricingPolicy: session.results.pricingPolicy,
    });
    const q = await this.quotes.get(quoteVersionId);
    return this.quoteView(q!);
  }

  private quoteView(q: QuoteVersionSnapshot): QuoteView {
    return quoteView(q, this.deps.settings.termsVersion);
  }


  async quote(quoteVersionId: string): Promise<QuoteView> {
    if (!/^[0-9a-f-]{36}$/i.test(quoteVersionId)) throw notFound();
    const q = await this.quotes.get(quoteVersionId);
    if (!q || q.environment !== this.deps.settings.environment || q.productType !== 'HOTEL') throw notFound();
    return this.quoteView(q);
  }

  // ------------------------------------------------------------------ checkout

  /**
   * Guest checkout with the provider-managed payment. Idempotent per key (same body -> same order; different body
   * -> 409). Creates the order, then the provider prebook with its payment session.
   */
  async createCheckout(raw: unknown): Promise<{ orderId: string; accessToken: string; order: OrderView }> {
    const input = parse(checkoutInput, raw);
    const s = this.deps.settings;
    const begin = await this.idempotency.begin('checkout', input.idempotencyKey, input, 86_400);
    if (begin.state === 'COMPLETED') {
      const orderId = (begin.body as { orderId: string }).orderId;
      return { orderId, accessToken: orderAccessToken(s.accessTokenSecret, orderId), order: await this.view(orderId) };
    }
    if (begin.state === 'IN_PROGRESS') throw new DomainError('PAYMENT_UNRESOLVED', 'This checkout is already being processed', { httpStatus: 409, retryable: true, action: 'RETRY' });
    let orderId: string;
    try {
      orderId = await this.submit(input);
    } catch (err) {
      // Nothing was created: the customer may fix the input and retry with the same key.
      await this.idempotency.release('checkout', input.idempotencyKey);
      throw err;
    }
    await this.idempotency.complete('checkout', input.idempotencyKey, 201, { orderId });
    // Prebook with the provider payment session; a slow or failed provider answer is visible in the order stage.
    await this.orchestrator.start(orderId);
    return { orderId, accessToken: orderAccessToken(s.accessTokenSecret, orderId), order: await this.view(orderId) };
  }

  private async submit(input: ReturnType<typeof checkoutInput.parse>): Promise<string> {
    const s = this.deps.settings;
    const quote = await this.quotes.get(input.quoteVersionId);
    if (!quote || quote.environment !== s.environment || quote.productType !== 'HOTEL') throw notFound();
    if (input.termsVersion !== s.termsVersion) throw new QuoteError('QUOTE_CHANGED', 'The sales terms were updated; please review them again');
    if (new Date(quote.expiresAt).getTime() <= this.clock().getTime()) throw new QuoteError('QUOTE_EXPIRED', 'The offer expired; please search again');
    const option = quote.option as { occupancyNumbers: number[]; capabilityId: string };
    const guestRooms = new Set(input.roomGuests.map((g) => g.occupancyNumber));
    if (option.occupancyNumbers.some((n) => !guestRooms.has(n)) || guestRooms.size !== input.roomGuests.length || guestRooms.size !== option.occupancyNumbers.length) {
      throw new DomainError('VALIDATION_FAILED', 'One lead guest is required for each room', { httpStatus: 422, action: 'FIX_FIELDS' });
    }
    const policy = await this.pricingPolicy();
    const route = await this.route(quote.chargeNow.currency, policy);

    await this.quotes.accept(quote.id, input.termsVersion);
    const accepted = (await this.quotes.get(quote.id))!;
    assertQuoteUsable(accepted, this.clock());

    const customerId = await this.checkout.createGuestCustomer(input.holder.email, input.locale);
    const payBy = new Date(this.clock().getTime() + s.payBySeconds * 1000).toISOString();
    const { orderId } = await this.checkout.submitOrder({
      customerId,
      environment: s.environment,
      route: route.route,
      chargeTotal: accepted.chargeNow,
      checkoutExpiresAt: payBy,
      items: [
        {
          quoteVersionId: accepted.id,
          productType: 'HOTEL',
          providerId: HOTEL_PROVIDER,
          connectorId: HOTEL_CONNECTOR_ID,
          chargeAllocation: accepted.chargeNow,
          supplierCost: accepted.supplierCost,
          funding: { method: 'PROVIDER_MANAGED', capabilityId: route.funding[0]!.capabilityId },
          connector: { holdSemantics: 'PREBOOK_VALIDATION', reversibilityRank: 10, requiresIssuance: false, needsPrebook: true },
          guests: {
            holder: input.holder,
            roomGuests: input.roomGuests.map((g) => ({ ...g, email: input.holder.email })),
          },
        },
      ],
      payment: { gatewayId: HOTEL_PROVIDER, mode: 'PROVIDER_MANAGED', idempotencyKey: `checkout:${input.idempotencyKey}`, payBy },
    });
    return orderId;
  }

  private async authorized(orderId: string, token: string | null | undefined): Promise<OrderAggregate> {
    if (!/^[0-9a-f-]{36}$/i.test(orderId) || !canAccessOrder(this.deps.settings.accessTokenSecret, orderId, token)) throw notFound();
    const agg = await this.store.load(orderId);
    if (agg.environment !== this.deps.settings.environment || agg.route.mode !== 'PROVIDER_MANAGED') throw notFound();
    return agg;
  }

  /** Parameters for the provider's payment component, only for the order's owner and only while payment is open. */
  async paymentSession(orderId: string, token: string | null | undefined): Promise<PaymentSessionView> {
    let agg = await this.authorized(orderId, token);
    if (agg.payment!.status === 'NEW' && agg.status === 'PROCESSING') {
      await this.orchestrator.start(orderId);
      agg = await this.store.load(orderId);
    }
    const p = agg.payment!;
    const stage = this.stage(agg);
    if (p.status === 'PENDING' && p.providerClientSecret && stage === 'AWAITING_PAYMENT') {
      // Handing out the secret is recorded: from now on the customer may pay, so the payment intent stays (ADR-0013).
      const secret = await this.orchestrator.issuePaymentSecret(orderId);
      if (secret) {
        const env = this.deps.settings.environment;
        return { state: 'READY', provider: 'NUITEE', publicKey: env === 'production' ? 'live' : env === 'sandbox' ? 'sandbox' : 'mock', secretKey: secret, payBy: p.payBy };
      }
      return { state: 'NOT_READY', stage: this.stage(await this.store.load(orderId)) };
    }
    return { state: stage === 'PREPARING_PAYMENT' ? 'NOT_READY' : 'CLOSED', stage };
  }

  /** Browser return from the payment component: a trigger only, the stored transaction is used (§5.1). */
  async finalize(orderId: string, token: string | null | undefined): Promise<OrderView> {
    await this.authorized(orderId, token);
    await this.orchestrator.customerReturned(orderId);
    return this.view(orderId);
  }

  async order(orderId: string, token: string | null | undefined): Promise<OrderView> {
    await this.authorized(orderId, token);
    return this.view(orderId);
  }

  /** Whether the order's owner may cancel online now, and at what expected fee (T27, ADR-0021). */
  async customerCancellation(orderId: string, token: string | null | undefined): Promise<CustomerCancellationView | null> {
    return customerCancellation(await this.authorized(orderId, token), { quotes: this.quotes, now: this.clock() });
  }

  /**
   * Cancels a hotel booking for its owner (T27, ADR-0021). The fee the customer accepted must equal the fee expected
   * now: if the free period ended while the page was open, the customer sees the new fee first. The cancellation runs
   * as a staff one would (intent stored before the call, a lost answer is read back, never re-sent); a refusal opens a
   * task so someone contacts the customer.
   */
  async customerCancel(orderId: string, token: string | null | undefined, body: unknown): Promise<CustomerCancelResult> {
    const agg = await this.authorized(orderId, token);
    const fee = (body as { acceptedFee?: { currency?: unknown; minor?: unknown } } | null)?.acceptedFee;
    if (!fee || typeof fee.currency !== 'string' || typeof fee.minor !== 'string' || !/^\d{1,15}$/.test(fee.minor)) {
      throw new DomainError('VALIDATION_FAILED', 'The accepted cancellation fee is required', { httpStatus: 400 });
    }
    const now = this.clock();
    const view = await customerCancellation(agg, { quotes: this.quotes, now });
    if (view?.state !== 'AVAILABLE') throw new DomainError('ILLEGAL_TRANSITION', 'This booking cannot be cancelled online', { httpStatus: 409 });
    if (fee.currency !== view.expectedFee.currency || fee.minor !== view.expectedFee.minor) {
      throw new DomainError('VERSION_CONFLICT', 'The cancellation fee has changed; please review it again', { httpStatus: 409, action: 'REVIEW' });
    }
    const expected = fromJson(view.expectedFee);
    const result = await this.orchestrator.cancel(orderId, 'customer:site', 'Cancelled by the customer on the site', {
      expectedPenalty: expected,
      customerAcceptedFee: expected.minor > 0n,
      requestedByCustomer: true,
    });
    return {
      outcome: result.outcome,
      order: await this.view(orderId),
      cancellation: await customerCancellation(await this.store.load(orderId), { quotes: this.quotes, now: this.clock() }),
    };
  }

  private stage(agg: OrderAggregate): OrderStage {
    return orderStage(agg);
  }


  private async view(orderId: string): Promise<OrderView> {
    return loadOrderView(this.store, this.quotes, orderId, this.deps.settings.termsVersion);
  }

}
