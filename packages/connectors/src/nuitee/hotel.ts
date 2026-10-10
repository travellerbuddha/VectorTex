import {
  exactDecimal,
  fetchTransport,
  notAvailable,
  opaque,
  type CallEvidence,
  type CancellationPolicySnapshot,
  type ConnectorDescriptor,
  type ExternalOutcome,
  type HotelConnector,
  type HotelContent,
  type HotelFunding,
  type HotelOffer,
  type HotelRoomGuest,
  HOTEL_BOARD_TYPES,
  type HotelSearchCriteria,
  type HotelSummary,
  type PlaceSuggestion,
  type HttpTransport,
  type OpaqueRef,
  type ProviderBookingState,
  type ProviderManagedTransactionRef,
  type QuotedOffer,
} from '@texholiday/contracts';
import { D, add, fromMajor, money, type Money } from '@texholiday/pricing';
import { classifyHttp, type ParsedHttp } from '../http-outcome';
import { plainText } from '../plain-text';

/**
 * Nuitee (liteAPI) hotel connector built from the pinned contracts:
 * nuitee-openapi-search (POST /hotels/rates), nuitee-openapi-booking (/rates/prebook, /rates/book,
 * /bookings), nuitee-guide-hotel-integration (timeouts, unknown status handling) and
 * nuitee-guide-account-credit-card / credit-line (funding behaviour, sandbox rules).
 */
export const NUITEE_HOTEL_REQUIRED_SOURCES = [
  'nuitee-openapi-search',
  'nuitee-openapi-booking',
  'nuitee-guide-hotel-integration',
  'nuitee-guide-account-credit-card',
  'nuitee-guide-credit-line',
  'nuitee-guide-user-payment',
  'nuitee-openapi-hotel-data',
] as const;

/**
 * Provider-side budgets used by every process (web search, worker, list scanner): the search budget is part of what a
 * price depends on, so it is one constant ("approximately 6 seconds" search; book up to ~2 minutes, hotel-integration guide).
 */
export const NUITEE_HOTEL_TIMEOUTS = { searchTimeoutSeconds: 6, bookTimeoutSeconds: 120 } as const;

export interface NuiteeHotelConfig {
  apiKey: string;
  environment: 'sandbox' | 'production';
  searchBaseUrl: string;
  bookBaseUrl: string;
  /** Provider-side search budget in seconds ("approximately 6 seconds", hotel-integration guide). */
  searchTimeoutSeconds: number;
  /** Prebook/book may run up to ~2 minutes (hotel-integration guide); our HTTP wait must cover it. */
  bookTimeoutSeconds: number;
}

type Json = Record<string, unknown>;
type Parsed = Extract<ParsedHttp, { ok: true }>['parsed'];

/**
 * Error codes after which no reservation can exist (validation, unknown/expired offer). Every other
 * error (2013, 2014 "booking incomplete", 5000 "unable to process", 4005 duplicate client reference,
 * unknown codes) leaves the outcome open and is resolved by clientReference lookup, never by re-booking.
 */
const BOOK_DEFINITIVE_CODES = new Set([4000, 4002, 4003, 4010, 4012]);
// 2001 (HTTP 409, "no availability" / "provider price exceeds locked selling price") is not in the pinned spec
// but was observed in sandbox on 2026-10-09: the rate cannot be prebooked, search again.
const PREBOOK_DEFINITIVE_CODES = new Set([2001, 4002, 4016, 4040]);

const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'CANCELLED_WITH_CHARGES']);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
/** Only https image URLs reach our pages (provider content is untrusted). */
const safeUrl = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  try {
    return new URL(s).protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
};

