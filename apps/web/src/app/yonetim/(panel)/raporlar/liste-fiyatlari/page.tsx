import type { PriceAccuracyTotals } from '@texholiday/booking';
import { canSeeReport } from '../../../../../components/admin/AdminNav';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { formatDate, formatMoney } from '../../../../../i18n/format';
import { requireStaff } from '../../../../../server/admin';
import { formatAdminInstant } from '../../../../../server/admin-forms';
import { booking } from '../../../../../server/booking';
import { HOTEL_DIR } from '../../../../../server/seo';

export const dynamic = 'force-dynamic';

const PERIODS = [7, 30, 90] as const;
const percent = (locale: 'tr' | 'en', signed = false) =>
  new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, ...(signed ? { signDisplay: 'always' as const } : {}) });

/** List price accuracy (ADR-0014): live searches with the list reference compared with the stored list prices. */
export default async function ListPriceAccuracy({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!canSeeReport(staff, 'listPrices')) return <p className="notice">{t.noAccess}</p>;
  const r = t.reports.listPrices;
  const pct = (part: number, whole: number) => (whole > 0 ? percent(locale).format(part / whole) : '—');
  const asked = Number((await searchParams).gun);
  const days = (PERIODS as readonly number[]).includes(asked) ? asked : 7;
  const { app } = await booking();
  const [report, alert] = await Promise.all([app.hotelListPriceChecks.report(days), app.hotelListPriceChecks.alert(24)]);
  const threshold = alert.thresholdBasisPoints === null ? '' : percent(locale).format(alert.thresholdBasisPoints / 10_000);

  const row = (label: string, x: PriceAccuracyTotals) => (
    <tr>
      <th scope="row">{label}</th>
      <td className="num">{x.checks}</td>
      <td className="num">
        {x.same} <small>({pct(x.same, x.checks)})</small>
      </td>
      <td className="num">{x.liveHigher > 0 ? <span className="tag bad">{x.liveHigher}</span> : 0}</td>
      <td className="num">{x.liveLower}</td>
      <td className="num">{x.liveMissing > 0 ? <span className="tag warn">{x.liveMissing}</span> : 0}</td>
      <td className="num">{x.averageGap ? formatMoney(x.averageGap, locale) : '—'}</td>
    </tr>
  );

  return (
    <div>
      <h1>{r.title}</h1>
      <p className="muted">{r.intro}</p>
      <nav className="tabs" aria-label={r.period}>
        {PERIODS.map((d) => (
          <a key={d} href={`/yonetim/raporlar/liste-fiyatlari?gun=${d}`} aria-current={d === days ? 'page' : undefined}>
            {r.days(d)}
          </a>
        ))}
      </nav>
      <p className="muted">
        {r.environment}: <strong>{report.environment}</strong>
      </p>
      <p className={alert.configured && alert.higher + alert.missing > 0 ? 'notice' : 'muted'} data-testid="price-alert-status">
        {alert.configured ? r.alertOn(threshold, alert.higher, alert.missing) : r.alertOff}
      </p>
      {report.currencies.length === 0 ? (
        <p className="card">{r.none}</p>
      ) : (
        report.currencies.map((c) => (
          <section className="card" key={c.currency}>
            <h2>{c.currency}</h2>
            <div className="table-wrap">
              <table data-testid={`accuracy-${c.currency}`}>
                <thead>
                  <tr>
                    <th />
                    <th className="num">{r.checks}</th>
                    <th className="num">{r.same}</th>
                    <th className="num">{r.liveHigher}</th>
                    <th className="num">{r.liveLower}</th>
                    <th className="num">{r.liveMissing}</th>
                    <th className="num">{r.averageGap}</th>
                  </tr>
                </thead>
                <tbody>
                  {row(r.shown, c.shown)}
                  {row(r.all, c.all)}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
      <section className="card">
        <h2>{r.worstTitle}</h2>
        <p className="muted">{r.worstIntro}</p>
        {report.worst.length === 0 ? (
          <p>{r.worstNone}</p>
        ) : (
          <div className="table-wrap">
            <table data-testid="accuracy-worst">
              <thead>
                <tr>
                  <th>{r.hotel}</th>
                  <th>{r.checkin}</th>
                  <th className="num">{r.list}</th>
                  <th className="num">{r.live}</th>
                  <th className="num">{r.gap}</th>
                  <th>{r.onPage}</th>
                  <th>{r.listAsOf}</th>
                  <th>{r.checkedAt}</th>
                </tr>
              </thead>
              <tbody>
                {report.worst.map((w) => (
                  <tr key={`${w.hotelId}-${w.checkin}-${w.checkedAt}`}>
                    <td>
                      {w.hotelSlug ? (
                        <a href={`/tr/${HOTEL_DIR.tr}/${w.hotelSlug}`} target="_blank" rel="noreferrer">
                          {w.hotelName ?? w.hotelId}
                        </a>
                      ) : (
                        (w.hotelName ?? w.hotelId)
                      )}
                      <br />
                      <small>{w.hotelId}</small>
                    </td>
                    <td>{formatDate(w.checkin, locale)}</td>
                    <td className="num">{formatMoney(w.list, locale)}</td>
                    <td className="num">{w.live ? formatMoney(w.live, locale) : <span className="tag warn">{r.notBookable}</span>}</td>
                    <td className="num">{w.gapBasisPoints === null ? '—' : <span className="tag bad">{percent(locale, true).format(w.gapBasisPoints / 10_000)}</span>}</td>
                    <td>{w.shown ? r.yes : r.no}</td>
                    <td>{formatAdminInstant(w.listAsOf, locale)}</td>
                    <td>{formatAdminInstant(w.checkedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
