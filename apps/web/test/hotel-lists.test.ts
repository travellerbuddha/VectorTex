import { describe, expect, it } from 'vitest';
import { hotelListConfigSchema, hotelListSettingsSchema } from '@texholiday/booking';
import { mirrorOf, settingsMirrorOf } from '../src/payload/collections/hotel-lists';
import { legacySearchLocation } from '../src/server/redirects';
import { robotsRules, sitemapEntries } from '../src/server/seo';
import { breadcrumbList, hotelItemList, hotelPage, jsonLd, type MarkupHotel } from '../src/server/structured-data';

const hotel = (n: number, over: Partial<MarkupHotel> = {}): MarkupHotel => ({
  name: `Otel ${n}`,
  url: `/tr/otel/otel-${n}-lp${n}`,
  images: [`https://static.example/${n}.jpg`],
  address: 'Lara Cd. 1',
  city: 'Antalya',
  country: 'tr',
  stars: 5,
  facilities: ['Havuz', 'Spa'],
  fromPrice: '€120,00',
  ...over,
});

describe('hotel list structured data (ADR-0014)', () => {
  it('an ItemList at the top level with a Hotel per item on its own page, no rating, short priceRange', () => {
    const list = hotelItemList({ name: 'Antalya Otelleri', url: '/tr/oteller/antalya', origin: 'https://www.example.com', hotels: [hotel(1), hotel(2), hotel(3)] })!;
    expect(list).toMatchObject({ '@context': 'https://schema.org', '@type': 'ItemList', url: 'https://www.example.com/tr/oteller/antalya', numberOfItems: 3 });
    const items = list.itemListElement as Array<{ position: number; item: Record<string, unknown> }>;
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[0]!.item).toMatchObject({
      '@type': 'Hotel',
      name: 'Otel 1',
      url: 'https://www.example.com/tr/otel/otel-1-lp1',
      image: ['https://static.example/1.jpg'],
      address: { '@type': 'PostalAddress', addressLocality: 'Antalya', addressCountry: 'TR' },
      starRating: { '@type': 'Rating', ratingValue: 5 },
      priceRange: '€120,00+',
      amenityFeature: [{ '@type': 'LocationFeatureSpecification', name: 'Havuz', value: true }, expect.anything()],
    });
    expect(JSON.stringify(list)).not.toMatch(/aggregateRating|ratingCount|reviewCount/);
    expect(new Set(items.map((i) => i.item.url)).size).toBe(3);
  });

  it('hotels without an image or with a long price text are not marked up wrongly; fewer than three = no list', () => {
    const list = hotelItemList({ name: 'x', url: '/tr/oteller/x', origin: 'https://www.example.com', hotels: [hotel(1, { fromPrice: '₺123.456,00' }), hotel(2), hotel(3), hotel(4, { images: [] })] })!;
    const items = list.itemListElement as Array<{ item: Record<string, unknown> }>;
    expect(items).toHaveLength(3);
    expect(items[0]!.item).not.toHaveProperty('priceRange');
    expect(hotelItemList({ name: 'x', url: '/x', origin: 'https://www.example.com', hotels: [hotel(1), hotel(2)] })).toBeNull();
    expect(hotelItemList({ name: 'x', url: '/x', origin: 'https://www.example.com', hotels: [hotel(1, { images: ['http://insecure/x.jpg'] }), hotel(2), hotel(3)] })).toBeNull();
  });

  it('hotel page markup: geo, times as schema times, description cut; JSON cannot close the script tag', () => {
    const page = hotelPage({ ...hotel(1), description: 'a'.repeat(900), location: { latitude: 36.8, longitude: 30.7 }, checkinTime: '14:00', checkoutTime: 'noon' }, 'https://www.example.com')!;
    expect(page).toMatchObject({ '@type': 'Hotel', geo: { '@type': 'GeoCoordinates', latitude: 36.8 }, checkinTime: '14:00:00' });
    expect(page).not.toHaveProperty('checkoutTime');
    expect(String(page.description)).toHaveLength(500);
    expect(jsonLd({ name: '</script><script>alert(1)</script>' })).not.toContain('</script>');
    expect(breadcrumbList('https://www.example.com', [{ name: 'Ana sayfa', path: '/tr' }]).itemListElement).toEqual([{ '@type': 'ListItem', position: 1, name: 'Ana sayfa', item: 'https://www.example.com/tr' }]);
  });
});

