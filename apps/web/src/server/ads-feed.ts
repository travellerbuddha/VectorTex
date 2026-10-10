import type { Locale } from '../i18n/dictionaries';
import { PATHS } from './seo';

/**
 * Google Ads page feed (ADR-0014): the published list pages and the hotel pages they show, as the CSV Google Ads takes
 * for a page feed: columns "Page URL" and "Custom label", several labels separated by ";". Pure; the staff route
 * feeds it with the read model and the site address.
 */
export interface AdsPage {
  kind: 'LIST' | 'HOTEL';
  locale: Locale;
  slug: string;
  labels: readonly string[];
}

/** RFC 4180 quoting, and no cell a spreadsheet would run as a formula. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * `noindex`: pages kept out of search engines (a list marked noindex in the CMS, or every hotel page while
 * HOTEL_PAGES_NOINDEX is on) get the label "noindex" — Dynamic Search Ads only serve pages Google has indexed.
 */
export function adsPageFeedCsv(base: string, pages: readonly AdsPage[], noindex: (p: AdsPage) => boolean): string {
  const origin = base.replace(/\/$/, '');
  const lines = ['Page URL,Custom label'];
  const seen = new Set<string>();
  for (const p of pages) {
    const url = `${origin}${PATHS[p.kind === 'LIST' ? 'hotelLists' : 'hotels'](p.locale, p.slug)}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const labels = [...p.labels, ...(noindex(p) ? ['noindex'] : [])];
    lines.push(`${cell(url)},${cell(labels.join(';'))}`);
  }
  return `${lines.join('\r\n')}\r\n`;
}
