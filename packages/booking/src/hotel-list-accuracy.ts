import { CapabilityNotAvailableError, type ProviderEnvironment } from '@texholiday/contracts';
import type { HotelListRepository, PriceCheckInput, PriceCheckOutcome } from '@texholiday/db';
import { fromJson, money, toJson, type MoneyJson } from '@texholiday/pricing';
import type { HotelPricing } from './hotel-pricing';
import { addDays, hotelListSettingsSchema, PRICE_CHECK_RETENTION_DAYS, REFERENCE_ADULTS, type HotelListScope } from './hotel-lists';

/**
 * List price accuracy (ADR-0014): every live hotel search that matches the list reference (1 room, 2 adults, no
 * children, 1 night, the currency, nationality and board of an active list scope) is compared with the stored list
 * price of the same hotel and date. Nothing is asked of the provider for this: it rides on searches visitors make.
 * A failure here never fails the search (the caller swallows it).
 */
export interface LiveSearchSample {
  currency: string;
  nationality: string;
  checkin: string;
  checkout: string;
  rooms: ReadonlyArray<{ adults: number; childAges: readonly number[] }>;
  /** The board filter of the search; undefined = any board. */
  boardType: string | undefined;
  /** Hotels the visitor asked for by id (a hotel page search): a missing one counts as "not bookable". */
  requestedHotelIds: readonly string[] | null;
  /** Customer prices of the offers as the search shows them. */
  offers: ReadonlyArray<{ hotelId: string; sell: MoneyJson }>;
}

/** At most this many comparisons per search (a place search can return many hotels). */
const MAX_CHECKS_PER_SEARCH = 100;

export interface PriceAccuracyTotals {
  checks: number;
  same: number;
  liveHigher: number;
  liveLower: number;
  liveMissing: number;
  /** Average |live - list| over the checks with a live price; null when there is none. */
  averageGap: MoneyJson | null;
}

export interface PriceAccuracyReport {
  environment: ProviderEnvironment;
  since: string;
  days: number;
  /** Per currency: prices that were on the pages, and all stored prices (also too old to be shown). */
  currencies: Array<{ currency: string; shown: PriceAccuracyTotals; all: PriceAccuracyTotals }>;
  /** The list promised less than the live search, or the hotel was not bookable; largest gap first. */
  worst: Array<{
    hotelId: string;
    hotelName: string | null;
    hotelSlug: string | null;
    checkin: string;
    list: MoneyJson;
    live: MoneyJson | null;
    /** (live - list) / list in basis points; null when not bookable. */
    gapBasisPoints: number | null;
    outcome: PriceCheckOutcome;
    shown: boolean;
    listAsOf: string;
    checkedAt: string;
  }>;
}

export interface PriceAlert {
  configured: boolean;
  thresholdBasisPoints: number | null;
  hours: number;
  /** Hotel/date pairs where the live price was at least the threshold above the shown list price. */
  higher: number;
  /** Hotel/date pairs shown with a price that a hotel page search found not bookable. */
  missing: number;
  hotels: number;
}

export function compareListPrice(listMinor: bigint, liveMinor: bigint | null): PriceCheckOutcome {
  if (liveMinor === null) return 'LIVE_MISSING';
  if (liveMinor === listMinor) return 'SAME';
  return liveMinor > listMinor ? 'LIVE_HIGHER' : 'LIVE_LOWER';
}

export class HotelListPriceChecks {
  private readonly clock: () => Date;

