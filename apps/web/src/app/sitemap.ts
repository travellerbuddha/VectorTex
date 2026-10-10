import type { MetadataRoute } from 'next';
import type { Locale } from '../i18n/dictionaries';
import { cms, cmsEnabled } from '../server/cms';
import { sitemapEntries, type SitemapDoc } from '../server/seo';

/** /sitemap.xml from published CMS pages and destinations (visitor rights), read at request time. */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return [];
  const docs: SitemapDoc[] = [];
  if (cmsEnabled()) {
    const payload = await cms();
    for (const collection of ['pages', 'destinations'] as const) {
      for (let page = 1; ; page += 1) {
        const res = await payload.find({ collection, locale: 'all', depth: 0, limit: 500, page, overrideAccess: false, select: { slug: true, seo: true, updatedAt: true } });
        for (const d of res.docs as Array<{ slug?: Partial<Record<Locale, string | null>>; seo?: { noindex?: boolean | null }; updatedAt?: string }>) {
          docs.push({ collection, slugs: d.slug ?? {}, noindex: d.seo?.noindex === true, updatedAt: d.updatedAt ?? null });
        }
        if (!res.hasNextPage) break;
      }
    }
  }
  return sitemapEntries(base, docs);
}
