import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CapabilityNotAvailableError, HOTEL_BOARD_TYPES, type HotelConnector, type HotelContent, type HotelSummary, type ProviderEnvironment } from '@texholiday/contracts';
import type { HotelContentRow, HotelListRepository, HotelListRow } from '@texholiday/db';
import { fromJson, money, toJson, type MoneyJson } from '@texholiday/pricing';
import type { HotelPricing, ResolvedHotelPricing } from './hotel-pricing';
import type { HotelListTechSettings } from './settings';

/**
 * Hotel list pages (ADR-0014): the list configuration published in the CMS, the scanner that keeps the 30-day lowest
 * prices, and the read model of the list and hotel pages.
 *
 * Price rules:
 * - A list price is computed by the same connector call and pricing function as the hotel search, for 1 room, 2 adults,
 *   1 night, on each of the next 30 check-in dates (Europe/Istanbul), in the language's currency and nationality.
 * - A day's prices are replaced only by a complete answer; a lost answer keeps the previous ones and retries later.
 * - A price is shown only while its pricing fingerprint is the current one and it is younger than the settings allow.
 * - A list price is for display only: booking always prices live and needs the customer's acceptance (K15).
 */

export const SCAN_DAYS = 30;
export const REFERENCE_ADULTS = 2;
/** Hotels stay on a list this long after a scan last found them (availability changes; pages must not flap). */
export const MEMBER_GRACE_DAYS = 14;
export const HOTEL_LIST_LOCALES = ['tr', 'en'] as const;
export type HotelListLocale = (typeof HOTEL_LIST_LOCALES)[number];

const hotelId = z.string().regex(/^[\w-]{2,64}$/);

/** The list as the CMS publishes it (validated again here: the mirror is input to provider calls). */
export const hotelListConfigSchema = z
  .object({
    places: z.array(z.object({ placeId: z.string().regex(/^[\w-]{3,200}$/), name: z.string().max(200), address: z.string().max(300) })).max(10),
    include: z.array(hotelId).max(200),
    exclude: z.array(hotelId).max(500),
    pinned: z.array(hotelId).max(50),
    stars: z.array(z.number().int().min(1).max(5)).max(5),
    boardType: z.enum(HOTEL_BOARD_TYPES).nullable(),
    sort: z.enum(['TOP_PICKS', 'PRICE', 'MANUAL']),
    maxItems: z.number().int().min(3).max(60),
  })
  .refine((c) => c.places.length > 0 || c.include.length > 0 || c.pinned.length > 0, { message: 'A list needs a place or hotel codes' });
export type HotelListConfig = z.infer<typeof hotelListConfigSchema>;

const localeSettings = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), nationality: z.string().regex(/^[A-Z]{2}$/) });
/** Price display settings (CMS global). A language without settings shows no prices; nothing is defaulted. */
export const hotelListSettingsSchema = z.object({
  locales: z.object({ tr: localeSettings.nullable(), en: localeSettings.nullable() }),
  maxPriceAgeHours: z.number().int().min(1).max(168),
});
export type HotelListSettings = z.infer<typeof hotelListSettingsSchema>;

/** What one scan covers; lists with the same scope share its provider calls. */
export interface HotelListScope {
  environment: ProviderEnvironment;
  currency: string;
  nationality: string;
  boardType: HotelListConfig['boardType'];
  order: 'TOP_PICKS' | 'PRICE';
  places: string[];
  hotelIds: string[];
}

export function scopeFor(config: HotelListConfig, locale: { currency: string; nationality: string }, environment: ProviderEnvironment): { scopeKey: string; scope: HotelListScope } {
  const scope: HotelListScope = {
    environment,
    currency: locale.currency,
    nationality: locale.nationality,
    boardType: config.boardType,
    order: config.sort === 'PRICE' ? 'PRICE' : 'TOP_PICKS',
    places: [...new Set(config.places.map((p) => p.placeId))].sort(),
    hotelIds: [...new Set([...config.include, ...config.pinned])].sort(),
  };
  return { scopeKey: createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0, 32), scope };
}

