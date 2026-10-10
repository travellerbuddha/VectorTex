import type { MetadataRoute } from 'next';
import { LOCALES, type Locale } from '../i18n/dictionaries';
import { COOKIE_POLICY_DIR } from '../components/tracking/cookie-registry';

/**
 * Sitemap and robots rules (P17: "URL, metadata, canonical, hreflang ve sitemap korunur"). Pure functions; the routes in
 * app/sitemap.ts and app/robots.ts feed them with published CMS documents and the environment.
 */
export interface SitemapDoc {
  collection: 'pages' | 'destinations' | 'hotelLists' | 'hotels' | 'posts';
  /** Address per language; a language without one has no page. */
  slugs: Partial<Record<Locale, string | null>>;
  noindex: boolean;
  updatedAt: string | null;
}

/** Hotel list and hotel page directories per language (ADR-0014). */
export const HOTEL_LIST_DIR: Record<Locale, string> = { tr: 'oteller', en: 'hotels' };
export const HOTEL_DIR: Record<Locale, string> = { tr: 'otel', en: 'hotel' };
/** Guide articles and the FAQ page per language (P06). */
export const GUIDE_DIR: Record<Locale, string> = { tr: 'rehber', en: 'guides' };
export const FAQ_DIR: Record<Locale, string> = { tr: 'sss', en: 'faq' };
/** The customer's bookings (ADR-0017): private, never indexed. */
export const ACCOUNT_DIR: Record<Locale, string> = { tr: 'hesabim', en: 'account' };

export const PATHS: Record<SitemapDoc['collection'], (l: Locale, slug: string) => string> = {
  pages: (l, s) => `/${l}/${s}`,
  destinations: (l, s) => `/${l}/destinations/${s}`,
  hotelLists: (l, s) => `/${l}/${HOTEL_LIST_DIR[l]}/${s}`,
  hotels: (l, s) => `/${l}/${HOTEL_DIR[l]}/${s}`,
  posts: (l, s) => `/${l}/${GUIDE_DIR[l]}/${s}`,
};

/** Fixed pages of the site that are meant to be found (search and booking pages are not). */
const FIXED: ReadonlyArray<(l: Locale) => string> = [(l) => `/${l}`, (l) => `/${l}/terms`, (l) => `/${l}/${HOTEL_LIST_DIR[l]}`, (l) => `/${l}/${COOKIE_POLICY_DIR[l]}`];

/** One entry per page and language, each listing every language version (hreflang). The guide and FAQ hubs are listed
 * only while they have published content (an empty page is not worth crawling). */
export function sitemapEntries(base: string, docs: readonly SitemapDoc[], sections: { guides?: boolean; faq?: boolean } = {}): MetadataRoute.Sitemap {
  const origin = base.replace(/\/$/, '');
  const out: MetadataRoute.Sitemap = [];
  const fixed = [...FIXED, ...(sections.guides ? [(l: Locale) => `/${l}/${GUIDE_DIR[l]}`] : []), ...(sections.faq ? [(l: Locale) => `/${l}/${FAQ_DIR[l]}`] : [])];
  for (const path of fixed) {
    const languages = Object.fromEntries(LOCALES.map((l) => [l, `${origin}${path(l)}`]));
    for (const l of LOCALES) out.push({ url: `${origin}${path(l)}`, alternates: { languages } });
  }
  for (const d of docs) {
    if (d.noindex) continue;
    const present = LOCALES.filter((l) => typeof d.slugs[l] === 'string' && d.slugs[l] !== '');
    const languages = Object.fromEntries(present.map((l) => [l, `${origin}${PATHS[d.collection](l, d.slugs[l]!)}`]));
    const lastModified = d.updatedAt && !Number.isNaN(Date.parse(d.updatedAt)) ? new Date(d.updatedAt) : undefined;
    for (const l of present) out.push({ url: languages[l]!, ...(lastModified ? { lastModified } : {}), alternates: { languages } });
  }
  return out;
}

/** Only production is indexed; every other environment (staging, previews) asks crawlers to stay out. */
export function robotsRules(appEnv: string | undefined, base: string | undefined): MetadataRoute.Robots {
  if (appEnv !== 'production' || !base) return { rules: { userAgent: '*', disallow: '/' } };
  const origin = base.replace(/\/$/, '');
  // Search results live under /{l}/search/ (ADR-0014); /en/hotels/ holds the public hotel lists.
  const privatePaths = LOCALES.flatMap((l) => [`/${l}/checkout/`, `/${l}/orders/`, `/${l}/search/`, `/${l}/${ACCOUNT_DIR[l]}`]);
  return { rules: { userAgent: '*', allow: '/', disallow: ['/yonetim', '/api/', ...privatePaths] }, sitemap: `${origin}/sitemap.xml` };
}