describe('addresses, robots and sitemap (ADR-0014)', () => {
  it('old search result addresses move to /search/hotels; list addresses are left alone', () => {
    expect(legacySearchLocation('/tr/hotels/123e4567-e89b-12d3-a456-426614174000', '?place=x')).toBe('/tr/search/hotels/123e4567-e89b-12d3-a456-426614174000?place=x');
    expect(legacySearchLocation('/en/hotels/antalya', '')).toBeNull();
    expect(legacySearchLocation('/tr/oteller/antalya', '')).toBeNull();
  });

  it('robots keep search results private and lists public; the sitemap lists hubs, lists and hotels per language', () => {
    const rules = robotsRules('production', 'https://www.example.com').rules as { disallow: string[] };
    expect(rules.disallow).toEqual(expect.arrayContaining(['/tr/search/', '/en/search/']));
    expect(rules.disallow.some((d) => d.includes('hotels') || d.includes('oteller'))).toBe(false);
    const map = sitemapEntries('https://www.example.com', [
      { collection: 'hotelLists', slugs: { tr: 'antalya', en: 'antalya' }, noindex: false, updatedAt: null },
      { collection: 'hotels', slugs: { tr: 'akra-lp1', en: 'akra-lp1' }, noindex: false, updatedAt: null },
    ]);
    const urls = map.map((e) => e.url);
    expect(urls).toEqual(expect.arrayContaining(['https://www.example.com/tr/oteller', 'https://www.example.com/en/hotels', 'https://www.example.com/tr/oteller/antalya', 'https://www.example.com/en/hotels/antalya', 'https://www.example.com/tr/otel/akra-lp1', 'https://www.example.com/en/hotel/akra-lp1']));
    expect(map.find((e) => e.url.endsWith('/tr/oteller/antalya'))!.alternates?.languages).toEqual({ tr: 'https://www.example.com/tr/oteller/antalya', en: 'https://www.example.com/en/hotels/antalya' });
  });
});

describe('CMS to core copy of a list (ADR-0014)', () => {
  it('the published document becomes a valid list config; "any board" is no filter; nothing is defaulted in the settings', () => {
    const m = mirrorOf({
      id: 7,
      _status: 'published',
      updatedAt: '2027-05-01T09:00:00.000Z',
      title: { tr: 'Antalya Otelleri', en: null },
      slug: { tr: 'antalya', en: '' },
      places: [{ placeId: 'ChIJwa2t3a6awxQRMy7j-XOfxpU', name: 'Antalya', address: 'Türkiye' }],
      include: ['lp1897'],
      stars: ['4', '5'],
      boardType: 'ANY',
      sort: 'PRICE',
      maxItems: 20,
    });
    expect(m).toMatchObject({ cmsId: '7', slugs: { tr: 'antalya' }, titles: { tr: 'Antalya Otelleri' }, published: true, cmsUpdatedAt: '2027-05-01T09:00:00.000Z' });
    expect(hotelListConfigSchema.parse(m.config)).toMatchObject({ stars: [4, 5], boardType: null, sort: 'PRICE', maxItems: 20, exclude: [], pinned: [] });
    expect(hotelListConfigSchema.safeParse(mirrorOf({ id: 8, places: [], include: [] }).config).success).toBe(false);
    expect(hotelListSettingsSchema.safeParse(settingsMirrorOf({ trCurrency: 'EUR', trNationality: 'TR' })).success).toBe(false); // no max age
    expect(hotelListSettingsSchema.parse(settingsMirrorOf({ trCurrency: 'EUR', trNationality: 'TR', maxPriceAgeHours: 26 }))).toEqual({ locales: { tr: { currency: 'EUR', nationality: 'TR' }, en: null }, maxPriceAgeHours: 26, priceAlertBasisPoints: null });
    // The price alert threshold: percent in the CMS, basis points in core; empty = no alert.
    expect(settingsMirrorOf({ maxPriceAgeHours: 26, priceAlertPercent: 2.5 }).priceAlertBasisPoints).toBe(250);
    expect(settingsMirrorOf({ maxPriceAgeHours: 26, priceAlertPercent: 0.1 }).priceAlertBasisPoints).toBe(10);
    expect(settingsMirrorOf({ maxPriceAgeHours: 26, priceAlertPercent: null }).priceAlertBasisPoints).toBeNull();
  });
});