  constructor(private readonly deps: { repo: HotelListRepository; pricing: HotelPricing; clock?: () => Date }) {
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Records the comparisons of one live search; returns how many were recorded. */
  async record(sample: LiveSearchSample): Promise<number> {
    const room = sample.rooms[0];
    if (sample.rooms.length !== 1 || !room || room.adults !== REFERENCE_ADULTS || room.childAges.length > 0) return 0;
    if (addDays(sample.checkin, 1) !== sample.checkout) return 0;
    const settings = hotelListSettingsSchema.safeParse(await this.deps.repo.settings());
    if (!settings.success) return 0;
    const environment = this.deps.pricing.settings.environment;
    const board = sample.boardType ?? null;
    const scopes = (await this.deps.repo.activeScopes(environment, sample.currency)).filter((s) => {
      const scope = s.scope as HotelListScope;
      return scope.nationality === sample.nationality && (scope.boardType ?? null) === board;
    });
    if (scopes.length === 0) return 0;
    let fingerprint: string;
    try {
      fingerprint = (await this.deps.pricing.resolve(sample.currency)).fingerprint;
    } catch (err) {
      if (err instanceof CapabilityNotAvailableError) return 0;
      throw err;
    }

    const live = new Map<string, bigint>();
    for (const o of sample.offers) {
      const sell = fromJson(o.sell);
      if (sell.currency !== sample.currency || sell.minor <= 0n) continue;
      const prev = live.get(o.hotelId);
      if (prev === undefined || sell.minor < prev) live.set(o.hotelId, sell.minor);
    }
    const requested = new Set(sample.requestedHotelIds ?? []);
    const candidates = [...new Set([...live.keys(), ...requested])];
    if (candidates.length === 0) return 0;

    const now = this.clock();
    const minAsOf = now.getTime() - settings.data.maxPriceAgeHours * 3_600_000;
    const rows: PriceCheckInput[] = [];
    for (const p of await this.deps.repo.prices(
      scopes.map((s) => s.scopeKey),
      sample.checkin,
      candidates,
    )) {
      // Only prices computed with today's pricing (others are never shown) on exactly this date.
      if (p.checkin !== sample.checkin || p.fingerprint !== fingerprint) continue;
      const liveMinor = live.get(p.hotelId) ?? null;
      // A place search returns a limited number of hotels: a hotel missing there says nothing about its availability.
      if (liveMinor === null && !requested.has(p.hotelId)) continue;
      rows.push({
        environment,
        scopeKey: p.scopeKey,
        hotelId: p.hotelId,
        checkin: p.checkin,
        currency: sample.currency,
        listMinor: p.sellMinor,
        liveMinor,
        listAsOf: p.lastSuccessAt,
        shown: Date.parse(p.lastSuccessAt) >= minAsOf,
        outcome: compareListPrice(p.sellMinor, liveMinor),
      });
      if (rows.length >= MAX_CHECKS_PER_SEARCH) break;
    }
    await this.deps.repo.recordPriceChecks(rows, now);
    return rows.length;
  }

  /**
   * The panel alert (ADR-0014): in the last `hours`, shown list prices that a live search found not bookable or at
   * least the configured threshold above. Without a threshold in the settings there is no alert (nothing defaulted).
   */
  async alert(hours = 24): Promise<PriceAlert> {
    const settings = hotelListSettingsSchema.safeParse(await this.deps.repo.settings());
    const threshold = settings.success ? (settings.data.priceAlertBasisPoints ?? null) : null;
    if (threshold === null) return { configured: false, thresholdBasisPoints: null, hours, higher: 0, missing: 0, hotels: 0 };
    const since = new Date(this.clock().getTime() - hours * 3_600_000);
    const found = await this.deps.repo.priceAlerts(this.deps.pricing.settings.environment, since, threshold);
    return { configured: true, thresholdBasisPoints: threshold, hours, ...found };
  }

  /** The panel report of the last `days` days. */
  async report(days: number): Promise<PriceAccuracyReport> {
    const environment = this.deps.pricing.settings.environment;
    const span = Math.min(Math.max(1, Math.trunc(days)), PRICE_CHECK_RETENTION_DAYS);
    const since = new Date(this.clock().getTime() - span * 86_400_000);
    const [shown, all, worst] = await Promise.all([
      this.deps.repo.priceCheckSummary(environment, since, true),
      this.deps.repo.priceCheckSummary(environment, since, false),
      this.deps.repo.worstPriceChecks(environment, since, 50),
    ]);
    const totals = (rows: typeof shown, currency: string): PriceAccuracyTotals => {
      const mine = rows.filter((r) => r.currency === currency);
      const count = (o: PriceCheckOutcome) => mine.find((r) => r.outcome === o)?.checks ?? 0;
      const priced = mine.filter((r) => r.outcome !== 'LIVE_MISSING');
      const pricedChecks = priced.reduce((a, r) => a + r.checks, 0);
      const gap = priced.reduce((a, r) => a + r.absDiffMinor, 0n);
      return {
        checks: mine.reduce((a, r) => a + r.checks, 0),
        same: count('SAME'),
        liveHigher: count('LIVE_HIGHER'),
        liveLower: count('LIVE_LOWER'),
        liveMissing: count('LIVE_MISSING'),
        averageGap: pricedChecks > 0 ? toJson(money(currency, gap / BigInt(pricedChecks))) : null,
      };
    };
    const currencies = [...new Set(all.map((r) => r.currency))].sort();
    return {
      environment,
      since: since.toISOString(),
      days: span,
      currencies: currencies.map((c) => ({ currency: c, shown: totals(shown, c), all: totals(all, c) })),
      worst: worst.map((w) => ({
        hotelId: w.hotelId,
        hotelName: w.hotelName,
        hotelSlug: w.hotelSlug,
        checkin: w.checkin,
        list: toJson(money(w.currency, w.listMinor)),
        live: w.liveMinor === null ? null : toJson(money(w.currency, w.liveMinor)),
        gapBasisPoints: w.liveMinor === null ? null : Number(((w.liveMinor - w.listMinor) * 10_000n) / w.listMinor),
        outcome: w.outcome,
        shown: w.shown,
        listAsOf: w.listAsOf,
        checkedAt: w.checkedAt,
      })),
    };
  }
}
