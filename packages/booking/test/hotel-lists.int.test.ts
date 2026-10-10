import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { parseCapabilityMatrix, parseSourceLock, type StaffActor } from '@texholiday/contracts';
import { MockHotelConnector } from '@texholiday/connectors';
import { HotelListRepository, PermissionRepository, PolicyRepository, type CoreDatabase } from '@texholiday/db';
import { BookingApp, hotelSlug, scanDates, slugify, type BookingSettings, type HotelListConfig, type HotelListScanner } from '../src/index';
import { freshDatabase } from '../../db/test/support/db';

/** Hotel list pages (ADR-0014) against PostgreSQL with the MOCK hotel connector. */
const root = join(__dirname, '..', '..', '..');
const matrix = parseCapabilityMatrix(JSON.parse(readFileSync(join(root, 'contracts', 'capability-matrix.json'), 'utf8')));
const sourceLock = parseSourceLock(JSON.parse(readFileSync(join(root, 'contracts', 'sources.lock.json'), 'utf8')));

const settings: BookingSettings = {
  environment: 'mock',
  policyId: 'b2c',
  searchTtlSeconds: 1800,
  quoteTtlSeconds: 1200,
  payBySeconds: 1800,
  termsVersion: 'terms-test-1',
  accessTokenSecret: 'test-only-secret-0123456789abcdef0123',
  currencies: ['EUR', 'USD', 'GBP', 'TRY'],
  maxHotels: 60,
  maxRatesPerHotel: 8,
  intentLeaseSeconds: 600,
  maxAutomaticLookups: 3,
  enforceRateParity: true,
  hotelLists: { refreshHours: 24, callsPerSecond: 1000, candidates: 100, contentRefreshDays: 7 },
};

const clock = { now: new Date('2027-05-01T10:00:00Z') };
let core: CoreDatabase;
let hotels: MockHotelConnector;
let app: BookingApp;
let repo: HotelListRepository;
let scanner: HotelListScanner;
const owner: StaffActor = { kind: 'STAFF', id: 'owner' };
const finance: StaffActor = { kind: 'STAFF', id: 'finance' };
const approver: StaffActor = { kind: 'STAFF', id: 'approver' };

async function approvePricing(bp: number) {
  const policies = new PolicyRepository(core.db);
  const v = await policies.createDraft(
    'PRICING',
    'b2c',
    { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: bp }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
    finance,
  );
  await policies.approve('PRICING', 'b2c', v.version, approver);
}

const config = (over: Partial<HotelListConfig> = {}): HotelListConfig => ({
  places: [{ placeId: 'MOCK-PLACE-ANTALYA', name: 'Antalya (MOCK)', address: 'Antalya, Türkiye' }],
  include: [],
  exclude: [],
  pinned: [],
  stars: [],
  boardType: null,
  sort: 'PRICE',
  maxItems: 30,
  ...over,
});

async function publish(cmsId: string, slug: string, cfg: HotelListConfig, cmsUpdatedAt = '2027-05-01T09:00:00.000Z') {
  await repo.upsertList({ cmsId, slugs: { tr: slug, en: slug }, titles: { tr: `${slug} otelleri`, en: `${slug} hotels` }, config: cfg, published: true, cmsUpdatedAt }, clock.now);
}

beforeAll(async () => {
  core = await freshDatabase();
  hotels = new MockHotelConnector();
  app = new BookingApp({ db: core.db, hotels, matrix, sourceLock, settings, clock: () => clock.now });
  repo = app.hotelListRepository;
  const perms = new PermissionRepository(core.db);
  await perms.bootstrapManager(owner.id);
  await perms.grantRole(finance.id, 'FINANCE', owner);
  await perms.grantRole(approver.id, 'FINANCE_APPROVER', owner);
  await approvePricing(1000);
});
afterAll(async () => {
  await core?.close();
});
beforeEach(async () => {
  clock.now = new Date('2027-05-01T10:00:00Z');
  hotels.priceAdjustBp = () => 0n;
  hotels.failSearches = 0;
  hotels.soldOut.clear();
  await core.db.execute(sql`TRUNCATE core.hotel_lists, core.hotel_list_settings, core.hotel_list_scopes, core.hotel_content, core.rate_slots, core.hotel_list_price_checks CASCADE`);
  scanner = app.hotelListScanner('test-worker', { sleep: async () => {} });
});

