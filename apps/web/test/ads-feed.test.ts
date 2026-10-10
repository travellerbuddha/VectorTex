import { describe, expect, it } from 'vitest';
import { adsPageFeedCsv, type AdsPage } from '../src/server/ads-feed';

/** Google Ads page feed CSV (ADR-0014): the template's two columns, absolute addresses, ";"-separated labels. */
describe('ads page feed', () => {
  const pages: AdsPage[] = [
    { kind: 'LIST', locale: 'tr', slug: 'antalya-otelleri', labels: ['liste', 'tr', 'liste-antalya-otelleri', 'fiyatli'] },
    { kind: 'HOTEL', locale: 'tr', slug: 'akra-antalya-lp1897', labels: ['otel', 'tr', 'liste-antalya-otelleri', 'fiyatli'] },
    { kind: 'LIST', locale: 'en', slug: 'antalya-hotels', labels: ['liste', 'en', 'liste-antalya-hotels'] },
    { kind: 'HOTEL', locale: 'en', slug: 'akra-antalya-lp1897', labels: ['otel', 'en', 'liste-antalya-hotels'] },
    // The same page twice (two read paths) is written once.
    { kind: 'HOTEL', locale: 'tr', slug: 'akra-antalya-lp1897', labels: ['otel', 'tr'] },
  ];

  it('writes one row per page and language under the Google Ads header, with absolute addresses', () => {
    const csv = adsPageFeedCsv('https://www.texholiday.com/', pages, () => false);
    expect(csv.split('\r\n')).toEqual([
      'Page URL,Custom label',
      'https://www.texholiday.com/tr/oteller/antalya-otelleri,liste;tr;liste-antalya-otelleri;fiyatli',
      'https://www.texholiday.com/tr/otel/akra-antalya-lp1897,otel;tr;liste-antalya-otelleri;fiyatli',
      'https://www.texholiday.com/en/hotels/antalya-hotels,liste;en;liste-antalya-hotels',
      'https://www.texholiday.com/en/hotel/akra-antalya-lp1897,otel;en;liste-antalya-hotels',
      '',
    ]);
  });

  it('labels pages kept out of search engines; quotes cells and never starts one with a formula sign', () => {
    const csv = adsPageFeedCsv('https://x.test', [...pages.slice(0, 2), { kind: 'LIST', locale: 'tr', slug: 'a', labels: ['=HYPERLINK("x")', 'b,c'] }], (p) => p.kind === 'HOTEL');
    const lines = csv.trim().split('\r\n');
    expect(lines[2]).toBe('https://x.test/tr/otel/akra-antalya-lp1897,otel;tr;liste-antalya-otelleri;fiyatli;noindex');
    expect(lines[3]).toBe(`https://x.test/tr/oteller/a,"'=HYPERLINK(""x"");b,c"`);
  });
});