// ------------------------------------------------------------------ dates and addresses

/** YYYY-MM-DD of `now` in Europe/Istanbul (the site's market). */
export function istanbulDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The scanned check-in dates: tomorrow (Istanbul) and the 29 days after it. */
export function scanDates(now: Date): string[] {
  const today = istanbulDate(now);
  return Array.from({ length: SCAN_DAYS }, (_, i) => addDays(today, i + 1));
}

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Lowercase ASCII words joined by dashes ("Akra Antalya" -> "akra-antalya"). */
export function slugify(text: string, max = 80): string {
  const lower = text.toLocaleLowerCase('tr').replace(/[çğıöşüâîû]|i̇/g, (c) => TR_MAP[c] ?? c);
  return lower
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Hotel page address: name words and the provider hotel code ("akra-antalya-lp1897"). */
export function hotelSlug(name: string, id: string): string {
  const base = slugify(name, 70);
  const code = slugify(id, 40);
  return base ? `${base}-${code}` : code;
}

// ------------------------------------------------------------------ scanner

export interface ScannerDeps {
  repo: HotelListRepository;
  hotels: HotelConnector;
  pricing: HotelPricing;
  tech: HotelListTechSettings;
  workerId: string;
  clock?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void };
}

export type ScannerStep = 'SCANNED_DAY' | 'DAY_FAILED' | 'FETCHED_CONTENT' | 'IDLE';

const RATE_SLOT = 'nuitee-hotel-lists';
/** Covers one provider call (6 s budget + 15 s HTTP margin) plus the wait for the shared pace; renewed per call. */
const LEASE_SECONDS = 120;

function hotelSummaryJson(h: HotelSummary | undefined, id: string): Record<string, unknown> {
  return h ? { ...h } : { hotelId: id, name: id };
}

/**
 * Keeps the lowest prices of every published list scope for the next 30 days, one check-in date at a time, at a pace
 * shared by all worker processes; then fetches the static content of the hotels found.
 */
export class HotelListScanner {
  private lastSync = 0;
  private readonly contentRetry = new Map<string, number>();
  private readonly clock: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ScannerDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Active scopes from the published lists and settings; their 30 dates; days priced with another fingerprint become due. */
  async syncScopes(): Promise<{ scopes: number }> {
    const now = this.clock();
    const settings = hotelListSettingsSchema.safeParse(await this.deps.repo.settings());
    const environment = this.deps.pricing.settings.environment;
    const scopes = new Map<string, { scopeKey: string; scope: HotelListScope; environment: ProviderEnvironment; currency: string }>();
    if (settings.success) {
      for (const list of await this.deps.repo.publishedLists()) {
        const config = hotelListConfigSchema.safeParse(list.config);
        if (!config.success) {
          this.deps.log?.warn('hotel list config invalid; skipped', { cmsId: list.cmsId });
          continue;
        }
        for (const l of HOTEL_LIST_LOCALES) {
          const ls = settings.data.locales[l];
          if (!ls || !list.slugs[l]) continue;
          const s = scopeFor(config.data, ls, environment);
          scopes.set(s.scopeKey, { ...s, environment, currency: ls.currency });
        }
      }
    }
    await this.deps.repo.syncScopes([...scopes.values()], scanDates(now), now);
    for (const currency of new Set([...scopes.values()].map((s) => s.currency))) {
      try {
        const r = await this.deps.pricing.resolve(currency);
        await this.deps.repo.markStale(environment, currency, r.fingerprint, now);
      } catch (err) {
        if (!(err instanceof CapabilityNotAvailableError)) throw err;
      }
    }
    this.lastSync = now.getTime();
    return { scopes: scopes.size };
  }

