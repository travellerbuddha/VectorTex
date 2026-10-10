import {
  notAvailable,
  opaque,
  type CallEvidence,
  type ConnectorDescriptor,
  type ExternalOutcome,
  type HotelConnector,
  type HotelContent,
  type HotelFunding,
  type HotelNameMatch,
  type HotelOffer,
  type HotelRoomGuest,
  type HotelSearchCriteria,
  type HotelSummary,
  type OpaqueRef,
  type PlaceSuggestion,
  type ProviderBookingState,
  type ProviderManagedTransactionRef,
  type QuotedOffer,
} from '@texholiday/contracts';
import { money, percentOf, add, type Money } from '@texholiday/pricing';

/**
 * MOCK hotel connector for local development, UI work and automated tests (ADR-0005). Every id starts with MOCK,
 * the environment is 'mock', and the registry/config refuse it in production. Prices are invented test data.
 * The payment component is simulated: a transaction counts as paid only after `markPaid` (the mock payment page).
 * Like the Nuitee sandbox (2026-10-09): a client reference is used up by any book answer, "payment not completed"
 * included (a repeat is a duplicate), and a transaction books at most once.
 */
export class MockHotelConnector implements HotelConnector {
  private seq = 0;
  /** Ids stay unique across restarts (like real provider ids), so stored orders never collide. */
  private readonly run = Math.random().toString(36).slice(2, 8).toUpperCase();
  private readonly offers = new Map<string, { offer: QuotedOffer; hotelId: string }>();
  private readonly prebooks = new Map<string, { offerRef: string; transactionId: string | null; price: Money; commission: Money }>();
  private readonly paid = new Set<string>();
  private readonly bookings = new Map<string, ProviderBookingState>();
  private readonly usedReferences = new Set<string>();
  private readonly consumedTransactions = new Set<string>();
  /** Test hooks: force the next book/prebook outcome. */
  nextBook: ExternalOutcome<ProviderBookingState> | null = null;
  nextPrebookPriceChange = false;
  /** Test hook: per check-in date change of every net price, in basis points (e.g. -1000 = 10 % cheaper). */
  priceAdjustBp: (checkin: string) => bigint = () => 0n;
  /** Test hook: the next searches fail as a lost answer (timeout). */
  failSearches = 0;
  /** Test hook: hotels with no bookable offer (sold out). */
  soldOut = new Set<string>();
  /** Calls made, per operation (tests count provider calls). */
  readonly calls: Record<string, number> = {};

  descriptor(): ConnectorDescriptor {
    return {
      connectorId: 'nuitee-hotel',
      providerId: 'nuitee',
      productType: 'HOTEL',
      environment: 'mock',
      isMock: true,
      requiredSources: [],
      operations: {
        searchRates: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        placeDetails: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        searchHotelsByName: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        hotelContent: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        prebook: { effect: 'CREATES_PROVIDER_SESSION', lostResponse: 'NONE' },
        book: { effect: 'CREATES_PROVIDER_RESERVATION', lostResponse: 'CLIENT_REFERENCE_LOOKUP' },
        lookupByClientReference: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        getBooking: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        cancel: { effect: 'CANCELS_PROVIDER_RESERVATION', lostResponse: 'CLIENT_REFERENCE_LOOKUP' },
      },
      holdSemantics: 'PREBOOK_VALIDATION',
      reversibilityRank: 10,
      maxAsyncConfirmationSeconds: 0,
      requiresIssuance: false,
    };
  }

  private evidence(operation: string): CallEvidence {
    return { operation: `mock.hotel.${operation}`, environment: 'mock', at: new Date().toISOString(), httpStatus: 200, upstreamRequestId: null, durationMs: 1 };
  }