describe('hotel list pages (ADR-0014)', () => {
  it('addresses: Turkish letters become ASCII words; hotel pages carry the provider code', () => {
    expect(slugify('Çırağan Sarayı Kempinski İstanbul')).toBe('ciragan-sarayi-kempinski-istanbul');
    expect(hotelSlug('Akra Antalya', 'lp1897')).toBe('akra-antalya-lp1897');
    expect(hotelSlug('MOCK Lara Beach Resort', 'MOCK-H1')).toBe('mock-lara-beach-resort-mock-h1');
    expect(scanDates(new Date('2027-05-01T22:30:00Z'))[0]).toBe('2027-05-03'); // already 2 May in Istanbul
    expect(scanDates(clock.now)).toHaveLength(30);
  });

  it('without price settings nothing is scanned and no price is shown (no default currency)', async () => {
    await publish('l1', 'antalya', config());
    expect(await scanner.runUntilIdle()).toBe(0);
    expect(hotels.calls.searchHotelRates ?? 0).toBe(0);
    const view = await app.hotelLists.list('l1', 'tr', null);
    expect(view).toMatchObject({ pricesHiddenReason: 'NO_SETTINGS', hotels: [] });
  });

  it('scans 30 dates at one call per date, fetches content, and shows the cheapest date priced exactly like the search', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('l1', 'antalya', config());
    // 10 % cheaper on 2027-05-20 only.
    hotels.priceAdjustBp = (d) => (d === '2027-05-20' ? -1000n : 0n);
    const before = hotels.calls.searchHotelRates ?? 0;
    await scanner.runUntilIdle();
    expect((hotels.calls.searchHotelRates ?? 0) - before).toBe(30);
    expect(hotels.calls.hotelContent).toBeGreaterThanOrEqual(2);

    const view = (await app.hotelLists.list('l1', 'tr', '2027-05-01T09:00:00.000Z'))!;
    expect(view.pricesHiddenReason).toBeNull();
    expect(view.hotels.map((h) => h.hotelId)).toEqual(['MOCK-H2', 'MOCK-H1']); // price order
    const h2 = view.hotels[0]!;
    expect(h2).toMatchObject({ slug: 'mock-kaleici-boutique-mock-h2', name: 'MOCK Kaleiçi Boutique', stars: 4 });
    expect(h2.price).toMatchObject({ checkin: '2027-05-20', adults: 2, nights: 1, nationality: 'TR', payAtProperty: null });

    // The same criteria in the live search show the same lowest price for that hotel.
    const live = await app.searchHotels({ target: { placeId: 'MOCK-PLACE-ANTALYA' }, checkin: '2027-05-20', checkout: '2027-05-21', rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale: 'tr' });
    expect(live.hotels.find((h) => h.hotelId === 'MOCK-H2')!.from).toEqual(h2.price!.amount);
    expect(live.hotels.find((h) => h.hotelId === 'MOCK-H1')!.from).toEqual(view.hotels[1]!.price!.amount);
    expect(view.priceRange).toEqual({ min: h2.price!.amount, max: view.hotels[1]!.price!.amount });
  });

  it('a lost answer keeps the previous prices of that day and retries later; the day is never emptied', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('l1', 'antalya', config());
    await scanner.runUntilIdle();
    const first = (await app.hotelLists.list('l1', 'tr', null))!.hotels.map((h) => h.price?.amount);
    // A day later every date is due again; every answer is lost now.
    clock.now = new Date('2027-05-02T10:30:00Z');
    hotels.failSearches = 1000;
    scanner = app.hotelListScanner('test-worker', { sleep: async () => {} });
    await scanner.runUntilIdle();
    const scope = (await core.db.execute<{ scope_key: string }>(sql`SELECT scope_key FROM core.hotel_list_scopes WHERE active`)).rows[0]!.scope_key;
    const days = await repo.days(scope);
    expect(days.filter((d) => d.lastError?.startsWith('UNKNOWN:TIMEOUT')).length).toBeGreaterThan(0);
    // A failing day keeps its backoff: the next sync does not make it due again (no call storm).
    await scanner.syncScopes();
    expect(await repo.claimDay('other-worker', clock.now, 60)).toBeNull();
    // The kept prices are a day old: still within the 26 h allowed, so they show; nothing was replaced by "no price".
    const after = (await app.hotelLists.list('l1', 'tr', null))!.hotels.map((h) => h.price?.amount);
    expect(after).toEqual(first);
    // Once older than allowed they are hidden rather than shown stale.
    clock.now = new Date('2027-05-02T12:30:00Z');
    expect((await app.hotelLists.list('l1', 'tr', null))!.hotels.every((h) => h.price === null)).toBe(true);
  });

  it('a new pricing policy hides every list price until the days are priced again with it', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('l1', 'antalya', config());
    await scanner.runUntilIdle();
    const old = (await app.hotelLists.list('l1', 'tr', null))!.hotels[0]!.price!.amount;
    await approvePricing(1500);
    expect((await app.hotelLists.list('l1', 'tr', null))!.hotels.every((h) => h.price === null)).toBe(true);
    scanner = app.hotelListScanner('test-worker', { sleep: async () => {} });
    await scanner.runUntilIdle();
    const fresh = (await app.hotelLists.list('l1', 'tr', null))!.hotels[0]!.price!.amount;
    expect(BigInt(fresh.minor)).toBeGreaterThan(BigInt(old.minor));
    await approvePricing(1000);
  });

  it('all-inclusive lists scan only AI rates; places and hotel codes combine; excluded and pinned hotels are honoured', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('ai', 'her-sey-dahil', config({ places: [{ placeId: 'MOCK-PLACE-ANTALYA', name: 'Antalya (MOCK)', address: '' }, { placeId: 'MOCK-PLACE-BELEK', name: 'Belek (MOCK)', address: '' }], boardType: 'AI', sort: 'PRICE' }));
    await publish('man', 'secilenler', config({ places: [], include: ['MOCK-H2', 'MOCK-H3', 'MOCK-H1'], exclude: ['MOCK-H3'], pinned: ['MOCK-H1'], sort: 'MANUAL' }));
    await scanner.runUntilIdle();
    const ai = (await app.hotelLists.list('ai', 'tr', null))!;
    expect(ai.hotels.map((h) => h.hotelId)).toEqual(['MOCK-H1', 'MOCK-H3']); // H2 has no all-inclusive rate
    expect(ai.hotels.every((h) => h.price?.boardType === 'AI')).toBe(true);
    const man = (await app.hotelLists.list('man', 'tr', null))!;
    expect(man.hotels.map((h) => h.hotelId)).toEqual(['MOCK-H1', 'MOCK-H2']);
    // The live search with the board filter finds the list's all-inclusive price.
    const live = await app.searchHotels({ target: { hotelIds: ['MOCK-H1'] }, checkin: ai.hotels[0]!.price!.checkin, checkout: '2027-05-03', rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale: 'tr', boardType: 'AI' });
    expect(live.hotels[0]!.from).toEqual(ai.hotels[0]!.price!.amount);
  });

  it('a list whose CMS copy differs from the mirror shows no prices; unpublished lists have no page', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('l1', 'antalya', config());
    await scanner.runUntilIdle();
    expect((await app.hotelLists.list('l1', 'tr', '2027-04-30T00:00:00.000Z'))!.pricesHiddenReason).toBe('CMS_MISMATCH');
    await repo.setPublished('l1', false, clock.now);
    expect(await app.hotelLists.list('l1', 'tr', null)).toBeNull();
  });

  it('hotel pages: by address, with the price of the list scope and indexable only while a published list holds the hotel', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('l1', 'antalya', config());
    await scanner.runUntilIdle();
    const page = (await app.hotelLists.hotel('tr', 'mock-lara-beach-resort-mock-h1'))!;
    expect(page).toMatchObject({ hotelId: 'MOCK-H1', indexable: true, lists: [{ cmsId: 'l1', slug: 'antalya' }], currency: 'EUR', nationality: 'TR' });
    expect(page.content.description).toContain('MOCK');
    expect(page.price).not.toBeNull();
    expect(await app.hotelLists.hotel('tr', 'no-such-hotel-x1')).toBeNull();
    await repo.setPublished('l1', false, clock.now);
    expect((await app.hotelLists.hotel('tr', 'mock-lara-beach-resort-mock-h1'))!).toMatchObject({ indexable: false, price: null });
  });

  it('two scanners never price the same day twice; the shared pace is kept across processes', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('l1', 'antalya', config());
    const a = app.hotelListScanner('worker-a', { sleep: async () => {} });
    const b = app.hotelListScanner('worker-b', { sleep: async () => {} });
    await a.syncScopes();
    const before = hotels.calls.searchHotelRates ?? 0;
    await Promise.all([a.runUntilIdle(), b.runUntilIdle()]);
    expect((hotels.calls.searchHotelRates ?? 0) - before).toBe(30);
    const t0 = new Date('2027-05-01T10:00:00Z');
    const s1 = await repo.takeRateSlot('pace-test', 1000, t0);
    const s2 = await repo.takeRateSlot('pace-test', 1000, t0);
    expect(s2.getTime() - s1.getTime()).toBe(1000);
  });

  it('top picks of several places alternate instead of the first place filling the list', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('tp', 'antalya-belek', config({ places: [{ placeId: 'MOCK-PLACE-ANTALYA', name: 'Antalya (MOCK)', address: '' }, { placeId: 'MOCK-PLACE-BELEK', name: 'Belek (MOCK)', address: '' }], sort: 'TOP_PICKS' }));
    await scanner.runUntilIdle();
    expect((await app.hotelLists.list('tp', 'tr', null))!.hotels.map((h) => h.hotelId)).toEqual(['MOCK-H1', 'MOCK-H3', 'MOCK-H2']);
  });

  it('a hotel page shows the price its search form will look for: the board of the link, the linked date', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    hotels.priceAdjustBp = (d) => (d === '2027-05-20' ? -1000n : 0n);
    await publish('ai', 'her-sey-dahil', config({ places: [{ placeId: 'MOCK-PLACE-BELEK', name: 'Belek (MOCK)', address: '' }], boardType: 'AI' }));
    await scanner.runUntilIdle();
    const slug = 'mock-belek-golf-resort-mock-h3';
    // Only an all-inclusive list holds the hotel: no "any board" price on a plain link.
    expect((await app.hotelLists.hotel('tr', slug))!.price).toBeNull();
    const ai = (await app.hotelLists.hotel('tr', slug, { board: 'AI' }))!.price!;
    expect(ai).toMatchObject({ boardType: 'AI', checkin: '2027-05-20' });
    // The linked date wins when it has a price.
    expect((await app.hotelLists.hotel('tr', slug, { board: 'AI', checkin: '2027-05-10' }))!.price).toMatchObject({ checkin: '2027-05-10' });
  });

  it('a hotel keeps its first address when the provider renames it; hotel pages are indexed only in listed languages', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: { currency: 'EUR', nationality: 'GB' } }, maxPriceAgeHours: 26 }, clock.now);
    await repo.upsertList({ cmsId: 'tronly', slugs: { tr: 'antalya' }, titles: { tr: 'Antalya Otelleri' }, config: config(), published: true, cmsUpdatedAt: 'x' }, clock.now);
    await scanner.runUntilIdle();
    const before = (await repo.content('mock', ['MOCK-H1'], 'tr'))[0]!;
    await repo.saveContent({ ...before, slug: 'renamed-hotel-mock-h1', content: { ...(before.content as object), name: 'Renamed' } });
    expect((await repo.content('mock', ['MOCK-H1'], 'tr'))[0]!.slug).toBe(before.slug);
    const map = await app.hotelLists.sitemap();
    expect(map.hotels.length).toBeGreaterThan(0);
    for (const h of map.hotels) expect(Object.keys(h.slugs)).toEqual(['tr']);
    expect(await app.hotelLists.hotel('en', 'mock-lara-beach-resort-mock-h1')).toBeNull(); // no English content fetched
  });
  it('price accuracy: live searches with the list reference are compared with list prices, at no provider cost', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('l1', 'antalya', config());
    await scanner.runUntilIdle();
    const search = (over: Record<string, unknown> = {}) =>
      app.searchHotels({ target: { placeId: 'MOCK-PLACE-ANTALYA' }, checkin: '2027-05-20', checkout: '2027-05-21', rooms: [{ adults: 2, childAges: [] }], nationality: 'TR', currency: 'EUR', locale: 'tr', ...over });
    const checks = () => core.db.execute<{ hotel_id: string; outcome: string; list_minor: string; live_minor: string | null; shown: boolean }>(sql`SELECT hotel_id, outcome, list_minor::text, live_minor::text, shown FROM core.hotel_list_price_checks ORDER BY checked_at, hotel_id`);
    const calls = hotels.calls.searchHotelRates ?? 0;

    // Same criteria, same prices: both hotels match.
    await search();
    expect((await checks()).rows.map((r) => [r.hotel_id, r.outcome, r.shown])).toEqual([['MOCK-H1', 'SAME', true], ['MOCK-H2', 'SAME', true]]);
    expect((hotels.calls.searchHotelRates ?? 0) - calls).toBe(1); // only the visitor's own search

    // Other criteria than the list reference are not compared.
    await search({ checkout: '2027-05-22' });
    await search({ rooms: [{ adults: 3, childAges: [] }] });
    await search({ rooms: [{ adults: 2, childAges: [5] }] });
    await search({ nationality: 'GB' });
    await search({ currency: 'USD' });
    await search({ boardType: 'AI' }); // the list is for any board
    expect((await checks()).rows).toHaveLength(2);

    // The provider raised its prices after the scan: the hotel page search sees it.
    clock.now = new Date('2027-05-01T11:00:00Z');
    hotels.priceAdjustBp = () => 500n;
    await search({ target: { hotelIds: ['MOCK-H1'] } });
    // Sold out: a search for that very hotel finds nothing; a place search says nothing about a missing hotel.
    clock.now = new Date('2027-05-01T12:00:00Z');
    hotels.priceAdjustBp = () => 0n;
    hotels.soldOut.add('MOCK-H2');
    await search({ target: { hotelIds: ['MOCK-H2'] } });
    await search();
    const rows = (await checks()).rows.slice(2);
    expect(rows.map((r) => [r.hotel_id, r.outcome])).toEqual([
      ['MOCK-H1', 'LIVE_HIGHER'],
      ['MOCK-H1', 'SAME'],
      ['MOCK-H2', 'LIVE_MISSING'],
    ]);
    expect(rows[2]!.live_minor).toBeNull();

    // The panel report: per currency, worst cases first (not bookable, then the largest gap), with the hotel name.
    const report = await app.hotelListPriceChecks.report(7);
    expect(report.currencies).toEqual([
      {
        currency: 'EUR',
        shown: expect.objectContaining({ checks: 5, same: 3, liveHigher: 1, liveLower: 0, liveMissing: 1 }),
        all: expect.objectContaining({ checks: 5 }),
      },
    ]);
    expect(report.currencies[0]!.shown.averageGap!.currency).toBe('EUR');
    expect(report.worst.map((w) => [w.hotelId, w.outcome])).toEqual([
      ['MOCK-H2', 'LIVE_MISSING'],
      ['MOCK-H1', 'LIVE_HIGHER'],
    ]);
    expect(report.worst[1]).toMatchObject({ hotelName: 'MOCK Lara Beach Resort', hotelSlug: 'mock-lara-beach-resort-mock-h1', checkin: '2027-05-20', shown: true });
    expect(report.worst[1]!.gapBasisPoints).toBeGreaterThanOrEqual(490);
    expect(report.worst[1]!.gapBasisPoints).toBeLessThanOrEqual(510);

    // The panel alert needs a threshold in the settings (none by default); a ~5% gap is above 4%, below 6%.
    expect(await app.hotelListPriceChecks.alert(24)).toMatchObject({ configured: false, higher: 0, missing: 0 });
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26, priceAlertBasisPoints: 400 }, clock.now);
    expect(await app.hotelListPriceChecks.alert(24)).toEqual({ configured: true, thresholdBasisPoints: 400, hours: 24, higher: 1, missing: 1, hotels: 2 });
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26, priceAlertBasisPoints: 600 }, clock.now);
    expect(await app.hotelListPriceChecks.alert(24)).toMatchObject({ higher: 0, missing: 1, hotels: 1 });
    // Only the last 24 hours count.
    const later = clock.now;
    clock.now = new Date('2027-05-02T13:00:00Z');
    expect(await app.hotelListPriceChecks.alert(24)).toMatchObject({ configured: true, higher: 0, missing: 0 });
    clock.now = later;

    // A failing comparison never fails the visitor's search.
    const spy = vi.spyOn(app.hotelListPriceChecks, 'record').mockRejectedValueOnce(new Error('database busy'));
    await expect(search()).resolves.toMatchObject({ hotels: expect.any(Array) });
    spy.mockRestore();

    // Checks are kept 90 days: 90 days after the 11:00 check, the scanner has dropped the two from 10:00.
    clock.now = new Date('2027-07-30T11:00:00Z');
    await app.hotelListScanner('prune-worker', { sleep: async () => {} }).syncScopes();
    expect((await checks()).rows.map((r) => r.outcome)).toEqual(['LIVE_HIGHER', 'SAME', 'LIVE_MISSING']);
  });
  it('ads page feed: published list pages and the hotel pages they show, per language, with targeting labels', async () => {
    await repo.saveSettings({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26 }, clock.now);
    await publish('l1', 'antalya', config());
    await publish('l2', 'her-sey-dahil', config({ places: [{ placeId: 'MOCK-PLACE-BELEK', name: 'Belek (MOCK)', address: '' }], include: ['MOCK-H1'], boardType: 'AI' }));
    await repo.upsertList({ cmsId: 'l3', slugs: { tr: 'taslak' }, titles: { tr: 'Taslak' }, config: config(), published: false, cmsUpdatedAt: 'x' }, clock.now);
    await scanner.runUntilIdle();
    const pages = await app.hotelLists.adsPages();
    const tr = pages.filter((p) => p.locale === 'tr');
    expect(tr.filter((p) => p.kind === 'LIST')).toEqual([
      { kind: 'LIST', locale: 'tr', slug: 'antalya', labels: ['liste', 'tr', 'liste-antalya', 'fiyatli'] },
      { kind: 'LIST', locale: 'tr', slug: 'her-sey-dahil', labels: ['liste', 'tr', 'liste-her-sey-dahil', 'pansiyon-ai', 'fiyatli'] },
    ]);
    // A hotel on two lists carries both; unpublished lists add nothing.
    expect(tr.find((p) => p.slug === 'mock-lara-beach-resort-mock-h1')).toEqual({
      kind: 'HOTEL',
      locale: 'tr',
      slug: 'mock-lara-beach-resort-mock-h1',
      labels: ['otel', 'tr', 'liste-antalya', 'liste-her-sey-dahil', 'pansiyon-ai', 'fiyatli'],
    });
    expect(tr.filter((p) => p.kind === 'HOTEL').map((p) => p.slug)).toEqual(['mock-belek-golf-resort-mock-h3', 'mock-kaleici-boutique-mock-h2', 'mock-lara-beach-resort-mock-h1']);
    // English: no English price settings, so no scan; a hotel added by code is shown (without a price) once its
    // English content is there, exactly as on the English list page.
    expect(pages.filter((p) => p.locale === 'en' && p.kind === 'HOTEL')).toEqual([
      { kind: 'HOTEL', locale: 'en', slug: 'mock-lara-beach-resort-mock-h1', labels: ['otel', 'en', 'liste-her-sey-dahil', 'pansiyon-ai'] },
    ]);
    const enList = (await app.hotelLists.list('l2', 'en', null))!;
    expect(enList.hotels.map((h) => [h.hotelId, h.price])).toEqual([['MOCK-H1', null]]);
    expect(pages.filter((p) => p.locale === 'en' && p.kind === 'LIST').map((p) => p.labels)).toEqual([
      ['liste', 'en', 'liste-antalya'],
      ['liste', 'en', 'liste-her-sey-dahil', 'pansiyon-ai'],
    ]);
  });
});
