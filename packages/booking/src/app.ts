import {
  CapabilityNotAvailableError,
  DomainError,
  type CapabilityMatrix,
  type HotelConnector,
  type HotelOffer,
  type HotelSummary,
  type PlaceSuggestion,
  type SourceLock,
} from '@texholiday/contracts';
import { CheckoutRepository, DrizzleOrderStore, IdempotencyRepository, PolicyRepository, QuoteRepository, SearchSessionRepository, type CoreDb } from '@texholiday/db';
import {
  ProviderManagedOrchestrator,
  QuoteError,
  assertQuoteUsable,
  freeCancellation,
  selectPaymentRoutes,
  type OrderAggregate,
  type QuoteVersionSnapshot,
  type RouteOption,
} from '@texholiday/domain';
import {
  PricingPolicyError,
  computeSellPrice,
  fromJson,
  money,
  providerMarginForSearch,
  toJson,
  type Money,
  type MoneyJson,
  type PricingPolicyVersion,
} from '@texholiday/pricing';
import { canAccessOrder, orderAccessToken } from './access';
import { NuiteeHotelProviderManagedPort } from './nuitee-pm-port';
import type { BookingSettings } from './settings';
import { checkoutInput, hotelSearchInput, parse, type HotelSearchInput } from './validation';
import type { CancellationView, HotelOfferView, HotelResultView, HotelSearchView, OrderStage, OrderView, PaymentSessionView, QuoteView } from './views';

const HOTEL_PROVIDER = 'nuitee';
const HOTEL_CONNECTOR_ID = 'nuitee-hotel';
/** Payment type of the Nuitee payment SDK on an offer; offers without it cannot be paid online through Nuitee. */
const PROVIDER_PAYMENT_TYPE = 'NUITEE_PAY';

interface StoredOffer {
  key: string;
  hotelId: string;
  offerRef: string;
  price: MoneyJson;
  commission: MoneyJson;
  sell: MoneyJson;
  payAtProperty: MoneyJson[];
  cancellation: { timezone: string; refundable: boolean; steps: Array<{ from: string; penalty: MoneyJson }>; providerText: string | null };
  occupancyNumbers: number[];
  room: { name: string | null; boardType: string | null; boardName: string | null };
}

interface StoredResults {
  hotels: HotelSummary[];
  offers: StoredOffer[];
  pricingPolicy: { id: string; version: number };
  capabilityId: string;
}

export interface BookingAppDeps {
  db: CoreDb;
  hotels: HotelConnector;
  matrix: CapabilityMatrix;
  sourceLock: SourceLock;
  settings: BookingSettings;
  clock?: () => Date;
  workerId?: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found', { httpStatus: 404 });
const providerUnavailable = () => new DomainError('PROVIDER_UNAVAILABLE', 'The hotel provider did not answer; please try again', { httpStatus: 503, retryable: true, action: 'RETRY' });

function nightsBetween(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}

const storedCancellation = (c: StoredOffer['cancellation']): QuoteVersionSnapshot['cancellation'] => ({ ...c, steps: c.steps.map((s) => ({ from: s.from, penalty: fromJson(s.penalty) })) });

function cancellationView(c: QuoteVersionSnapshot['cancellation']): CancellationView {
  const free = freeCancellation(c);
  return {
    refundable: c.refundable,
    freeUntil: free.kind === 'FREE_UNTIL' ? free.lastFreeInstant.toISOString() : null,
    steps: c.steps.map((s) => ({ from: s.from, penalty: toJson(s.penalty) })),
  };
}

/**
 * Application services for the hotel booking flow (spec §14) with the provider-managed payment (ADR-0008):
 * search → offer key → server-side quote → guest checkout → provider payment component → finalize → status.
 */
export class BookingApp {
  readonly orchestrator: ProviderManagedOrchestrator;
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
    this.orchestrator = new ProviderManagedOrchestrator({
      store: this.store,
      port: new NuiteeHotelProviderManagedPort(deps.hotels, this.quotes, this.checkout),
      clock: this.clock,
      workerId: deps.workerId ?? `booking-${process.pid}`,
      policy: {
        intentLeaseSeconds: s.intentLeaseSeconds,
        // Quick retries while the customer is on the payment form, then every few minutes until the deadline.
        finalizeRetrySeconds: (attempt) => Math.min(20 * 2 ** Math.max(0, attempt - 1), 300),
        maxAutomaticLookups: s.maxAutomaticLookups,
      },
    });
  }

  // ------------------------------------------------------------------ routing & pricing

  private async pricingPolicy(): Promise<PricingPolicyVersion> {
    const p = await this.policies.activePricing(this.deps.settings.policyId);
    if (!p) throw new CapabilityNotAvailableError('Sales are closed: no approved pricing policy', ['pricing policy not approved']);
    return p;
  }

