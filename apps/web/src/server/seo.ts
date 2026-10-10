import type { MetadataRoute } from 'next';
import { LOCALES, type Locale } from '../i18n/dictionaries';

/**
 * Sitemap and robots rules (P17: "URL, metadata, canonical, hreflang ve sitemap korunur"). Pure functions; the routes in
 * app/sitemap.ts and app/robots.ts feed them with published CMS documents and the environment.
 */
export interface SitemapDoc {
  collection: 'pages' | 'destinations';
  /** Address per language; a language without one has no page. */
  slugs: Partial<Record<Locale, string | null>>;
  noindex: boolean;
  updatedAt: string | null;
}

const PATHS: Record<SitemapDoc['collection'], (l: Locale, slug: string) => string> = {
  pages: (l, s) => `/${l}/${s}`,
  destinations: (l, s) => `/${l}/destinations/${s}`,
};

/** Fixed pages of the site that are meant to be found (search and booking pages are not). */
const FIXED: ReadonlyArray<(l: Locale) => string> = [(l) => `/${l}`, (l) => `/${l}/terms`];

/** One entry per page and language, each listing every language version (hreflang). */
export function sitemapEntries(base: string, docs: readonly SitemapDoc[]): MetadataRoute.Sitemap {
  const origin = base.replace(/\/$/, '');
  const out: MetadataRoute.Sitemap = [];
  for (const path of FIXED) {
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
  const privatePaths = LOCALES.flatMap((l) => [`/${l}/checkout/`, `/${l}/orders/`, `/${l}/hotels/`]);
  return { rules: { userAgent: '*', allow: '/', disallow: ['/yonetim', '/api/', ...privatePaths] }, sitemap: `${origin}/sitemap.xml` };
}
