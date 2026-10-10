import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  await core.db.execute(sql`TRUNCATE core.hotel_lists, core.hotel_list_settings, core.hotel_list_scopes, core.hotel_content, core.rate_slots CASCADE`);
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
});
