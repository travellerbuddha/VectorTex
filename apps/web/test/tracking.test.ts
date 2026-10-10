import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { listEcommerce, quoteEcommerce } from '../src/server/analytics';
import { CONSENT_BOOTSTRAP } from '../src/server/tracking';

/** Tracking (ADR-0018): Consent Mode v2 defaults before any tag, stored choice applied, GA4 payloads without PII. */
function boot(cookie: string) {
  // The context is its own window, as in a browser, so `dataLayer` and `window.dataLayer` are the same.
  const ctx: Record<string, unknown> = { document: { cookie } };
  ctx.window = ctx;
  runInNewContext(CONSENT_BOOTSTRAP, ctx);
  return (ctx.dataLayer as unknown[]).map((a) => Array.from(a as ArrayLike<unknown>));
}

describe('consent bootstrap', () => {
  it('denies every Google purpose by default and keeps ad data redacted', () => {
    const calls = boot('');
    expect(calls[0]).toEqual(['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'granted', security_storage: 'granted', wait_for_update: 500 }]);
    expect(calls).toContainEqual(['set', 'ads_data_redaction', true]);
    expect(calls.some((c) => c[1] === 'update')).toBe(false);
  });

  it('applies the stored choice at once: analytics only, or everything', () => {
    const analytics = boot(`x=1; th_consent=${encodeURIComponent(JSON.stringify({ a: true, m: false, v: 1 }))}`);
    expect(analytics.at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    const all = boot(`th_consent=${encodeURIComponent(JSON.stringify({ a: true, m: true, v: 1 }))}`);
    expect(all.at(-1)).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }]);
    // A damaged cookie leaves the defaults (denied).
    expect(boot('th_consent=%7Bbroken').some((c) => c[1] === 'update')).toBe(false);
  });
});

describe('GA4 e-commerce payloads', () => {
  it('hotel quote: value in major units, the hotel as the item, no guest data', () => {
    const q = {
      product: 'HOTEL' as const,
      quoteVersionId: 'q1',
      expiresAt: '2027-05-01T10:00:00Z',
      hotel: { hotelId: 'lp36ea1', name: 'Swandor Topkapı Palace', address: null, photo: null },
      room: { name: 'Deluxe', boardType: 'AI', boardName: 'Her şey dahil' },
      checkin: '2027-06-10',
      checkout: '2027-06-13',
      nights: 3,
      rooms: [{ occupancyNumber: 1, adults: 2, childAges: [] }],
      total: { currency: 'EUR', minor: '29700' },
      payAtProperty: [],
      cancellation: { refundable: true, freeUntil: null, steps: [] },
      termsVersion: 't1',
      paymentProvider: 'NUITEE' as const,
    };
    expect(quoteEcommerce(q)).toEqual({ currency: 'EUR', value: 297, items: [{ item_id: 'lp36ea1', item_name: 'Swandor Topkapı Palace', item_category: 'Hotel', item_variant: 'Her şey dahil', price: 297, quantity: 1 }] });
  });

  it('hotel list: list id, position and the shown price', () => {
    const hotel = (id: string, minor: string | null) => ({
      hotelId: id,
      slug: id,
      name: `Otel ${id}`,
      stars: 5,
      city: null,
      address: null,
      image: null,
      facilities: [],
      rating: null,
      reviewCount: null,
      price: minor ? { amount: { currency: 'EUR', minor }, checkin: '2027-06-10', payAtProperty: null, payAtPropertyOtherCurrency: false, boardType: null, asOf: '', adults: 2, nights: 1, nationality: 'TR' } : null,
    });
    expect(listEcommerce('antalya-otelleri', 'Antalya Otelleri', [hotel('a', '9900'), hotel('b', null)])).toEqual({
      item_list_id: 'antalya-otelleri',
      item_list_name: 'Antalya Otelleri',
      currency: 'EUR',
      items: [
        { item_id: 'a', item_name: 'Otel a', item_category: 'Hotel', item_list_id: 'antalya-otelleri', index: 0, price: 99 },
        { item_id: 'b', item_name: 'Otel b', item_category: 'Hotel', item_list_id: 'antalya-otelleri', index: 1 },
      ],
    });
  });
});