  /** The route is chosen on the server (§4.1). Only the provider-managed route exists until the own gateway is integrated. */
  private async route(currency: string, policy: PricingPolicyVersion): Promise<RouteOption> {
    const s = this.deps.settings;
    if (!s.currencies.includes(currency)) throw new CapabilityNotAvailableError(`Currency ${currency} is not offered`, [`currency ${currency} not offered`]);
    const decision = selectPaymentRoutes({
      items: [{ itemId: 'hotel', productType: 'HOTEL', providerId: HOTEL_PROVIDER }],
      chargeCurrency: currency,
      environment: s.environment,
      matrix: this.deps.matrix,
      sourceLock: this.deps.sourceLock,
      gateways: [],
      pricingPolicy: policy,
      riskPolicy: await this.policies.activeRisk(s.policyId),
    });
    if (!decision.available) throw new CapabilityNotAvailableError('No payment route for this currency', decision.reasons);
    const pm = [decision.defaultOption, ...decision.alternatives].find((o) => o.route.mode === 'PROVIDER_MANAGED');
    if (!pm) throw new CapabilityNotAvailableError('Only provider-managed payment is available', ['own gateway not integrated (ADR-0008)']);
    return pm;
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
    };
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

  /** One customer price per offer: the provider price with our policy margin, checked against the hotel's public floor. */
  private priceOffer(offer: HotelOffer, policy: PricingPolicyVersion, capabilityId: string, hidden: HotelSearchView['hidden']): Omit<StoredOffer, 'key'> | null {
    if (!offer.paymentTypes.includes(PROVIDER_PAYMENT_TYPE)) {
      hidden.notPayableOnline += 1;
      return null;
    }
    let sell: Money;
    try {
      sell = computeSellPrice({
        productType: 'HOTEL',
        paymentMode: 'PROVIDER_MANAGED',
        providerPrice: offer.price,
        providerAppliedMargin: offer.providerAppliedMargin,
        providerSupportsApiMargin: this.supportsApiMargin(capabilityId),
        policy,
      }).sell;
    } catch (err) {
      if (!(err instanceof PricingPolicyError)) throw err;
      hidden.notPriced += 1;
      return null;
    }
    // Public prices may not undercut the hotel's suggested selling price (rate parity); with the provider collecting
    // the payment we cannot raise the price locally, so such offers are not shown publicly.
    const ssp = offer.suggestedSellingPrice;
    if (ssp && (ssp.currency !== sell.currency || sell.minor < ssp.minor)) {
      hidden.belowSuggestedPrice += 1;
      return null;
    }
    return {
      hotelId: offer.hotelId,
      offerRef: offer.offerRef,
      price: toJson(offer.price),
      commission: toJson(offer.providerAppliedMargin),
      sell: toJson(sell),
      payAtProperty: offer.payAtProperty.map(toJson),
      cancellation: { ...offer.cancellation, steps: offer.cancellation.steps.map((s) => ({ from: s.from, penalty: toJson(s.penalty) })) },
      occupancyNumbers: [...offer.occupancyNumbers],
      room: offer.room,
    };
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
      termsVersion: this.deps.settings.termsVersion,
      paymentProvider: 'NUITEE',
    };
  }

  async quote(quoteVersionId: string): Promise<QuoteView> {
    if (!/^[0-9a-f-]{36}$/i.test(quoteVersionId)) throw notFound();
    const q = await this.quotes.get(quoteVersionId);
    if (!q || q.environment !== this.deps.settings.environment) throw notFound();
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
      const env = this.deps.settings.environment;
      return { state: 'READY', provider: 'NUITEE', publicKey: env === 'production' ? 'live' : env === 'sandbox' ? 'sandbox' : 'mock', secretKey: p.providerClientSecret, payBy: p.payBy };
    }
    return { state: stage === 'PREPARING_PAYMENT' ? 'NOT_READY' : 'CLOSED', stage };
  }

  /** Browser return from the payment component: a trigger only, the stored transaction is used (§5.1). */
  async finalize(orderId: string, token: string | null | undefined): Promise<OrderView> {
    await this.authorized(orderId, token);
    await this.orchestrator.finalize(orderId, 1);
    return this.view(orderId);
  }

  async order(orderId: string, token: string | null | undefined): Promise<OrderView> {
    await this.authorized(orderId, token);
    return this.view(orderId);
  }

  private stage(agg: OrderAggregate): OrderStage {
    const it = agg.items[0]!;
    const p = agg.payment!;
    if (agg.status === 'CONFIRMED') return 'CONFIRMED';
    if (agg.status === 'ACTION_REQUIRED') return 'NEEDS_ATTENTION';
    if (agg.status === 'CANCELLED') {
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

  private async view(orderId: string): Promise<OrderView> {
    const agg = await this.store.load(orderId);
    const it = agg.items[0]!;
    const q = await this.quotes.get(it.quoteVersionId);
    return {
      orderId,
      stage: this.stage(agg),
      paymentHoldMayExist: agg.tasks.some((t) => t.reason === 'PROVIDER_PAYMENT_HOLD'),
      bookingReference: agg.status === 'CONFIRMED' ? it.booking.providerBookingRef : null,
      voucherReady: it.booking.voucherReady,
      payBy: agg.payment!.payBy,
      quote: this.quoteView(q!),
    };
  }
}