  private static readonly HOTELS: readonly HotelSummary[] = [
    { hotelId: 'MOCK-H1', name: 'MOCK Lara Beach Resort', mainPhoto: null, thumbnail: null, address: 'MOCK Lara, Antalya', city: 'Antalya', countryCode: 'TR', rating: 8.7, stars: 5 },
    { hotelId: 'MOCK-H2', name: 'MOCK Kaleiçi Boutique', mainPhoto: null, thumbnail: null, address: 'MOCK Kaleiçi, Antalya', city: 'Antalya', countryCode: 'TR', rating: 9.1, stars: 4 },
    { hotelId: 'MOCK-H3', name: 'MOCK Belek Golf Resort', mainPhoto: null, thumbnail: null, address: 'MOCK Belek, Serik, Antalya', city: 'Belek', countryCode: 'TR', rating: 8.9, stars: 5 },
  ];

  /** MOCK places: Antalya holds H1 and H2 (as every search did before), Belek holds H3. */
  private static readonly PLACES: Record<string, { name: string; address: string; hotels: readonly string[] }> = {
    'MOCK-PLACE-ANTALYA': { name: 'Antalya (MOCK)', address: 'Antalya, Türkiye', hotels: ['MOCK-H1', 'MOCK-H2'] },
    'MOCK-PLACE-BELEK': { name: 'Belek (MOCK)', address: 'Serik, Antalya, Türkiye', hotels: ['MOCK-H3'] },
  };

  private count(op: string): void {
    this.calls[op] = (this.calls[op] ?? 0) + 1;
  }

  /** Marks the simulated payment of a transaction as completed (mock payment page / tests). */
  markPaid(transactionId: string): void {
    this.paid.add(transactionId);
  }

  async searchPlaces(input: { text: string; language: string }): Promise<ExternalOutcome<readonly PlaceSuggestion[]>> {
    const text = input.text.trim().toLocaleLowerCase('tr');
    if (text.length < 2) return notAvailable('PLACE_QUERY', 'Type 2-100 characters');
    const belek = MockHotelConnector.PLACES['MOCK-PLACE-BELEK']!;
    const places: PlaceSuggestion[] = [{ placeId: 'MOCK-PLACE-ANTALYA', name: 'Antalya (MOCK)', address: 'Antalya, Türkiye', types: ['locality'] }];
    if (text.startsWith('bel')) places.unshift({ placeId: 'MOCK-PLACE-BELEK', name: belek.name, address: belek.address, types: ['locality'] });
    return { kind: 'SUCCEEDED', value: places, evidence: this.evidence('places') };
  }

  async placeDetails(input: { placeId: string; language: string }): Promise<ExternalOutcome<PlaceSuggestion | null>> {
    this.count('placeDetails');
    const p = MockHotelConnector.PLACES[input.placeId];
    return { kind: 'SUCCEEDED', value: p ? { placeId: input.placeId, name: p.name, address: p.address, types: ['locality'] } : null, evidence: this.evidence('placeDetails') };
  }

  async searchHotelsByName(input: { name: string; countryCode: string; language: string }): Promise<ExternalOutcome<readonly HotelNameMatch[]>> {
    this.count('searchHotelsByName');
    const q = input.name.trim().toLocaleLowerCase('tr');
    if (q.length < 2 || q.length > 80) return notAvailable('HOTEL_NAME', 'Type 2-80 characters');
    if (!/^[A-Z]{2}$/.test(input.countryCode)) return notAvailable('COUNTRY', 'ISO 3166-1 alpha-2 country code');
    const hits = MockHotelConnector.HOTELS.filter((h) => h.countryCode === input.countryCode && h.name.toLocaleLowerCase('tr').includes(q));
    return { kind: 'SUCCEEDED', value: hits.map((h) => ({ hotelId: h.hotelId, name: h.name, city: h.city, countryCode: h.countryCode, address: h.address, stars: h.stars })), evidence: this.evidence('hotelNames') };
  }

