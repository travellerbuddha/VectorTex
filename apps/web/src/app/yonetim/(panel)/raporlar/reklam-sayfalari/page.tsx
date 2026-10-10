import { canSeeReport } from '../../../../../components/admin/AdminNav';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { requireStaff } from '../../../../../server/admin';
import { booking } from '../../../../../server/booking';

export const dynamic = 'force-dynamic';

/** Google Ads page feed of the list and hotel pages (ADR-0014): what it holds, and the download. */
export default async function AdsPageFeed() {
  const staff = await requireStaff();
  const t = adminDict(await adminLocale());
  if (!canSeeReport(staff, 'adsFeed')) return <p className="notice">{t.noAccess}</p>;
  const r = t.reports.adsFeed;
  const { app } = await booking();
  const pages = await app.hotelLists.adsPages();
  const lists = pages.filter((p) => p.kind === 'LIST').length;
  const hotels = pages.length - lists;
  const base = process.env.PUBLIC_BASE_URL?.trim();
  return (
    <div>
      <h1>{r.title}</h1>
      <p className="muted">{r.intro}</p>
      <section className="card">
        <p data-testid="feed-count">{r.count(lists, hotels)}</p>
        {!base ? (
          <p className="notice">{r.noSite}</p>
        ) : lists === 0 ? (
          <p>{r.empty}</p>
        ) : (
          <p>
            <a className="button primary" href="/api/v1/staff/ads-page-feed" download>
              {r.download}
            </a>
          </p>
        )}
        <p className="muted">{r.columns}</p>
      </section>
      <section className="card">
        <h2>{r.labelsTitle}</h2>
        <ul>
          {r.labels.map((l) => (
            <li key={l}>
              <code>{l.split(' — ')[0]}</code> — {l.split(' — ').slice(1).join(' — ')}
            </li>
          ))}
        </ul>
        <h2>{r.howTitle}</h2>
        <ol>
          {r.how.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
