import { and, asc, eq, gt, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import type { ProviderEnvironment } from '@texholiday/contracts';
import type { CoreDb } from './client';
import { hotelContent, hotelListDays, hotelListMembers, hotelListPrices, hotelListScopes, hotelListSettings, hotelLists, rateSlots } from './schema';

/**
 * Storage of the hotel list pages (ADR-0014). The list mirror and settings are written by the CMS after a publish; the
 * scanner owns scopes, days, prices and members; hotel content is a slow cache of `/data/hotel`. The JSON shapes are
 * defined by the booking service that reads them.
 */
export interface HotelListRow {
  cmsId: string;
  slugs: Record<string, string>;
  titles: Record<string, string>;
  config: unknown;
  published: boolean;
  cmsUpdatedAt: string;
  updatedAt: string;
}

export interface HotelListDayClaim {
  scopeKey: string;
  checkin: string;
  scope: unknown;
  currency: string;
  environment: ProviderEnvironment;
  attempts: number;
}

export interface HotelListPriceRow {
  scopeKey: string;
  checkin: string;
  hotelId: string;
  sellMinor: bigint;
  payAtPropertyMinor: bigint | null;
  payAtPropertyOtherCurrency: boolean;
  boardType: string | null;
  lastSuccessAt: string;
  fingerprint: string;
}

export interface HotelListMemberRow {
  scopeKey: string;
  hotelId: string;
  summary: unknown;
  rank: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface HotelContentRow {
  environment: ProviderEnvironment;
  hotelId: string;
  language: string;
  slug: string;
  status: 'OK' | 'NOT_FOUND';
  content: unknown;
  fetchedAt: string;
  nextFetchAt: string;
}

const iso = (v: string) => new Date(v).toISOString();

function listRow(r: typeof hotelLists.$inferSelect): HotelListRow {
  return { ...r, slugs: r.slugs as Record<string, string>, titles: r.titles as Record<string, string>, updatedAt: iso(r.updatedAt) };
}

function contentRow(r: typeof hotelContent.$inferSelect): HotelContentRow {
  return { ...r, fetchedAt: iso(r.fetchedAt), nextFetchAt: iso(r.nextFetchAt) };
}

export class HotelListRepository {
  constructor(private readonly db: CoreDb) {}

  // ------------------------------------------------------------------ list mirror and settings (written by the CMS)

  async upsertList(row: Omit<HotelListRow, 'updatedAt'>, now: Date): Promise<void> {
    const values = { slugs: row.slugs, titles: row.titles, config: row.config, published: row.published, cmsUpdatedAt: row.cmsUpdatedAt, updatedAt: now.toISOString() };
    await this.db
      .insert(hotelLists)
      .values({ cmsId: row.cmsId, ...values })
      .onConflictDoUpdate({ target: hotelLists.cmsId, set: values });
  }

  async setPublished(cmsId: string, published: boolean, now: Date): Promise<void> {
    await this.db.update(hotelLists).set({ published, updatedAt: now.toISOString() }).where(eq(hotelLists.cmsId, cmsId));
  }

  async publishedLists(): Promise<HotelListRow[]> {
    return (await this.db.select().from(hotelLists).where(eq(hotelLists.published, true))).map(listRow);
  }

  async list(cmsId: string): Promise<HotelListRow | null> {
    const [r] = await this.db.select().from(hotelLists).where(eq(hotelLists.cmsId, cmsId));
    return r ? listRow(r) : null;
  }

  async saveSettings(settings: unknown, now: Date): Promise<void> {
    await this.db
      .insert(hotelListSettings)
      .values({ id: 'default', settings, updatedAt: now.toISOString() })
      .onConflictDoUpdate({ target: hotelListSettings.id, set: { settings, updatedAt: now.toISOString() } });
  }

  async settings(): Promise<unknown | null> {
    const [r] = await this.db.select().from(hotelListSettings).where(eq(hotelListSettings.id, 'default'));
    return r ? r.settings : null;
  }

  // ------------------------------------------------------------------ scopes and days (the scanner)

  /**
   * Makes `scopes` the active ones, gives each a row per check-in date in `days` (new rows are due at once) and drops
   * rows of dates outside the window (their prices cascade). Scopes no list needs any more become inactive.
   */
  async syncScopes(scopes: ReadonlyArray<{ scopeKey: string; scope: unknown; environment: ProviderEnvironment; currency: string }>, days: readonly string[], now: Date): Promise<void> {
    const at = now.toISOString();
    await this.db.transaction(async (tx) => {
      const keys = scopes.map((s) => s.scopeKey);
      await tx
        .update(hotelListScopes)
        .set({ active: false, updatedAt: at })
        .where(keys.length > 0 ? and(eq(hotelListScopes.active, true), notInArray(hotelListScopes.scopeKey, keys)) : eq(hotelListScopes.active, true));
      for (const s of scopes) {
        await tx
          .insert(hotelListScopes)
          .values({ scopeKey: s.scopeKey, scope: s.scope, environment: s.environment, currency: s.currency, active: true, updatedAt: at })
          .onConflictDoUpdate({ target: hotelListScopes.scopeKey, set: { active: true, updatedAt: at } });
      }
      if (days.length > 0) {
        await tx.delete(hotelListDays).where(or(lt(hotelListDays.checkin, days[0]!), gt(hotelListDays.checkin, days[days.length - 1]!)));
        if (keys.length > 0) {
          const rows = keys.flatMap((scopeKey) => days.map((checkin) => ({ scopeKey, checkin, nextDueAt: at })));
          for (let i = 0; i < rows.length; i += 1000) await tx.insert(hotelListDays).values(rows.slice(i, i + 1000)).onConflictDoNothing();
        }
      }
    });
  }

  /** Days of active scopes in `currency` priced with another fingerprint (e.g. a new pricing policy) become due now. */
  async markStale(environment: ProviderEnvironment, currency: string, fingerprint: string, now: Date): Promise<number> {
    const rows = await this.db
      .update(hotelListDays)
      .set({ nextDueAt: now.toISOString() })
      .where(
        and(
          sql`${hotelListDays.scopeKey} IN (SELECT ${hotelListScopes.scopeKey} FROM ${hotelListScopes} WHERE ${hotelListScopes.active} AND ${hotelListScopes.environment} = ${environment} AND ${hotelListScopes.currency} = ${currency})`,
          sql`${hotelListDays.fingerprint} IS DISTINCT FROM ${fingerprint}`,
          // Only priced days that are not in a retry: a failing day keeps its backoff (no call storm every minute).
          sql`${hotelListDays.lastSuccessAt} IS NOT NULL`,
          eq(hotelListDays.attempts, 0),
          gt(hotelListDays.nextDueAt, now.toISOString()),
        ),
      )
      .returning({ scopeKey: hotelListDays.scopeKey });
    return rows.length;
  }

  /** Leases the most overdue day of an active scope (multi-process safe); null when nothing is due. */
  async claimDay(workerId: string, now: Date, leaseSeconds: number): Promise<HotelListDayClaim | null> {
    const at = now.toISOString();
    const until = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    const res = await this.db.execute<{ scope_key: string; checkin: string; attempts: number }>(sql`
      UPDATE ${hotelListDays} SET locked_until = ${until}, locked_by = ${workerId}, attempts = ${hotelListDays.attempts} + 1
      WHERE (scope_key, checkin) IN (
        SELECT d.scope_key, d.checkin FROM ${hotelListDays} d JOIN ${hotelListScopes} s ON s.scope_key = d.scope_key AND s.active
        WHERE d.next_due_at <= ${at} AND (d.locked_until IS NULL OR d.locked_until < ${at})
        ORDER BY d.next_due_at, d.checkin LIMIT 1 FOR UPDATE OF d SKIP LOCKED)
      RETURNING scope_key, checkin, attempts`);
    const r = res.rows[0];
    if (!r) return null;
    const [s] = await this.db.select().from(hotelListScopes).where(eq(hotelListScopes.scopeKey, r.scope_key));
    if (!s) return null;
    return { scopeKey: r.scope_key, checkin: r.checkin, scope: s.scope, currency: s.currency, environment: s.environment, attempts: Number(r.attempts) };
  }

  /**
   * Replaces the prices of a fully answered day and refreshes the scope's members, in one transaction. Ignored (false)
   * when the lease was lost to another worker meanwhile.
   */
  async completeDay(
    input: {
      scopeKey: string;
      checkin: string;
      workerId: string;
      fingerprint: string;
      prices: ReadonlyArray<{ hotelId: string; sellMinor: bigint; payAtPropertyMinor: bigint | null; payAtPropertyOtherCurrency: boolean; boardType: string | null }>;
      members: ReadonlyArray<{ hotelId: string; summary: unknown; rank: number }>;
      nextDueAt: Date;
    },
    now: Date,
  ): Promise<boolean> {
    const at = now.toISOString();
    return this.db.transaction(async (tx) => {
      const [day] = await tx
        .select()
        .from(hotelListDays)
        .where(and(eq(hotelListDays.scopeKey, input.scopeKey), eq(hotelListDays.checkin, input.checkin)))
        .for('update');
      if (!day || day.lockedBy !== input.workerId) return false;
      await tx.delete(hotelListPrices).where(and(eq(hotelListPrices.scopeKey, input.scopeKey), eq(hotelListPrices.checkin, input.checkin)));
      for (let i = 0; i < input.prices.length; i += 1000) {
        const chunk = input.prices.slice(i, i + 1000);
        if (chunk.length > 0) await tx.insert(hotelListPrices).values(chunk.map((p) => ({ scopeKey: input.scopeKey, checkin: input.checkin, ...p })));
      }
      for (const m of input.members) {
        await tx
          .insert(hotelListMembers)
          .values({ scopeKey: input.scopeKey, hotelId: m.hotelId, summary: m.summary, rank: m.rank, firstSeenAt: at, lastSeenAt: at })
          .onConflictDoUpdate({ target: [hotelListMembers.scopeKey, hotelListMembers.hotelId], set: { summary: m.summary, rank: m.rank, lastSeenAt: at } });
      }
      await tx
        .update(hotelListDays)
        .set({ lastSuccessAt: at, fingerprint: input.fingerprint, attempts: 0, lastError: null, lockedUntil: null, lockedBy: null, nextDueAt: input.nextDueAt.toISOString() })
        .where(and(eq(hotelListDays.scopeKey, input.scopeKey), eq(hotelListDays.checkin, input.checkin)));
      return true;
    });
  }

  /** Extends this worker's lease of a day; false when another worker holds it now. */
  async renewDay(scopeKey: string, checkin: string, workerId: string, until: Date): Promise<boolean> {
    const rows = await this.db
      .update(hotelListDays)
      .set({ lockedUntil: until.toISOString() })
      .where(and(eq(hotelListDays.scopeKey, scopeKey), eq(hotelListDays.checkin, checkin), eq(hotelListDays.lockedBy, workerId)))
      .returning({ scopeKey: hotelListDays.scopeKey });
    return rows.length === 1;
  }

  /** Releases a day whose answer was not complete; its previous prices stay. */
  async failDay(input: { scopeKey: string; checkin: string; workerId: string; error: string; nextDueAt: Date }): Promise<void> {
    await this.db
      .update(hotelListDays)
      .set({ lastError: input.error.slice(0, 300), lockedUntil: null, lockedBy: null, nextDueAt: input.nextDueAt.toISOString() })
      .where(and(eq(hotelListDays.scopeKey, input.scopeKey), eq(hotelListDays.checkin, input.checkin), eq(hotelListDays.lockedBy, input.workerId)));
  }

  /** Prices of the scopes from `fromDate` (YYYY-MM-DD) on, with when and how each day was priced. */
  async prices(scopeKeys: readonly string[], fromDate: string, hotelIds?: readonly string[]): Promise<HotelListPriceRow[]> {
    if (scopeKeys.length === 0 || (hotelIds && hotelIds.length === 0)) return [];
    const rows = await this.db
      .select({
        scopeKey: hotelListPrices.scopeKey,
        checkin: hotelListPrices.checkin,
        hotelId: hotelListPrices.hotelId,
        sellMinor: hotelListPrices.sellMinor,
        payAtPropertyMinor: hotelListPrices.payAtPropertyMinor,
        payAtPropertyOtherCurrency: hotelListPrices.payAtPropertyOtherCurrency,
        boardType: hotelListPrices.boardType,
        lastSuccessAt: hotelListDays.lastSuccessAt,
        fingerprint: hotelListDays.fingerprint,
      })
      .from(hotelListPrices)
      .innerJoin(hotelListDays, and(eq(hotelListDays.scopeKey, hotelListPrices.scopeKey), eq(hotelListDays.checkin, hotelListPrices.checkin)))
      .where(
        and(
          inArray(hotelListPrices.scopeKey, [...scopeKeys]),
          sql`${hotelListPrices.checkin} >= ${fromDate}`,
          ...(hotelIds ? [inArray(hotelListPrices.hotelId, [...hotelIds])] : []),
        ),
      );
    return rows.filter((r) => r.lastSuccessAt !== null && r.fingerprint !== null).map((r) => ({ ...r, lastSuccessAt: iso(r.lastSuccessAt!), fingerprint: r.fingerprint! }));
  }

  async members(scopeKeys: readonly string[], seenSince: Date): Promise<HotelListMemberRow[]> {
    if (scopeKeys.length === 0) return [];
    const rows = await this.db
      .select()
      .from(hotelListMembers)
      .where(and(inArray(hotelListMembers.scopeKey, [...scopeKeys]), sql`${hotelListMembers.lastSeenAt} >= ${seenSince.toISOString()}`))
      .orderBy(asc(hotelListMembers.rank));
    return rows.map((r) => ({ ...r, firstSeenAt: iso(r.firstSeenAt), lastSeenAt: iso(r.lastSeenAt) }));
  }

  /** Hotels of the scopes, for the content fetch (members seen since `seenSince`). */
  async memberIds(seenSince: Date): Promise<Array<{ hotelId: string; environment: ProviderEnvironment }>> {
    const rows = await this.db
      .selectDistinct({ hotelId: hotelListMembers.hotelId, environment: hotelListScopes.environment })
      .from(hotelListMembers)
      .innerJoin(hotelListScopes, and(eq(hotelListScopes.scopeKey, hotelListMembers.scopeKey), eq(hotelListScopes.active, true)))
      .where(sql`${hotelListMembers.lastSeenAt} >= ${seenSince.toISOString()}`);
    return rows;
  }

  /** Day states of the scopes (for the panel and tests). */
  async days(scopeKey: string) {
    return this.db.select().from(hotelListDays).where(eq(hotelListDays.scopeKey, scopeKey)).orderBy(asc(hotelListDays.checkin));
  }

  /**
   * Waits for a turn in a shared call budget: returns the instant this caller may call (all processes share one row,
   * so N workers together keep the pace).
   */
  async takeRateSlot(name: string, intervalMs: number, now: Date): Promise<Date> {
    const at = now.toISOString();
    const step = `${Math.max(1, Math.round(intervalMs))} milliseconds`;
    const res = await this.db.execute<{ slot: string }>(sql`
      INSERT INTO ${rateSlots} (name, next_at) VALUES (${name}, ${at}::timestamptz + ${step}::interval)
      ON CONFLICT (name) DO UPDATE SET next_at = greatest(${rateSlots.nextAt}, ${at}::timestamptz) + ${step}::interval
      RETURNING next_at - ${step}::interval AS slot`);
    return new Date(res.rows[0]!.slot);
  }

  // ------------------------------------------------------------------ hotel content

  async content(environment: ProviderEnvironment, hotelIds: readonly string[], language: string): Promise<HotelContentRow[]> {
    if (hotelIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(hotelContent)
      .where(and(eq(hotelContent.environment, environment), inArray(hotelContent.hotelId, [...hotelIds]), eq(hotelContent.language, language)));
    return rows.map(contentRow);
  }

  async contentBySlug(environment: ProviderEnvironment, language: string, slug: string): Promise<HotelContentRow | null> {
    const [r] = await this.db
      .select()
      .from(hotelContent)
      .where(and(eq(hotelContent.environment, environment), eq(hotelContent.language, language), eq(hotelContent.slug, slug)));
    return r ? contentRow(r) : null;
  }

  /** The hotel page addresses of a hotel in every language (hreflang). */
  async slugsOf(environment: ProviderEnvironment, hotelId: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ language: hotelContent.language, slug: hotelContent.slug })
      .from(hotelContent)
      .where(and(eq(hotelContent.environment, environment), eq(hotelContent.hotelId, hotelId), eq(hotelContent.status, 'OK')));
    return Object.fromEntries(rows.map((r) => [r.language, r.slug]));
  }

  /** Of the given hotels, those whose content in this language is missing or due. */
  async contentDue(environment: ProviderEnvironment, hotelIds: readonly string[], language: string, now: Date): Promise<string[]> {
    if (hotelIds.length === 0) return [];
    const fresh = await this.db
      .select({ hotelId: hotelContent.hotelId })
      .from(hotelContent)
      .where(
        and(
          eq(hotelContent.environment, environment),
          inArray(hotelContent.hotelId, [...hotelIds]),
          eq(hotelContent.language, language),
          gt(hotelContent.nextFetchAt, now.toISOString()),
        ),
      );
    const have = new Set(fresh.map((h) => h.hotelId));
    return hotelIds.filter((h) => !have.has(h));
  }

  /** Saves content; a hotel keeps the address it was first published under (a provider rename must not break it). */
  async saveContent(row: HotelContentRow): Promise<void> {
    const set = {
      // In ON CONFLICT the existing row is named by the bare table name (no schema).
      slug: sql`CASE WHEN "hotel_content"."status" = 'OK' THEN "hotel_content"."slug" ELSE excluded.slug END`,
      status: row.status,
      content: row.content,
      fetchedAt: row.fetchedAt,
      nextFetchAt: row.nextFetchAt,
    };
    await this.db
      .insert(hotelContent)
      .values({ environment: row.environment, hotelId: row.hotelId, language: row.language, ...set, slug: row.slug })
      .onConflictDoUpdate({ target: [hotelContent.environment, hotelContent.hotelId, hotelContent.language], set });
  }

  /** Sitemap: hotels with content in a language. */
  async contentList(environment: ProviderEnvironment, language: string): Promise<Array<{ hotelId: string; slug: string; fetchedAt: string }>> {
    const rows = await this.db
      .select({ hotelId: hotelContent.hotelId, slug: hotelContent.slug, fetchedAt: hotelContent.fetchedAt })
      .from(hotelContent)
      .where(and(eq(hotelContent.environment, environment), eq(hotelContent.language, language), eq(hotelContent.status, 'OK')));
    return rows.map((r) => ({ ...r, fetchedAt: iso(r.fetchedAt) }));
  }
}