  /** MOCK content (invented, labelled); images are the site's own placeholder so pages render offline. */
  async hotelContent(input: { hotelId: string; language: string }): Promise<ExternalOutcome<HotelContent | null>> {
    this.count('hotelContent');
    const h = MockHotelConnector.HOTELS.find((x) => x.hotelId === input.hotelId);
    if (!h) return { kind: 'SUCCEEDED', value: null, evidence: this.evidence('hotelContent') };
    const tr = input.language === 'tr';
    const n = h.hotelId.slice(-1);
    return {
      kind: 'SUCCEEDED',
      value: {
        hotelId: h.hotelId,
        language: input.language,
        name: h.name,
        description: tr ? `MOCK açıklama: ${h.name} denize yakın, test amaçlı uydurma bir oteldir.\n\nMOCK ikinci paragraf.` : `MOCK description: ${h.name} is an invented test hotel near the sea.\n\nMOCK second paragraph.`,
        stars: h.stars,
        rating: h.rating,
        reviewCount: 100 * Number(n),
        address: h.address,
        city: h.city,
        country: 'tr',
        location: { latitude: 36.85 + Number(n) / 100, longitude: 30.85 + Number(n) / 100 },
        images: [
          { url: `/mock/hotel-${n}.svg`, caption: tr ? 'MOCK görsel' : 'MOCK image' },
          { url: `/mock/hotel-${n}-b.svg`, caption: null },
        ],
        facilities: tr ? ['MOCK Açık havuz', 'MOCK Ücretsiz Wi-Fi', 'MOCK Spa', 'MOCK Otopark'] : ['MOCK Outdoor pool', 'MOCK Free Wi-Fi', 'MOCK Spa', 'MOCK Parking'],
        checkinTime: '14:00',
        checkoutTime: '12:00',
        importantInformation: tr ? 'MOCK: Giriş için kimlik gerekir.' : 'MOCK: ID required at check-in.',
        nearby: [{ name: tr ? 'MOCK Antalya Havalimanı' : 'MOCK Antalya Airport', category: 'airport', distanceKm: 12 + Number(n) }],
        hotelType: 'Hotel',
        chain: null,
      },
      evidence: this.evidence('hotelContent'),
    };
  }

  async searchRates(criteria: HotelSearchCriteria): Promise<ExternalOutcome<readonly HotelOffer[]>> {
    const out = await this.searchHotelRates(criteria);
    return out.kind === 'SUCCEEDED' ? { kind: 'SUCCEEDED', value: out.value.offers, evidence: out.evidence } : out;
  }