  /** One unit of work: a due day, else one hotel's content. */
  async tick(): Promise<ScannerStep> {
    if (this.clock().getTime() - this.lastSync >= 60_000) await this.syncScopes();
    const claim = await this.deps.repo.claimDay(this.deps.workerId, this.clock(), LEASE_SECONDS);
    if (claim) return this.scanDay(claim);
    return (await this.fetchOneContent()) ? 'FETCHED_CONTENT' : 'IDLE';
  }

  /** Runs ticks until nothing is due (tests and the MOCK environment's dev route). */
  async runUntilIdle(maxSteps = 1000): Promise<number> {
    let steps = 0;
    while (steps < maxSteps && (await this.tick()) !== 'IDLE') steps += 1;
    return steps;
  }

  private async turn(): Promise<void> {
    const interval = 1000 / this.deps.tech.callsPerSecond;
    const slot = await this.deps.repo.takeRateSlot(RATE_SLOT, interval, this.clock());
    const wait = slot.getTime() - this.clock().getTime();
    if (wait > 0) await this.sleep(wait);
  }

  private backoff(attempts: number): Date {
    const capMs = this.deps.tech.refreshHours * 3_600_000;
    return new Date(this.clock().getTime() + Math.min(capMs, 5 * 60_000 * 2 ** Math.max(0, attempts - 1)));
  }

  private async scanDay(claim: NonNullable<Awaited<ReturnType<HotelListRepository['claimDay']>>>): Promise<ScannerStep> {
    const scope = claim.scope as HotelListScope;
    const fail = async (error: string) => {
      await this.deps.repo.failDay({ scopeKey: claim.scopeKey, checkin: claim.checkin, workerId: this.deps.workerId, error, nextDueAt: this.backoff(claim.attempts) });
      this.deps.log?.warn('hotel list day not priced; previous prices kept', { scopeKey: claim.scopeKey, checkin: claim.checkin, error });
      return 'DAY_FAILED' as const;
    };
    let r: ResolvedHotelPricing;
    try {
      r = await this.deps.pricing.resolve(claim.currency);
    } catch (err) {
      if (err instanceof CapabilityNotAvailableError) return fail(`SALES_CLOSED: ${err.message}`);
      throw err;
    }
    const targets: Array<{ placeId: string } | { hotelIds: string[] }> = [
      ...scope.places.map((placeId) => ({ placeId })),
      ...Array.from({ length: Math.ceil(scope.hotelIds.length / 200) }, (_, i) => ({ hotelIds: scope.hotelIds.slice(i * 200, i * 200 + 200) })),
    ];
    const best = new Map<string, { sellMinor: bigint; payAtPropertyMinor: bigint | null; payAtPropertyOtherCurrency: boolean; boardType: string | null }>();
    const members = new Map<string, { summary: Record<string, unknown>; rank: number }>();
    for (const [ti, target] of targets.entries()) {
      await this.turn();
      // A day may take several slow calls: the lease is renewed before each so no other worker takes the day meanwhile.
      if (!(await this.deps.repo.renewDay(claim.scopeKey, claim.checkin, this.deps.workerId, new Date(this.clock().getTime() + LEASE_SECONDS * 1000)))) {
        this.deps.log?.warn('hotel list day lease lost; scan stopped', { scopeKey: claim.scopeKey, checkin: claim.checkin });
        return 'DAY_FAILED';
      }
      const out = await this.deps.hotels.searchHotelRates({
        ...target,
        checkin: claim.checkin,
        checkout: addDays(claim.checkin, 1),
        occupancies: [{ occupancyNumber: 1, adults: REFERENCE_ADULTS, childAges: [] }],
        guestNationality: scope.nationality,
        currency: scope.currency,
        margin: r.margin,
        maxRatesPerHotel: this.deps.pricing.settings.maxRatesPerHotel,
        limit: 'hotelIds' in target ? target.hotelIds.length : this.deps.tech.candidates,
        ...(scope.boardType ? { boardType: scope.boardType } : {}),
        order: scope.order,
      });
      // Only a complete day replaces the stored one: any other answer keeps the previous prices (UNKNOWN != empty).
      if (out.kind !== 'SUCCEEDED') return fail(out.kind === 'UNKNOWN' ? `UNKNOWN:${out.reason}` : out.kind === 'REJECTED' ? `REJECTED:${out.code}` : `NOT_AVAILABLE:${out.capability}`);
      const summaries = new Map(out.value.hotels.map((h) => [h.hotelId, h]));
      const order: string[] = [];
      for (const offer of out.value.offers) {
        if (!order.includes(offer.hotelId)) order.push(offer.hotelId);
        if (offer.price.currency !== scope.currency) continue;
        const priced = this.deps.pricing.price(offer, r, { belowSuggestedPrice: 0, notPriced: 0, notPayableOnline: 0 });
        if (!priced) continue;
        const sell = fromJson(priced.sell);
        if (sell.currency !== scope.currency || sell.minor <= 0n) continue;
        const local = priced.payAtProperty.map(fromJson);
        const same = local.filter((m) => m.currency === scope.currency);
        const entry = {
          sellMinor: sell.minor,
          payAtPropertyMinor: same.length > 0 ? same.reduce((a, m) => a + m.minor, 0n) : null,
          payAtPropertyOtherCurrency: local.some((m) => m.currency !== scope.currency),
          boardType: priced.room.boardType,
        };
        const prev = best.get(offer.hotelId);
        if (!prev || entry.sellMinor < prev.sellMinor) best.set(offer.hotelId, entry);
      }
      for (const h of out.value.hotels) if (!order.includes(h.hotelId)) order.push(h.hotelId);
      order.forEach((id, i) => {
        // Interleaved across places/code chunks: "top picks" of several places alternate instead of the first place
        // filling the list.
        const rank = i * targets.length + ti;
        const prev = members.get(id);
        if (!prev || rank < prev.rank) members.set(id, { summary: hotelSummaryJson(summaries.get(id), id), rank });
      });
    }
    const now = this.clock();
    const done = await this.deps.repo.completeDay(
      {
        scopeKey: claim.scopeKey,
        checkin: claim.checkin,
        workerId: this.deps.workerId,
        fingerprint: r.fingerprint,
        prices: [...best.entries()].map(([id, p]) => ({ hotelId: id, ...p })),
        members: [...members.entries()].map(([id, m]) => ({ hotelId: id, summary: m.summary, rank: m.rank })),
        nextDueAt: new Date(now.getTime() + this.deps.tech.refreshHours * 3_600_000),
      },
      now,
    );
    if (!done) this.deps.log?.warn('hotel list day lease lost; result dropped', { scopeKey: claim.scopeKey, checkin: claim.checkin });
    return 'SCANNED_DAY';
  }

