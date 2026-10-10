import { DomainError } from '@texholiday/contracts';
import { canSeeReport } from '../../../../../components/admin/AdminNav';
import { LOCALES, type Locale } from '../../../../../i18n/dictionaries';
import { adsPageFeedCsv, type AdsPage } from '../../../../../server/ads-feed';
import { currentSession } from '../../../../../server/admin';
import { booking } from '../../../../../server/booking';
import { cms, cmsEnabled } from '../../../../../server/cms';
import { errorResponse } from '../../../../../server/http';

export const dynamic = 'force-dynamic';

/** Lists marked noindex in the CMS, as "locale:slug" (published documents only). */
async function noindexLists(): Promise<Set<string>> {
  const out = new Set<string>();
  if (!cmsEnabled()) return out;
  const payload = await cms();
  for (let page = 1; ; page += 1) {
    const res = await payload.find({ collection: 'hotel-lists', locale: 'all', depth: 0, limit: 500, page, overrideAccess: false, select: { slug: true, seo: true } });
    for (const d of res.docs as Array<{ slug?: Partial<Record<Locale, string | null>>; seo?: { noindex?: boolean | null } }>) {
      if (d.seo?.noindex !== true) continue;
      for (const l of LOCALES) if (d.slug?.[l]) out.add(`${l}:${d.slug[l]}`);
    }
    if (!res.hasNextPage) break;
  }
  return out;
}

/** Google Ads page feed CSV of the list and hotel pages (ADR-0014). Content staff only. */
export async function GET() {
  try {
    const s = await currentSession();
    if (!s || s.stage !== 'ACTIVE' || !canSeeReport(s.staff, 'adsFeed')) throw new DomainError('FORBIDDEN', 'Forbidden', { httpStatus: 403 });
    const base = process.env.PUBLIC_BASE_URL?.trim();
    if (!base) throw new DomainError('CAPABILITY_NOT_AVAILABLE', 'PUBLIC_BASE_URL is not set', { httpStatus: 409 });
    const { app } = await booking();
    const [pages, hidden] = await Promise.all([app.hotelLists.adsPages(), noindexLists()]);
    const hotelsNoindex = process.env.HOTEL_PAGES_NOINDEX === 'true';
    const csv = adsPageFeedCsv(base, pages as AdsPage[], (p) => (p.kind === 'HOTEL' ? hotelsNoindex : hidden.has(`${p.locale}:${p.slug}`)));
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="texholiday-sayfa-feed-${day}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