export class NuiteeHotelConnector implements HotelConnector {
  constructor(
    private readonly cfg: NuiteeHotelConfig,
    private readonly transport: HttpTransport = fetchTransport,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  descriptor(): ConnectorDescriptor {
    return {
      connectorId: 'nuitee-hotel',
      providerId: 'nuitee',
      productType: 'HOTEL',
      environment: this.cfg.environment,
      isMock: false,
      requiredSources: NUITEE_HOTEL_REQUIRED_SOURCES,
      operations: {
        searchRates: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        placeDetails: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        hotelContent: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        prebook: { effect: 'CREATES_PROVIDER_SESSION', lostResponse: 'NONE' },
        // clientReference "acts as an idempotency key"; a repeat returns 4005 (booking OpenAPI).
        book: { effect: 'CREATES_PROVIDER_RESERVATION', lostResponse: 'CLIENT_REFERENCE_LOOKUP' },
        lookupByClientReference: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        getBooking: { effect: 'READ_ONLY', lostResponse: 'NONE' },
        cancel: { effect: 'CANCELS_PROVIDER_RESERVATION', lostResponse: 'CLIENT_REFERENCE_LOOKUP' },
      },
      // Prebook validates price/availability; the docs do not claim an inventory hold.
      holdSemantics: 'PREBOOK_VALIDATION',
      reversibilityRank: 10,
      maxAsyncConfirmationSeconds: 0,
      requiresIssuance: false,
    };
  }

  // ------------------------------------------------------------------ HTTP

  private async send(operation: string, method: 'GET' | 'POST' | 'PUT', url: string, body: Json | null, timeoutSeconds: number, passThrough4xx = false): Promise<ParsedHttp> {
    const at = this.clock().toISOString();
    const result = await this.transport.send({
      method,
      url,
      headers: { 'x-api-key': this.cfg.apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      // Our wait is longer than the provider-side timeout so the provider answers first.
      timeoutMs: (timeoutSeconds + 15) * 1000,
    });
    return classifyHttp(result, `nuitee.hotel.${operation}`, this.cfg.environment, at, undefined, { passThrough4xx });
  }

  private errorOf(json: unknown): { code: number | null; message: string } | null {
    const e = (json as Json | null)?.error as Json | undefined;
    if (!e || typeof e !== 'object') return null;
    return { code: typeof e.code === 'number' ? e.code : null, message: String(e.description ?? e.message ?? 'error') };
  }

  private amount(parsed: Parsed, obj: unknown, key = 'amount'): string | null {
    if (!obj || typeof obj !== 'object') return null;
    return exactDecimal(parsed, obj as object, key);
  }

  /** Price objects are typed as arrays in the schema but returned as objects in the examples: accept both. */
  private priceObject(parsed: Parsed, value: unknown): Money | null {
    const obj = Array.isArray(value) ? value[0] : value;
    if (!obj || typeof obj !== 'object') return null;
    const cur = (obj as Json).currency;
    const amt = this.amount(parsed, obj);
    if (typeof cur !== 'string' || amt === null) return null;
    try {
      return fromMajor(amt, cur);
    } catch {
      return null;
    }
  }

  private envMatches(json: Json): boolean {
    // Booking responses carry `sandbox` (0/1). A record from the other environment never updates ours (T15).
    const flag = json.sandbox;
    if (flag === undefined || flag === null) return true;
    return (String(flag) === '1') === (this.cfg.environment === 'sandbox');
  }

  // ------------------------------------------------------------------ mapping helpers

  /** "2026-07-30 02:00:00" or "2024-11-15", always GMT per the contract -> ISO instant. */
  private gmtInstant(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(value.trim());
    if (!m) return null;
    const iso = `${m[1]}T${m[2] ?? '00:00:00'}${m[2] && m[2].length === 5 ? ':00' : ''}Z`;
    return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
  }

  /**
   * Offer-level cancellation from per-room policies: the penalty at time t is the sum of each room's
   * applicable penalty. Non-refundable if any room is NRFN.
   */
  private cancellation(parsed: Parsed, rates: Json[], currency: string): CancellationPolicySnapshot | null {
    const perRoom: Array<Array<{ at: number; penalty: Money }>> = [];
    let refundable = true;
    for (const rate of rates) {
      const cp = rate.cancellationPolicies as Json | undefined;
      if (!cp) return null;
      if (cp.refundableTag !== 'RFN') refundable = false;
      const steps: Array<{ at: number; penalty: Money }> = [];
      for (const info of (cp.cancelPolicyInfos as Json[] | undefined) ?? []) {
        const at = this.gmtInstant(info.cancelTime);
        const amt = this.amount(parsed, info);
        if (!at || amt === null || info.currency !== currency) return null;
        steps.push({ at: Date.parse(at), penalty: fromMajor(amt, currency) });
      }
      perRoom.push(steps.sort((a, b) => a.at - b.at));
    }
    const times = [...new Set(perRoom.flat().map((s) => s.at))].sort((a, b) => a - b);
    const steps = times.map((t) => ({
      from: new Date(t).toISOString(),
      penalty: perRoom.reduce((acc, room) => {
        const applicable = room.filter((s) => s.at <= t).at(-1);
        return applicable ? add(acc, applicable.penalty) : acc;
      }, money(currency, 0n)),
    }));
    return { timezone: 'UTC', refundable, steps, providerText: null };
  }

  private offerFromRoomType(parsed: Parsed, roomType: Json): Omit<HotelOffer, 'hotelId'> | null {
    const price = this.priceObject(parsed, roomType.offerRetailRate);
    if (!price || typeof roomType.offerId !== 'string') return null;
    const rates = (roomType.rates as Json[] | undefined) ?? [];
    if (rates.length === 0) return null;
    let margin = money(price.currency, 0n);
    const payAtProperty: Money[] = [];
    for (const rate of rates) {
      for (const c of (rate.commission as Json[] | undefined) ?? []) {
        const amt = this.amount(parsed, c);
        if (amt === null || c.currency !== price.currency) return null;
        margin = add(margin, fromMajor(amt, price.currency));
      }
      const retail = rate.retailRate as Json | undefined;
      for (const tax of (retail?.taxesAndFees as Json[] | undefined) ?? []) {
        // included:false = "must be paid separately at check-in" -> never part of the amount charged now.
        if (tax.included === false) {
          const amt = this.amount(parsed, tax);
          if (amt === null || typeof tax.currency !== 'string') return null;
          payAtProperty.push(fromMajor(amt, tax.currency));
        }
      }
    }
    const cancellation = this.cancellation(parsed, rates, price.currency);
    if (!cancellation) return null;
    return {
      offerRef: opaque(roomType.offerId),
      productType: 'HOTEL',
      price,
      providerAppliedMargin: margin,
      suggestedSellingPrice: this.priceObject(parsed, roomType.suggestedSellingPrice),
      payAtProperty,
      cancellation,
      expiresAt: null,
      occupancyNumbers: rates.map((r) => Number(r.occupancyNumber)).filter(Number.isInteger),
      room: {
        name: str(roomType.name) ?? str(rates[0]?.name),
        boardType: str(rates[0]?.boardType),
        boardName: str(rates[0]?.boardName),
      },
      // Offer-level list when present, otherwise the union of the rates' payment types (examples carry them per rate).
      paymentTypes: [...new Set((Array.isArray(roomType.paymentTypes) ? [roomType.paymentTypes] : rates.map((r) => r.paymentTypes)).flatMap((l) => (Array.isArray(l) ? (l as unknown[]) : [])).filter((x): x is string => typeof x === 'string'))],
    };
  }

  private hotelSummary(h: Json): HotelSummary | null {
    const id = str(h.id);
    const name = str(h.name);
    if (!id || !name) return null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      hotelId: id,
      name,
      mainPhoto: safeUrl(h.main_photo),
      thumbnail: safeUrl(h.thumbnail),
      address: str(h.address),
      city: str(h.city_name),
      countryCode: str(h.country_code),
      rating: num(h.rating),
      stars: num(h.stars) ?? num(h.starRating),
    };
  }

  private bookingState(parsed: Parsed, data: Json, clientReference: string): ProviderBookingState | null {
    const status = typeof data.status === 'string' ? data.status.toUpperCase() : '';
    const mapped: ProviderBookingState['status'] | null = status === 'CONFIRMED' ? 'CONFIRMED' : CANCELLED_STATUSES.has(status) ? 'CANCELLED' : null;
    if (!mapped || typeof data.bookingId !== 'string') return null;
    const amt = exactDecimal(parsed, data, 'price');
    const cost = amt !== null && typeof data.currency === 'string' ? fromMajor(amt, data.currency) : null;
    // "The total commission amount associated with all rooms on the booking" (booking OpenAPI), same currency as price.
    const commissionText = exactDecimal(parsed, data, 'commission');
    const commission = commissionText !== null && typeof data.currency === 'string' ? fromMajor(commissionText, data.currency) : null;
    return {
      status: mapped,
      providerBookingRef: opaque(data.bookingId),
      clientReference: typeof data.clientReference === 'string' ? data.clientReference : clientReference,
      pnr: null,
      ticketNumbers: [],
      ticketingStatus: 'NOT_APPLICABLE',
      // The booking confirmation is the guest document; the hotel's own code may arrive later.
      voucherReady: mapped === 'CONFIRMED',
      holdExpiresAt: null,
      supplierCost: cost,
      providerCommission: commission,
    };
  }

  private unknown(evidence: CallEvidence, reason: 'AMBIGUOUS' | 'MALFORMED_RESPONSE' = 'AMBIGUOUS'): ExternalOutcome<never> {
    return { kind: 'UNKNOWN', reason, evidence };
  }

  // ------------------------------------------------------------------ operations

  async searchRates(criteria: HotelSearchCriteria): Promise<ExternalOutcome<readonly HotelOffer[]>> {
    const out = await this.searchHotelRates(criteria);
    return out.kind === 'SUCCEEDED' ? { kind: 'SUCCEEDED', value: out.value.offers, evidence: out.evidence } : out;
  }

  async searchHotelRates(criteria: HotelSearchCriteria): Promise<ExternalOutcome<{ offers: readonly HotelOffer[]; hotels: readonly HotelSummary[] }>> {
    const targets = [criteria.hotelIds !== undefined, criteria.placeId !== undefined, criteria.city !== undefined].filter(Boolean).length;
    if (targets !== 1) return notAvailable('SEARCH_TARGET', 'Search by exactly one of hotel ids, place id or country/city');
    if (criteria.boardType !== undefined && !HOTEL_BOARD_TYPES.includes(criteria.boardType)) return notAvailable('BOARD_TYPE', 'Unknown board type');
    if (criteria.hotelIds && (criteria.hotelIds.length === 0 || criteria.hotelIds.length > 200)) {
      return notAvailable('HOTEL_IDS', 'Send between 1 and ~200 hotel ids per request (hotel-integration guide)');
    }
    const body: Json = {
      ...(criteria.hotelIds ? { hotelIds: [...criteria.hotelIds], includeHotelData: true } : {}),
      ...(criteria.placeId ? { placeId: criteria.placeId } : {}),
      ...(criteria.city ? { countryCode: criteria.city.countryCode, cityName: criteria.city.cityName } : {}),
      occupancies: [...criteria.occupancies].sort((a, b) => a.occupancyNumber - b.occupancyNumber).map((o) => ({ adults: o.adults, children: [...o.childAges] })),
      currency: criteria.currency,
      guestNationality: criteria.guestNationality,
      checkin: criteria.checkin,
      checkout: criteria.checkout,
      timeout: this.cfg.searchTimeoutSeconds,
      // Always explicit so the account default margin never applies: the approved pricing policy decides the
      // percentage (ADR-0006); null = net rate for LOCAL pricing (margin 0, revenue guide).
      margin: criteria.margin ? new D(criteria.margin.basisPoints).div(100).toNumber() : 0,
      ...(criteria.maxRatesPerHotel ? { maxRatesPerHotel: criteria.maxRatesPerHotel } : {}),
      ...(criteria.limit ? { limit: criteria.limit } : {}),
      ...(criteria.boardType ? { boardType: criteria.boardType } : {}),
      ...(criteria.order === 'PRICE' ? { sort: [{ field: 'price', direction: 'ascending' }] } : {}),
    };
    const http = await this.send('searchRates', 'POST', `${this.cfg.searchBaseUrl}/hotels/rates`, body, this.cfg.searchTimeoutSeconds);
    if (!http.ok) return http.outcome;
    const empty = { kind: 'SUCCEEDED' as const, value: { offers: [], hotels: [] }, evidence: http.evidence };
    if (http.status === 204) return empty;
    const err = this.errorOf(http.json);
    if (err) return err.code === 2001 ? empty : { kind: 'REJECTED', code: `NUITEE_${err.code}`, message: err.message, evidence: http.evidence };
    const data = (http.json as Json | null)?.data;
    if (!Array.isArray(data)) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const offers: HotelOffer[] = [];
    for (const hotel of data as Json[]) {
      if (typeof hotel.hotelId !== 'string') continue;
      for (const rt of (hotel.roomTypes as Json[] | undefined) ?? []) {
        const offer = this.offerFromRoomType(http.parsed, rt);
        // An offer we cannot price exactly is dropped, never shown with a guessed price.
        if (offer) offers.push({ ...offer, hotelId: hotel.hotelId });
      }
    }
    const rawHotels = (http.json as Json | null)?.hotels;
    const hotels = (Array.isArray(rawHotels) ? (rawHotels as Json[]) : []).map((h) => this.hotelSummary(h)).filter((h): h is HotelSummary => h !== null);
    return { kind: 'SUCCEEDED', value: { offers, hotels }, evidence: http.evidence };
  }

  async searchPlaces(input: { text: string; language: string }): Promise<ExternalOutcome<readonly PlaceSuggestion[]>> {
    const text = input.text.trim();
    if (text.length < 2 || text.length > 100) return notAvailable('PLACE_QUERY', 'Type 2-100 characters');
    const url = `${this.cfg.searchBaseUrl}/data/places?textQuery=${encodeURIComponent(text)}&language=${encodeURIComponent(input.language)}`;
    const http = await this.send('searchPlaces', 'GET', url, null, 10);
    if (!http.ok) return http.outcome;
    const data = (http.json as Json | null)?.data;
    if (http.status === 204 || data === undefined || data === null) return { kind: 'SUCCEEDED', value: [], evidence: http.evidence };
    if (!Array.isArray(data)) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const places: PlaceSuggestion[] = [];
    for (const p of data as Json[]) {
      const placeId = str(p.placeId);
      const name = str(p.displayName);
      if (!placeId || !name) continue;
      places.push({ placeId, name, address: str(p.formattedAddress) ?? '', types: Array.isArray(p.types) ? (p.types as unknown[]).filter((t): t is string => typeof t === 'string') : [] });
    }
    return { kind: 'SUCCEEDED', value: places, evidence: http.evidence };
  }

  /** GET /data/places/{placeId}: the place's name and address, so an editor sees which "Rome" a list uses. */
  async placeDetails(input: { placeId: string; language: string }): Promise<ExternalOutcome<PlaceSuggestion | null>> {
    if (!/^[\w-]{3,200}$/.test(input.placeId)) return notAvailable('PLACE_ID', 'Place ids are letters, digits, _ and -');
    const url = `${this.cfg.searchBaseUrl}/data/places/${encodeURIComponent(input.placeId)}?language=${encodeURIComponent(input.language)}`;
    const http = await this.send('placeDetails', 'GET', url, null, 10, true);
    if (!http.ok) return http.outcome;
    if (http.status === 404 || http.status === 400) return { kind: 'SUCCEEDED', value: null, evidence: http.evidence };
    if (http.status >= 400) return { kind: 'REJECTED', code: `HTTP_${http.status}`, message: this.errorOf(http.json)?.message ?? 'refused', evidence: http.evidence };
    const d = (http.json as Json | null)?.data as Json | undefined;
    const name = str(d?.displayName);
    if (!d || !name) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const comps = Array.isArray(d.addressComponents) ? (d.addressComponents as Json[]) : [];
    // Broadest last: "Floyd, Georgia, Amerika Birleşik Devletleri" tells Rome GA from Rome IT.
    const address = comps
      .filter((c) => Array.isArray(c.types) && !(c.types as unknown[]).includes('locality') && !(c.types as unknown[]).includes('postal_code'))
      .map((c) => str(c.longText))
      .filter((x): x is string => x !== null && x !== name);
    const types = Array.isArray(d.types) ? (d.types as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    return { kind: 'SUCCEEDED', value: { placeId: input.placeId, name, address: [...new Set(address)].join(', '), types }, evidence: http.evidence };
  }

  /**
   * GET /data/hotel: static content for the public hotel page. Provider markup is reduced to plain text and only https
   * images are kept; a hotel the provider does not know answers null. Static-data endpoints have stricter rate
   * limits (hotel-integration guide): callers throttle.
   */
  async hotelContent(input: { hotelId: string; language: string }): Promise<ExternalOutcome<HotelContent | null>> {
    if (!/^[\w-]{2,64}$/.test(input.hotelId)) return notAvailable('HOTEL_ID', 'Hotel ids are letters, digits, _ and -');
    if (!/^[a-z]{2}$/.test(input.language)) return notAvailable('LANGUAGE', 'ISO 639-1 language code');
    const url = `${this.cfg.searchBaseUrl}/data/hotel?hotelId=${encodeURIComponent(input.hotelId)}&language=${input.language}`;
    const http = await this.send('hotelContent', 'GET', url, null, 15, true);
    if (!http.ok) return http.outcome;
    if (http.status === 404) return { kind: 'SUCCEEDED', value: null, evidence: http.evidence };
    if (http.status >= 400) return { kind: 'REJECTED', code: `HTTP_${http.status}`, message: this.errorOf(http.json)?.message ?? 'refused', evidence: http.evidence };
    const d = (http.json as Json | null)?.data as Json | undefined;
    if (!d || typeof d !== 'object') return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    if (str(d.id) !== input.hotelId || !str(d.name)) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const loc = d.location as Json | undefined;
    const lat = num(loc?.latitude);
    const lng = num(loc?.longitude);
    const rawImages = Array.isArray(d.hotelImages) ? (d.hotelImages as Json[]) : [];
    const images = rawImages
      .map((x, i) => ({ url: safeUrl(x.urlHd) ?? safeUrl(x.url), caption: str(x.caption), first: x.defaultImage === true, order: num(x.order) ?? 1000 + i }))
      .filter((x): x is { url: string; caption: string | null; first: boolean; order: number } => x.url !== null)
      .sort((a, b) => Number(b.first) - Number(a.first) || a.order - b.order)
      .slice(0, 20)
      .map(({ url, caption }) => ({ url, caption }));
    const main = safeUrl(d.main_photo);
    if (images.length === 0 && main) images.push({ url: main, caption: null });
    const facilityNames = [
      ...(Array.isArray(d.facilities) ? (d.facilities as Json[]).map((f) => str(f?.name)) : []),
      ...(Array.isArray(d.hotelFacilities) ? (d.hotelFacilities as unknown[]).map(str) : []),
    ].filter((x): x is string => x !== null);
    const times = d.checkinCheckoutTimes as Json | undefined;
    const nearby = (Array.isArray(d.poi) ? (d.poi as Json[]) : [])
      .map((x) => ({ name: str(x.name), category: str(x.category), distanceKm: num(x.distanceKm) }))
      .filter((x): x is { name: string; category: string | null; distanceKm: number | null } => x.name !== null)
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
      .slice(0, 10);
    const rating = num(d.rating);
    const stars = num(d.starRating);
    return {
      kind: 'SUCCEEDED',
      value: {
        hotelId: input.hotelId,
        language: input.language,
        name: str(d.name)!,
        description: plainText(typeof d.hotelDescription === 'string' ? d.hotelDescription : null, 8000),
        stars: stars !== null && stars >= 0 && stars <= 5 ? stars : null,
        rating: rating !== null && rating >= 0 && rating <= 10 ? rating : null,
        reviewCount: num(d.reviewCount) !== null && num(d.reviewCount)! >= 0 ? Math.trunc(num(d.reviewCount)!) : null,
        address: str(d.address),
        city: str(d.city),
        country: str(d.country),
        location: lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : null,
        images,
        facilities: [...new Set(facilityNames)].slice(0, 60),
        checkinTime: str(times?.checkin_start),
        checkoutTime: str(times?.checkout),
        importantInformation: plainText(typeof d.hotelImportantInformation === 'string' ? d.hotelImportantInformation : null, 4000),
        nearby,
        hotelType: str(d.hotelType),
        chain: str(d.chain),
      },
      evidence: http.evidence,
    };
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
    const http = await this.send(
      'prebook',
      'POST',
      `${this.cfg.bookBaseUrl}/rates/prebook?timeout=${this.cfg.bookTimeoutSeconds}`,
      { offerId: input.offerRef, usePaymentSdk: input.usePaymentSdk },
      this.cfg.bookTimeoutSeconds,
      true,
    );
    type Result = {
      prebookRef: OpaqueRef;
      offer: QuotedOffer;
      providerManagedTransaction: ProviderManagedTransactionRef | null;
      paymentClientSecret: string | null;
      changeFlags: { price: boolean; cancellation: boolean; board: boolean };
    };
    if (!http.ok) {
      // A prebook is a session, not a reservation (usePaymentSdk:false holds no money). Without an answer the
      // rate is not validated and must not be booked ("you should not continue as though the selected rate was
      // successfully validated", hotel-integration guide), so the item stops here instead of waiting on UNKNOWN.
      if (http.outcome.kind === 'UNKNOWN') return { kind: 'REJECTED', code: 'NUITEE_PREBOOK_UNCONFIRMED', message: 'Prebook did not answer', evidence: http.outcome.evidence };
      return http.outcome;
    }
    const prebookErr = this.errorOf(http.json);
    if (prebookErr || http.status >= 400) {
      const code = prebookErr?.code ?? http.status;
      return { kind: 'REJECTED', code: `NUITEE_${code}${PREBOOK_DEFINITIVE_CODES.has(code) ? '' : '_UNCLASSIFIED'}`, message: prebookErr?.message ?? 'prebook refused', evidence: http.evidence };
    }
    const data = (http.json as Json | null)?.data as Json | undefined;
    if (!data || typeof data.prebookId !== 'string' || typeof data.currency !== 'string') return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const priceText = exactDecimal(http.parsed, data, 'price');
    if (priceText === null) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    const price = fromMajor(priceText, data.currency);
    const rates = ((data.roomTypes as Json[] | undefined) ?? []).flatMap((rt) => (rt.rates as Json[] | undefined) ?? []);
    const cancellation = this.cancellation(http.parsed, rates, data.currency);
    const commission = exactDecimal(http.parsed, data, 'commission');
    if (!cancellation) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    let pmt: ProviderManagedTransactionRef | null = null;
    let paymentClientSecret: string | null = null;
    if (input.usePaymentSdk) {
      // The payment SDK needs the secretKey of this prebook; without it the customer cannot pay (user-payment guide).
      if (typeof data.transactionId !== 'string' || typeof data.secretKey !== 'string' || data.secretKey.length === 0) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
      paymentClientSecret = data.secretKey;
      pmt = {
        __brand: 'ProviderManagedTransactionRef',
        providerId: 'nuitee',
        productType: 'HOTEL',
        prebookRef: opaque(data.prebookId),
        transactionId: opaque(data.transactionId),
        environment: this.cfg.environment,
      };
    }
    const value: Result = {
      prebookRef: opaque(data.prebookId),
      offer: {
        offerRef: input.offerRef,
        productType: 'HOTEL',
        price,
        providerAppliedMargin: commission !== null ? fromMajor(commission, data.currency) : money(data.currency, 0n),
        suggestedSellingPrice: this.priceObject(http.parsed, data.suggestedSellingPrice),
        payAtProperty: [],
        cancellation,
        expiresAt: null,
      },
      providerManagedTransaction: pmt,
      paymentClientSecret,
      changeFlags: {
        // "This should be 0": any difference needs a new acceptance (booking OpenAPI).
        price: Number(data.priceDifferencePercent ?? 0) !== 0,
        cancellation: data.cancellationChanged === true,
        board: data.boardChanged === true,
      },
    };
    return { kind: 'SUCCEEDED', value, evidence: http.evidence };
  }

  async book(input: {
    prebookRef: OpaqueRef;
    clientReference: string;
    holder: { firstName: string; lastName: string; email: string; phone: string };
    guests: readonly HotelRoomGuest[];
    funding: HotelFunding;
  }): Promise<ExternalOutcome<ProviderBookingState>> {
    const funding = this.paymentFor(input.funding, input.prebookRef);
    if (!funding.ok) return notAvailable('FUNDING', funding.refused);
    const payment = funding.payment;
    if (!/^[\w.:-]{6,64}$/.test(input.clientReference)) return notAvailable('CLIENT_REFERENCE', 'clientReference must be a unique 6-64 character id');
    const body: Json = {
      prebookId: input.prebookRef,
      clientReference: input.clientReference,
      holder: { ...input.holder },
      guests: [...input.guests]
        .sort((a, b) => a.occupancyNumber - b.occupancyNumber)
        .map((g) => ({ occupancyNumber: g.occupancyNumber, firstName: g.leadGuest.firstName, lastName: g.leadGuest.lastName, email: g.leadGuest.email })),
      payment,
    };
    const http = await this.send('book', 'POST', `${this.cfg.bookBaseUrl}/rates/book?timeout=${this.cfg.bookTimeoutSeconds}`, body, this.cfg.bookTimeoutSeconds, true);
    return this.mapBookResponse(http, input.clientReference);
  }

  private paymentFor(funding: HotelFunding, prebookRef: OpaqueRef): { ok: true; payment: Json } | { ok: false; refused: string } {
    switch (funding.kind) {
      case 'ACCOUNT_CARD':
        return { ok: true, payment: { method: 'ACC_CREDIT_CARD' } };
      case 'CREDIT_LINE':
        // "This method does not work in sandbox mode, and all bookings made via CREDIT are real bookings."
        if (this.cfg.environment !== 'production') return { ok: false, refused: 'CREDIT is never used outside production (it books for real)' };
        return { ok: true, payment: { method: 'CREDIT' } };
      case 'PROVIDER_MANAGED': {
        const t = funding.transaction;
        if (t.providerId !== 'nuitee' || t.productType !== 'HOTEL' || t.prebookRef !== prebookRef || t.environment !== this.cfg.environment) {
          return { ok: false, refused: 'Transaction does not belong to this Nuitee hotel prebook/environment' };
        }
        return { ok: true, payment: { method: 'TRANSACTION_ID', transactionId: t.transactionId } };
      }
    }
  }

  /** Classifies a book response. Ambiguous provider errors are UNKNOWN (lookup), never FAILED. */
  private mapBookResponse(http: ParsedHttp, clientReference: string): ExternalOutcome<ProviderBookingState> {
    if (!http.ok) return http.outcome; // timeout / 5xx / unreadable body: UNKNOWN (never re-book on a timeout)
    const evidence = http.evidence;
    const err = this.errorOf(http.json);
    if (err || http.status >= 400) {
      const code = err?.code ?? null;
      if (code !== null && BOOK_DEFINITIVE_CODES.has(code)) return { kind: 'REJECTED', code: `NUITEE_${code}`, message: err?.message ?? 'refused', evidence };
      // TRANSACTION_ID bookings: the customer has not paid in the payment SDK yet (documented 2014 example). Sandbox
      // 2026-10-09: this answer uses up the clientReference (a repeat is 4005 and the lookup finds nothing), so the
      // caller retries with a NEW reference; a transaction that already booked answers the same, never books twice.
      if (code === 2014 && err?.message === 'payment not completed') {
        return { kind: 'REJECTED', code: 'NUITEE_PAYMENT_NOT_COMPLETED', message: 'payment not completed', evidence };
      }
      return this.unknown(evidence);
    }
    const data = (http.json as Json | null)?.data as Json | undefined;
    if (!data || !this.envMatches(data)) return this.unknown(evidence, 'MALFORMED_RESPONSE');
    const state = this.bookingState(http.parsed, data, clientReference);
    if (!state) return this.unknown(evidence, 'MALFORMED_RESPONSE');
    if (state.clientReference !== clientReference) return this.unknown(evidence);
    return { kind: 'SUCCEEDED', value: state, evidence };
  }

  async lookupByClientReference(clientReference: string): Promise<ExternalOutcome<ProviderBookingState | null>> {
    const http = await this.send('lookupByClientReference', 'GET', `${this.cfg.bookBaseUrl}/bookings?clientReference=${encodeURIComponent(clientReference)}&timeout=10`, null, 10);
    if (!http.ok) return http.outcome;
    const data = (http.json as Json | null)?.data;
    if (http.status === 204 || data === null || data === undefined) return { kind: 'SUCCEEDED', value: null, evidence: http.evidence };
    if (!Array.isArray(data)) return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    // Exact match only: the filter semantics are not documented, so we never trust a partial match.
    const matches = (data as Json[]).filter((b) => b.clientReference === clientReference && this.envMatches(b));
    if (matches.length === 0) return { kind: 'SUCCEEDED', value: null, evidence: http.evidence };
    if (matches.length > 1) return this.unknown(http.evidence);
    const state = this.bookingState(http.parsed, matches[0] as Json, clientReference);
    return state ? { kind: 'SUCCEEDED', value: state, evidence: http.evidence } : this.unknown(http.evidence, 'MALFORMED_RESPONSE');
  }

  async getBooking(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState>> {
    const http = await this.send('getBooking', 'GET', `${this.cfg.bookBaseUrl}/bookings/${encodeURIComponent(providerBookingRef)}?timeout=10`, null, 10);
    if (!http.ok) return http.outcome;
    const data = (http.json as Json | null)?.data as Json | undefined;
    if (http.status === 204 || !data || !this.envMatches(data)) return this.unknown(http.evidence);
    const state = this.bookingState(http.parsed, data, typeof data.clientReference === 'string' ? data.clientReference : '');
    return state ? { kind: 'SUCCEEDED', value: state, evidence: http.evidence } : this.unknown(http.evidence, 'MALFORMED_RESPONSE');
  }

  async cancel(providerBookingRef: OpaqueRef): Promise<ExternalOutcome<ProviderBookingState & { penalty: Money | null; refundAmount: Money | null }>> {
    const http = await this.send('cancel', 'PUT', `${this.cfg.bookBaseUrl}/bookings/${encodeURIComponent(providerBookingRef)}?timeout=${this.cfg.bookTimeoutSeconds}`, null, this.cfg.bookTimeoutSeconds, true);
    if (!http.ok) return http.outcome;
    const err = this.errorOf(http.json);
    if (http.status === 204) return { kind: 'REJECTED', code: 'NUITEE_BOOKING_NOT_FOUND', message: 'booking id not found', evidence: http.evidence };
    // 304 "unable to process request" and unknown errors: the cancel may or may not have happened.
    if (err || http.status === 304 || http.status >= 400) return this.unknown(http.evidence);
    const data = (http.json as Json | null)?.data as Json | undefined;
    if (!data || typeof data.currency !== 'string' || typeof data.status !== 'string') return this.unknown(http.evidence, 'MALFORMED_RESPONSE');
    if (!CANCELLED_STATUSES.has(data.status.toUpperCase())) return this.unknown(http.evidence);
    const fee = exactDecimal(http.parsed, data, 'cancellation_fee');
    const refund = exactDecimal(http.parsed, data, 'refund_amount');
    return {
      kind: 'SUCCEEDED',
      value: {
        status: 'CANCELLED',
        providerBookingRef,
        clientReference: '',
        pnr: null,
        ticketNumbers: [],
        ticketingStatus: 'NOT_APPLICABLE',
        voucherReady: false,
        holdExpiresAt: null,
        supplierCost: null,
        providerCommission: null,
        penalty: fee !== null ? fromMajor(fee, data.currency) : null,
        refundAmount: refund !== null ? fromMajor(refund, data.currency) : null,
      },
      evidence: http.evidence,
    };
  }
}
