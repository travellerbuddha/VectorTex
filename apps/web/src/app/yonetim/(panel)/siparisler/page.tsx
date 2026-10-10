import { ORDER_STATUSES, type OrderStatus } from '@texholiday/admin';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { formatDate, formatMoney } from '../../../../i18n/format';
import { admin, can, requireStaff } from '../../../../server/admin';
import { actorOf, formatAdminInstant } from '../../../../server/admin-forms';

export const dynamic = 'force-dynamic';

const PAGE = 50;

export default async function Orders({ searchParams }: { searchParams: Promise<{ q?: string; durum?: string; dikkat?: string; sayfa?: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!can(staff, 'orders.view')) return <p className="notice">{t.noAccess}</p>;
  const sp = await searchParams;
  const status = (ORDER_STATUSES as readonly string[]).includes(sp.durum ?? '') ? (sp.durum as OrderStatus) : null;
  const page = Math.max(Number(sp.sayfa ?? 1) || 1, 1);
  const rows = await admin().orders.list(actorOf(staff), { q: sp.q ?? null, status, attention: sp.dikkat === '1', limit: PAGE + 1, offset: (page - 1) * PAGE });
  const more = rows.length > PAGE;
  const next = new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(status ? { durum: status } : {}), ...(sp.dikkat === '1' ? { dikkat: '1' } : {}), sayfa: String(page + 1) });
  const bookingTag = (s: string | null) => (s === 'CONFIRMED' || s === 'ISSUED' ? 'ok' : s === 'UNKNOWN' || s === 'FAILED' ? 'bad' : 'warn');
  return (
    <div>
      <h1>{t.orders.title}</h1>
      <form className="card filters" method="get">
        <div className="field grow">
          <label htmlFor="q">{t.orders.search}</label>
          <input id="q" name="q" defaultValue={sp.q ?? ''} placeholder={t.orders.searchHint} />
        </div>
        <div className="field">
          <label htmlFor="durum">{t.orders.status}</label>
          <select id="durum" name="durum" defaultValue={status ?? ''}>
            <option value="">{t.orders.anyStatus}</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.orders.statuses[s]}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" name="dikkat" value="1" defaultChecked={sp.dikkat === '1'} /> {t.orders.attention}
        </label>
        <button type="submit" className="primary">
          {t.orders.filter}
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="card">{t.orders.none}</p>
      ) : (
        <section className="card">
          <div className="table-wrap">
            <table data-testid="orders-table">
              <thead>
                <tr>
                  <th>{t.orders.created}</th>
                  <th>{t.orders.order}</th>
                  <th>{t.orders.product}</th>
                  <th>{t.orders.dates}</th>
                  <th>{t.orders.guest}</th>
                  <th className="num">{t.orders.total}</th>
                  <th>{t.orders.status}</th>
                  <th>{t.orders.booking}</th>
                  <th>{t.orders.payment}</th>
                  <th>{t.orders.tasks}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PAGE).map((r) => (
                  <tr key={r.id}>
                    <td>{formatAdminInstant(r.createdAt, locale)}</td>
                    <td>
                      <a href={`/yonetim/siparisler/${r.id}`}>{r.id.slice(0, 8)}</a>
                    </td>
                    <td>
                      {r.title ?? r.productType ?? '—'} {r.belowSuggestedPrice && <span className="tag warn">{t.orders.belowSsp}</span>}
                    </td>
                    <td>{r.checkin && r.checkout ? `${formatDate(r.checkin, locale)} → ${formatDate(r.checkout, locale)}` : '—'}</td>
                    <td>
                      {r.holderName ?? '—'}
                      <br />
                      <small>{r.customerEmail}</small>
                    </td>
                    <td className="num">{formatMoney(r.total, locale)}</td>
                    <td>
                      <span className={`tag ${r.status === 'CONFIRMED' ? 'ok' : r.status === 'ACTION_REQUIRED' ? 'bad' : r.status === 'CANCELLED' ? '' : 'warn'}`}>{t.orders.statuses[r.status]}</span>
                    </td>
                    <td>
                      {r.bookingStatus ? <span className={`tag ${bookingTag(r.bookingStatus)}`}>{t.orders.bookingStatuses[r.bookingStatus] ?? r.bookingStatus}</span> : '—'}
                      {r.providerBookingRef && (
                        <>
                          <br />
                          <small>{r.providerBookingRef}</small>
                        </>
                      )}
                    </td>
                    <td>{r.paymentStatus ? (t.orders.paymentStatuses[r.paymentStatus] ?? r.paymentStatus) : '—'}</td>
                    <td>{r.openTasks > 0 ? <span className="tag bad">{r.openTasks}</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more && (
            <p>
              <a href={`/yonetim/siparisler?${next.toString()}`}>{t.orders.more} →</a>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