  async searchHotelRates(criteria: HotelSearchCriteria): Promise<ExternalOutcome<{ offers: readonly HotelOffer[]; hotels: readonly HotelSummary[] }>> {
    this.count('searchHotelRates');
    if (this.failSearches > 0) {
      this.failSearches -= 1;
      return { kind: 'UNKNOWN', reason: 'TIMEOUT', evidence: this.evidence('search') };
    }
    // Target: given hotel ids, a MOCK place, or (any other target) Antalya's hotels as before.
    const inScope = new Set(
      criteria.hotelIds ? criteria.hotelIds : criteria.placeId && MockHotelConnector.PLACES[criteria.placeId] ? MockHotelConnector.PLACES[criteria.placeId]!.hotels : ['MOCK-H1', 'MOCK-H2'],
    );
    const adjust = this.priceAdjustBp(criteria.checkin);
    const nights = Math.max(1, Math.round((Date.parse(criteria.checkout) - Date.parse(criteria.checkin)) / 86_400_000));
    const rooms = criteria.occupancies.length;
    const bp = BigInt(criteria.margin?.basisPoints ?? 0);
    const offers: HotelOffer[] = [];
    const mk = (hotelId: string, roomName: string, board: [string, string], netPerNight: bigint, refundable: boolean, sspFactorBp: bigint | null) => {
      if (!inScope.has(hotelId) || this.soldOut.has(hotelId) || (criteria.boardType && criteria.boardType !== board[0])) return;
      const base = money(criteria.currency, netPerNight * BigInt(nights) * BigInt(rooms));
      const net = adjust === 0n ? base : add(base, percentOf(base, adjust, 'HALF_EVEN'));
      const commission = percentOf(net, bp, 'HALF_EVEN');
      const price = add(net, commission);
      this.seq += 1;
      const offerRef = opaque(`MOCK-OFFER-${this.run}-${this.seq}`);
      const checkin = Date.parse(`${criteria.checkin}T00:00:00Z`);
      const offer: HotelOffer = {
        offerRef,
        productType: 'HOTEL',
        price,
        providerAppliedMargin: commission,
        suggestedSellingPrice: sspFactorBp === null ? null : add(net, percentOf(net, sspFactorBp, 'HALF_EVEN')),
        payAtProperty: [],
        cancellation: refundable
          ? { timezone: 'UTC', refundable: true, steps: [{ from: new Date(checkin - 3 * 86_400_000).toISOString(), penalty: price }], providerText: null }
          : { timezone: 'UTC', refundable: false, steps: [{ from: new Date(0).toISOString(), penalty: price }], providerText: null },
        expiresAt: null,
        hotelId,
        occupancyNumbers: criteria.occupancies.map((o) => o.occupancyNumber),
        room: { name: roomName, boardType: board[0], boardName: board[1] },
        paymentTypes: ['NUITEE_PAY', 'TRANSACTION_ID', 'ACC_CREDIT_CARD'],
      };
      this.offers.set(offerRef, { offer, hotelId });
      offers.push(offer);
    };
    mk('MOCK-H1', 'MOCK Deluxe Sea View', ['AI', 'All Inclusive'], 18000n, true, 500n);
    mk('MOCK-H1', 'MOCK Standard Room', ['AI', 'All Inclusive'], 14000n, false, null);
    mk('MOCK-H2', 'MOCK Superior Double', ['BI', 'Breakfast Included'], 9000n, true, null);
    // Suggested selling price far above the price: hidden on public pages (rate parity).
    mk('MOCK-H2', 'MOCK Suite', ['BI', 'Breakfast Included'], 20000n, true, 9000n);
    mk('MOCK-H3', 'MOCK Golf Room', ['AI', 'All Inclusive'], 16000n, true, null);
    const priced = new Set(offers.map((o) => o.hotelId));
    return { kind: 'SUCCEEDED', value: { offers, hotels: MockHotelConnector.HOTELS.filter((h) => priced.has(h.hotelId)) }, evidence: this.evidence('search') };
  }

  async prebook(input: { offerRef: OpaqueRef; usePaymentSdk: boolean; clientReference: string }): Promise<
    ExternalOutcome<{
      prebookRef: OpaqueRef;
      offer: QuotedOffer;
      providerManagedTransaction: ProviderManagedTransactionRef | null;
      paymentClientSecret: string | null;
      changeFlags: { price: boolean; cancellation: boolean; board: boolean };
    }>
  > {
    const found = this.offers.get(input.offerRef);
    if (!found) return { kind: 'REJECTED', code: 'NUITEE_4002', message: 'MOCK offer not found', evidence: this.evidence('prebook') };
    this.seq += 1;
    const prebookRef = opaque(`MOCK-PRE-${this.run}-${this.seq}`);
    const transactionId = input.usePaymentSdk ? `MOCK-TX-${this.run}-${this.seq}` : null;
    const priceChanged = this.nextPrebookPriceChange;
    this.nextPrebookPriceChange = false;
    const price = priceChanged ? add(found.offer.price, money(found.offer.price.currency, 100n)) : found.offer.price;
    this.prebooks.set(prebookRef, { offerRef: input.offerRef, transactionId, price, commission: found.offer.providerAppliedMargin });
    return {
      kind: 'SUCCEEDED',
      value: {
        prebookRef,
        offer: { ...found.offer, price },
        providerManagedTransaction: transactionId
          ? { __brand: 'ProviderManagedTransactionRef', providerId: 'nuitee', productType: 'HOTEL', prebookRef, transactionId: opaque(transactionId), environment: 'mock' }
          : null,
        paymentClientSecret: transactionId ? `MOCK_secret_${transactionId}` : null,
        changeFlags: { price: priceChanged, cancellation: false, board: false },
      },
      evidence: this.evidence('prebook'),
    };
  }