  /** Fetches the content of one hotel that lacks it (or is due), in a language that has price settings or a list address. */
  private async fetchOneContent(): Promise<boolean> {
    const now = this.clock();
    const environment = this.deps.pricing.settings.environment;
    const ids = new Set<string>();
    for (const m of await this.deps.repo.memberIds(new Date(now.getTime() - MEMBER_GRACE_DAYS * 86_400_000))) if (m.environment === environment) ids.add(m.hotelId);
    const lists = await this.deps.repo.publishedLists();
    const languages = new Set<HotelListLocale>();
    for (const list of lists) {
      const c = hotelListConfigSchema.safeParse(list.config);
      if (c.success) for (const id of [...c.data.include, ...c.data.pinned]) ids.add(id);
      for (const l of HOTEL_LIST_LOCALES) if (list.slugs[l]) languages.add(l);
    }
    const candidates = [...ids].filter((id) => (this.contentRetry.get(id) ?? 0) <= now.getTime());
    for (const language of languages) {
      const due = await this.deps.repo.contentDue(environment, candidates, language, now);
      const hotelId = due[0];
      if (!hotelId) continue;
      await this.turn();
      const out = await this.deps.hotels.hotelContent({ hotelId, language });
      const at = this.clock();
      if (out.kind !== 'SUCCEEDED') {
        // Not stored: retried later from this process (static endpoints have stricter limits; no hammering).
        this.contentRetry.set(hotelId, at.getTime() + 30 * 60_000);
        this.deps.log?.warn('hotel content not fetched', { hotelId, language, outcome: out.kind });
        return true;
      }
      const days = (n: number) => new Date(at.getTime() + n * 86_400_000).toISOString();
      const row: HotelContentRow = out.value
        ? { environment, hotelId, language, slug: hotelSlug(out.value.name, hotelId), status: 'OK', content: out.value, fetchedAt: at.toISOString(), nextFetchAt: days(this.deps.tech.contentRefreshDays) }
        : { environment, hotelId, language, slug: hotelSlug('', hotelId), status: 'NOT_FOUND', content: null, fetchedAt: at.toISOString(), nextFetchAt: days(7) };
      await this.deps.repo.saveContent(row);
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------ read model for the pages

export interface ListedPrice {
  /** Lowest price of 1 room, 2 adults, 1 night on `checkin`. */
  amount: MoneyJson;
  checkin: string;
  /** Payable at the hotel on top, in the same currency; null = none stated. */
  payAtProperty: MoneyJson | null;
  /** The provider states amounts payable at the hotel in another currency. */
  payAtPropertyOtherCurrency: boolean;
  boardType: string | null;
  /** When this price was taken from the provider. */
  asOf: string;
  adults: number;
  nights: number;
  nationality: string;
}

export interface ListedHotel {
  hotelId: string;
  slug: string;
  name: string;
  stars: number | null;
  city: string | null;
  address: string | null;
  image: string | null;
  facilities: string[];
  /** The provider's guest rating (0-10) and review count; shown with its source, never marked up as ours. */
  rating: number | null;
  reviewCount: number | null;
  price: ListedPrice | null;
}

export interface HotelListPageView {
  cmsId: string;
  locale: HotelListLocale;
  slugs: Record<string, string>;
  hotels: ListedHotel[];
  /** Why no prices are shown (null when prices may be shown). */
  pricesHiddenReason: 'NO_SETTINGS' | 'SALES_CLOSED' | 'CMS_MISMATCH' | null;
  currency: string | null;
  priceRange: { min: MoneyJson; max: MoneyJson } | null;
  /** The oldest price shown ("as of"). */
  pricesAsOf: string | null;
}

export interface HotelPageView {
  hotelId: string;
  locale: HotelListLocale;
  slug: string;
  slugs: Record<string, string>;
  content: HotelContent;
  price: ListedPrice | null;
  /** Indexed only while a published list holds the hotel. */
  indexable: boolean;
  /** Lists showing the hotel (for links back), in this language. */
  lists: Array<{ cmsId: string; slug: string; title: string }>;
  currency: string | null;
  nationality: string | null;
}

const content = (r: HotelContentRow | undefined) => (r && r.status === 'OK' ? (r.content as HotelContent) : null);

export class HotelListPages {
  private readonly clock: () => Date;

  constructor(private readonly deps: { repo: HotelListRepository; pricing: HotelPricing; clock?: () => Date }) {
    this.clock = deps.clock ?? (() => new Date());
  }

  private get environment(): ProviderEnvironment {
    return this.deps.pricing.settings.environment;
  }

  private async settings(): Promise<HotelListSettings | null> {
    const s = hotelListSettingsSchema.safeParse(await this.deps.repo.settings());
    return s.success ? s.data : null;
  }

  /** Prices of the scopes that may be shown now, lowest per hotel (earliest date on ties). */
  private async validPrices(scopeKeys: string[], r: ResolvedHotelPricing | null, settings: HotelListSettings, nationality: string, hotelIds?: string[], onDate?: string): Promise<Map<string, ListedPrice>> {
    const out = new Map<string, ListedPrice>();
    if (!r) return out;
    const now = this.clock();
    const from = addDays(istanbulDate(now), 1);
    const minAsOf = now.getTime() - settings.maxPriceAgeHours * 3_600_000;
    for (const p of await this.deps.repo.prices(scopeKeys, from, hotelIds)) {
      if (p.fingerprint !== r.fingerprint || Date.parse(p.lastSuccessAt) < minAsOf) continue;
      if (onDate !== undefined && p.checkin !== onDate) continue;
      const prev = out.get(p.hotelId);
      const prevMinor = prev ? BigInt(prev.amount.minor) : null;
      if (prevMinor !== null && (p.sellMinor > prevMinor || (p.sellMinor === prevMinor && p.checkin >= prev!.checkin))) continue;
      out.set(p.hotelId, {
        amount: toJson(money(r.currency, p.sellMinor)),
        checkin: p.checkin,
        payAtProperty: p.payAtPropertyMinor !== null && p.payAtPropertyMinor > 0n ? toJson(money(r.currency, p.payAtPropertyMinor)) : null,
        payAtPropertyOtherCurrency: p.payAtPropertyOtherCurrency,
        boardType: p.boardType,
        asOf: p.lastSuccessAt,
        adults: REFERENCE_ADULTS,
        nights: 1,
        nationality,
      });
    }
    return out;
  }

  private async resolve(currency: string): Promise<ResolvedHotelPricing | null> {
    try {
      return await this.deps.pricing.resolve(currency);
    } catch (err) {
      if (err instanceof CapabilityNotAvailableError) return null;
      throw err;
    }
  }

  /**
   * The hotels of a published list in one language. `cmsUpdatedAt` is the CMS document the page renders: when the mirror
   * holds another version (a publish that did not complete), the list shows no prices.
   */
  async list(cmsId: string, locale: HotelListLocale, cmsUpdatedAt: string | null): Promise<HotelListPageView | null> {
    const list = await this.deps.repo.list(cmsId);
    if (!list || !list.published || !list.slugs[locale]) return null;
    const parsed = hotelListConfigSchema.safeParse(list.config);
    if (!parsed.success) return null;
    const config = parsed.data;
    const settings = await this.settings();
    const ls = settings?.locales[locale] ?? null;
    const now = this.clock();
    const scope = ls ? scopeFor(config, ls, this.environment) : null;
    const members = scope ? await this.deps.repo.members([scope.scopeKey], new Date(now.getTime() - MEMBER_GRACE_DAYS * 86_400_000)) : [];
    const excluded = new Set(config.exclude);
    const ids = [...new Set([...config.pinned, ...members.map((m) => m.hotelId), ...config.include])].filter((id) => !excluded.has(id));
    const rank = new Map(members.map((m) => [m.hotelId, m.rank]));
    const summaries = new Map(members.map((m) => [m.hotelId, m.summary as Partial<HotelSummary>]));
    const contents = new Map((await this.deps.repo.content(this.environment, ids, locale)).map((c) => [c.hotelId, c]));

    let hidden: HotelListPageView['pricesHiddenReason'] = null;
    let r: ResolvedHotelPricing | null = null;
    if (!settings || !ls) hidden = 'NO_SETTINGS';
    else if (cmsUpdatedAt !== null && cmsUpdatedAt !== list.cmsUpdatedAt) hidden = 'CMS_MISMATCH';
    else {
      r = await this.resolve(ls.currency);
      if (!r) hidden = 'SALES_CLOSED';
    }
    const prices = scope && settings && ls && !hidden ? await this.validPrices([scope.scopeKey], r, settings, ls.nationality, ids) : new Map<string, ListedPrice>();

    let hotels: ListedHotel[] = [];
    for (const id of ids) {
      const row = contents.get(id);
      const c = content(row);
      if (!c || !row) continue; // no page to link to yet
      const stars = c.stars ?? summaries.get(id)?.stars ?? null;
      if (config.stars.length > 0 && (stars === null || !config.stars.includes(Math.round(stars)))) continue;
      hotels.push({
        hotelId: id,
        slug: row.slug,
        name: c.name,
        stars,
        city: c.city,
        address: c.address,
        image: c.images[0]?.url ?? summaries.get(id)?.mainPhoto ?? null,
        facilities: c.facilities.slice(0, 4),
        rating: c.rating,
        reviewCount: c.reviewCount,
        price: prices.get(id) ?? null,
      });
    }
    const pinned = new Map(config.pinned.map((id, i) => [id, i]));
    const byPrice = (a: ListedHotel, b: ListedHotel) => {
      if (a.price && b.price) return BigInt(a.price.amount.minor) < BigInt(b.price.amount.minor) ? -1 : BigInt(a.price.amount.minor) > BigInt(b.price.amount.minor) ? 1 : 0;
      return a.price ? -1 : b.price ? 1 : 0;
    };
    const byRank = (a: ListedHotel, b: ListedHotel) => (rank.get(a.hotelId) ?? 1e9) - (rank.get(b.hotelId) ?? 1e9);
    const include = new Map(config.include.map((id, i) => [id, i]));
    hotels.sort((a, b) => {
      const pa = pinned.get(a.hotelId);
      const pb = pinned.get(b.hotelId);
      if (pa !== undefined || pb !== undefined) return (pa ?? 1e9) - (pb ?? 1e9);
      if (config.sort === 'PRICE') return byPrice(a, b) || byRank(a, b);
      if (config.sort === 'MANUAL') return (include.get(a.hotelId) ?? 1e9) - (include.get(b.hotelId) ?? 1e9) || byRank(a, b);
      return byRank(a, b);
    });
    hotels = hotels.slice(0, config.maxItems);
    const shown = hotels.map((h) => h.price).filter((p): p is ListedPrice => p !== null);
    const minors = shown.map((p) => BigInt(p.amount.minor));
    const priceRange =
      shown.length > 0 && r
        ? { min: toJson(money(r.currency, minors.reduce((a, b) => (b < a ? b : a)))), max: toJson(money(r.currency, minors.reduce((a, b) => (b > a ? b : a)))) }
        : null;
    return {
      cmsId,
      locale,
      slugs: list.slugs,
      hotels,
      pricesHiddenReason: hidden,
      currency: ls?.currency ?? null,
      priceRange,
      pricesAsOf: shown.length > 0 ? shown.map((p) => p.asOf).sort()[0]! : null,
    };
  }

  /** In which languages, and on which published lists, a hotel is actually shown (same filters as the list pages). */
  private async listings(hotelId: string): Promise<Record<HotelListLocale, Array<{ cmsId: string; slug: string; title: string; boardType: HotelListConfig['boardType'] }>>> {
    const out: Record<HotelListLocale, Array<{ cmsId: string; slug: string; title: string; boardType: HotelListConfig['boardType'] }>> = { tr: [], en: [] };
    for (const list of await this.deps.repo.publishedLists()) {
      const cfg = hotelListConfigSchema.safeParse(list.config);
      if (!cfg.success) continue;
      for (const l of HOTEL_LIST_LOCALES) {
        if (!list.slugs[l]) continue;
        const view = await this.list(list.cmsId, l, null);
        if (view?.hotels.some((h) => h.hotelId === hotelId)) out[l].push({ cmsId: list.cmsId, slug: list.slugs[l]!, title: list.titles[l] ?? list.slugs[l]!, boardType: cfg.data.boardType });
      }
    }
    return out;
  }

  /**
   * A hotel page by its address in a language; null when the hotel has no content here. The price matches what the
   * page's search form will look for: the board of the link (none = lists without a board filter), and the linked
   * check-in date when it has a price.
   */
  async hotel(locale: HotelListLocale, slug: string, opts: { board?: string | null; checkin?: string | null } = {}): Promise<HotelPageView | null> {
    if (!/^[a-z0-9-]{2,130}$/.test(slug)) return null;
    const row = await this.deps.repo.contentBySlug(this.environment, locale, slug);
    const c = content(row ?? undefined);
    if (!row || !c) return null;
    const settings = await this.settings();
    const ls = settings?.locales[locale] ?? null;
    const listed = await this.listings(row.hotelId);
    const here = listed[locale];
    const board = opts.board ?? null;
    let price: ListedPrice | null = null;
    if (settings && ls) {
      const parsed = (await this.deps.repo.publishedLists()).map((l) => ({ l, cfg: hotelListConfigSchema.safeParse(l.config) }));
      const scopeKeys = here
        .filter((h) => h.boardType === board)
        .map((h) => parsed.find((p) => p.l.cmsId === h.cmsId))
        .filter((p): p is { l: HotelListRow; cfg: { success: true; data: HotelListConfig } } => p !== undefined && p.cfg.success)
        .map((p) => scopeFor(p.cfg.data, ls, this.environment).scopeKey);
      if (scopeKeys.length > 0) {
        const r = await this.resolve(ls.currency);
        const day = opts.checkin && /^\d{4}-\d{2}-\d{2}$/.test(opts.checkin) ? opts.checkin : undefined;
        price =
          (day ? (await this.validPrices(scopeKeys, r, settings, ls.nationality, [row.hotelId], day)).get(row.hotelId) : undefined) ??
          (await this.validPrices(scopeKeys, r, settings, ls.nationality, [row.hotelId])).get(row.hotelId) ??
          null;
      }
    }
    const all = await this.deps.repo.slugsOf(this.environment, row.hotelId);
    // hreflang only to the language versions that are listed (indexable), plus this page itself.
    const slugs = Object.fromEntries(Object.entries(all).filter(([l]) => l === locale || (listed[l as HotelListLocale]?.length ?? 0) > 0));
    return {
      hotelId: row.hotelId,
      locale,
      slug: row.slug,
      slugs,
      content: c,
      price,
      indexable: here.length > 0,
      lists: here.map(({ cmsId, slug: s, title }) => ({ cmsId, slug: s, title })),
      currency: ls?.currency ?? null,
      nationality: ls?.nationality ?? null,
    };
  }

  /** Published lists and the hotels they show, per language (sitemap). */
  async sitemap(): Promise<{ lists: Array<{ slugs: Record<string, string>; updatedAt: string }>; hotels: Array<{ slugs: Record<string, string>; updatedAt: string }> }> {
    const lists = await this.deps.repo.publishedLists();
    const shownIn = new Map<string, Set<HotelListLocale>>();
    for (const l of HOTEL_LIST_LOCALES) {
      for (const list of lists) {
        if (!list.slugs[l]) continue;
        for (const h of (await this.list(list.cmsId, l, null))?.hotels ?? []) shownIn.set(h.hotelId, (shownIn.get(h.hotelId) ?? new Set()).add(l));
      }
    }
    const hotels: Array<{ slugs: Record<string, string>; updatedAt: string }> = [];
    for (const l of HOTEL_LIST_LOCALES) {
      const ids = [...shownIn.entries()].filter(([, ls]) => ls.has(l)).map(([id]) => id);
      for (const row of await this.deps.repo.content(this.environment, ids, l)) {
        if (row.status !== 'OK') continue;
        const langs = shownIn.get(row.hotelId)!;
        // One entry per hotel: built on its first listed language with every listed language as alternates.
        if ([...langs][0] !== l) continue;
        const slugs: Record<string, string> = {};
        for (const other of langs) {
          const r = other === l ? row : (await this.deps.repo.content(this.environment, [row.hotelId], other))[0];
          if (r && r.status === 'OK') slugs[other] = r.slug;
        }
        hotels.push({ slugs, updatedAt: row.fetchedAt });
      }
    }
    return { lists: lists.map((l) => ({ slugs: l.slugs, updatedAt: l.updatedAt })), hotels };
  }
}

/** Helper for views: amount of a listed price as Money. */
export const listedAmount = (p: ListedPrice) => fromJson(p.amount);
