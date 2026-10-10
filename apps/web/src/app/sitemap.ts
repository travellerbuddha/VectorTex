import type { MetadataRoute } from 'next';
import type { Locale } from '../i18n/dictionaries';
import { booking } from '../server/booking';
import { cms, cmsEnabled } from '../server/cms';
import { sitemapEntries, type SitemapDoc } from '../server/seo';

/**
 * /sitemap.xml from published CMS pages, destinations and hotel lists (visitor rights), plus the hotel pages those
 * lists show (ADR-0014), read at request time.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return [];
  const docs: SitemapDoc[] = [];
  if (cmsEnabled()) {
    const payload = await cms();
    for (const [collection, kind] of [
      ['pages', 'pages'],
      ['destinations', 'destinations'],
      ['hotel-lists', 'hotelLists'],
    ] as const) {
      for (let page = 1; ; page += 1) {
        const res = await payload.find({ collection, locale: 'all', depth: 0, limit: 500, page, overrideAccess: false, select: { slug: true, seo: true, updatedAt: true } });
        for (const d of res.docs as Array<{ slug?: Partial<Record<Locale, string | null>>; seo?: { noindex?: boolean | null }; updatedAt?: string }>) {
          docs.push({ collection: kind, slugs: d.slug ?? {}, noindex: d.seo?.noindex === true, updatedAt: d.updatedAt ?? null });
        }
        if (!res.hasNextPage) break;
      }
    }
  }
  // Hotel pages shown on a published list (content rights pending: HOTEL_PAGES_NOINDEX=true keeps them out).
  if (process.env.HOTEL_PAGES_NOINDEX !== 'true') {
    try {
      const { app } = await booking();
      for (const h of (await app.hotelLists.sitemap()).hotels) docs.push({ collection: 'hotels', slugs: h.slugs, noindex: false, updatedAt: h.updatedAt });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'hotel pages left out of the sitemap', error: err instanceof Error ? err.message : String(err) }));
    }
  }
  return sitemapEntries(base, docs);
}