  async book(input: { prebookRef: OpaqueRef; clientReference: string; holder: { firstName: string; lastName: string; email: string; phone: string }; guests: readonly HotelRoomGuest[]; funding: HotelFunding }): Promise<ExternalOutcome<ProviderBookingState>> {
    if (this.nextBook) {
      const forced = this.nextBook;
      this.nextBook = null;
      return forced;
    }
    // 4005 "duplicate booking attempt with existing client reference": open, resolved by lookup.
    if (this.usedReferences.has(input.clientReference)) return { kind: 'UNKNOWN', reason: 'AMBIGUOUS', evidence: this.evidence('book:duplicate') };
    const pre = this.prebooks.get(input.prebookRef);
    if (!pre) return { kind: 'REJECTED', code: 'NUITEE_4002', message: 'MOCK prebook not found', evidence: this.evidence('book') };
    this.usedReferences.add(input.clientReference);
    if (input.funding.kind === 'PROVIDER_MANAGED') {
      const tx = input.funding.transaction.transactionId;
      if (tx !== pre.transactionId) return { kind: 'REJECTED', code: 'NUITEE_4002', message: 'MOCK transaction mismatch', evidence: this.evidence('book') };
      if (!this.paid.has(tx) || this.consumedTransactions.has(tx)) return { kind: 'REJECTED', code: 'NUITEE_PAYMENT_NOT_COMPLETED', message: 'payment not completed', evidence: this.evidence('book') };
      this.consumedTransactions.add(tx);
    }
    this.seq += 1;
    const state: ProviderBookingState = {
      status: 'CONFIRMED',
      providerBookingRef: opaque(`MOCK-BK-${this.run}-${this.seq}`),
      clientReference: input.clientReference,
      pnr: null,
      ticketNumbers: [],
      ticketingStatus: 'NOT_APPLICABLE',
      voucherReady: true,
      holdExpiresAt: null,
      supplierCost: pre.price,
      providerCommission: pre.commission,
    };
    this.bookings.set(input.clientReference, state);
    return { kind: 'SUCCEEDED', value: state, evidence: this.evidence('book') };
  }

  async lookupByClientReference(clientReference: string): Promise<ExternalOutcome<ProviderBookingState | null>> {
    return { kind: 'SUCCEEDED', value: this.bookings.get(clientReference) ?? null, evidence: this.evidence('lookup') };
  }

  async getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>> {
    const b = [...this.bookings.values()].find((x) => x.providerBookingRef === providerBookingRef);
    return b ? { kind: 'SUCCEEDED', value: b, evidence: this.evidence('get') } : { kind: 'REJECTED', code: 'NUITEE_BOOKING_NOT_FOUND', message: 'MOCK not found', evidence: this.evidence('get') };
  }

  async cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null; refundAmount: Money | null }>> {
    const entry = [...this.bookings.entries()].find(([, x]) => x.providerBookingRef === providerBookingRef);
    if (!entry) return { kind: 'REJECTED', code: 'NUITEE_BOOKING_NOT_FOUND', message: 'MOCK not found', evidence: this.evidence('cancel') };
    const cancelled: ProviderBookingState = { ...entry[1], status: 'CANCELLED', voucherReady: false };
    this.bookings.set(entry[0], cancelled);
    return { kind: 'SUCCEEDED', value: { ...cancelled, penalty: money(entry[1].supplierCost!.currency, 0n), refundAmount: entry[1].supplierCost }, evidence: this.evidence('cancel') };
  }
}
