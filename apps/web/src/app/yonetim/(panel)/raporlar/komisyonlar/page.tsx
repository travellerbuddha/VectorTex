import type { CommissionRow, CommissionView } from '@texholiday/db';
import { ActionForm } from '../../../../../components/admin/ActionForm';
import { canSeeReport } from '../../../../../components/admin/AdminNav';
import { CommissionSelection } from '../../../../../components/admin/CommissionSelection';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { formatDate, formatMoney } from '../../../../../i18n/format';
import { admin, can, requireStaff } from '../../../../../server/admin';
import { actorOf } from '../../../../../server/admin-forms';
import { booking } from '../../../../../server/booking';
import { istanbulToday } from '../../../../../server/finance-period';
import { recordPayoutAction } from './actions';

export const dynamic = 'force-dynamic';

const TABS: readonly CommissionView[] = ['UNPAID', 'REFUND_DUE', 'RECEIVED', 'VOIDED'];

/**
 * Commission collection (ADR-0019): commissions waiting for the provider's payout (Nuitee pays when it collects the
 * payment, often before the stay), recording a payout with its statement reference and the refunds it deducts,
 * commissions owed back after a cancellation, and the payouts recorded so far. Viewing: orders.view_financials;
 * recording: commissions.record_payout (both checked again by the booking application).
 */
export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ durum?: string; kayit?: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!canSeeReport(staff, 'commissions')) return <p className="notice">{t.noAccess}</p>;
  const c = t.reports.commissions;
  const sp = await searchParams;
  const tab = TABS.find((s) => s === sp.durum) ?? 'UNPAID';
  const { app, settings } = await booking();
  const view = await app.commissions.overview(actorOf(staff), { view: tab, limit: 500 });
  const mayRecord = tab === 'UNPAID' && can(staff, 'commissions.record_payout');
  // The payout form also offers the refunds Nuitee may deduct from the payout.
  const refundDue = mayRecord ? (await app.commissions.overview(actorOf(staff), { view: 'REFUND_DUE', limit: 500 })).rows : [];
  const accounts = await admin().auth.accounts();
  const names = new Map(accounts.map((a) => [a.id, a.displayName]));
  const who = (actor: string) => names.get(actor.startsWith('staff:') ? actor.slice(6) : actor) ?? actor;
  const bucket = (k: string) => c.buckets[k] ?? k;
  const stay = (a: string | null, b: string | null) => (a && b ? `${formatDate(a, locale)} → ${formatDate(b, locale)}` : '—');
  const saved = sp.kayit ? view.payouts.find((p) => p.id === sp.kayit) : undefined;
  const selectable = [...view.rows, ...refundDue];
  const providers = [...new Set(selectable.map((r) => r.providerId))];
  const currencies = [...new Set(selectable.map((r) => r.amount.currency))];
  const forSelection = (r: CommissionRow) => ({
    id: r.id,
    orderId: r.orderId,
    title: r.title ?? r.productType,
    stay: stay(r.serviceStart, r.serviceEnd),
    bookingRef: r.providerBookingRef ?? '—',
    stage: bucket(r.bucket),
    payoutRef: r.payoutReference ?? undefined,
    amount: r.amount,
  });

  return (
    <div>
      <h1>{c.title}</h1>
      <p className="muted">{c.intro}</p>
      <p className="muted">
        {c.environment}: <strong>{settings.environment}</strong>
      </p>
      {saved && (
        <p className="ok-box" role="status">
          {c.saved(
            saved.count,
            formatMoney(saved.commissions, locale),
            saved.clawbacks.minor === '0' ? null : formatMoney(saved.clawbacks, locale),
            saved.difference.minor === '0' ? null : formatMoney(saved.difference, locale),
          )}
        </p>
      )}

      <section className="card">
        <h2>{c.totalsTitle}</h2>
        {view.totals.length === 0 ? (
          <p className="muted">{c.none}</p>
        ) : (
          <div className="table-wrap">
            <table data-testid="commission-totals">
              <thead>
                <tr>
                  <th>{c.status}</th>
                  <th>{c.currency}</th>
                  <th className="num">{c.count}</th>
                  <th className="num">{c.amount}</th>
                </tr>
              </thead>
              <tbody>
                {view.totals.map((r) => (
                  <tr key={`${r.bucket}-${r.currency}`}>
                    <td>{bucket(r.bucket)}</td>
                    <td>{r.currency}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{formatMoney(r.amount, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <nav className="tabs" aria-label={c.title}>
        {TABS.map((s) => (
          <a key={s} href={`/yonetim/raporlar/komisyonlar?durum=${s}`} aria-current={s === tab ? 'page' : undefined}>
            {c.tabs[s]}
          </a>
        ))}
      </nav>

      <section className="card">
        <h2>{c.tabs[tab]}</h2>
        {mayRecord && selectable.length > 0 ? (
          <ActionForm action={recordPayoutAction} submit={c.submit} confirmText={c.confirm} className="stack">
            <CommissionSelection
              settle={view.rows.map(forSelection)}
              netted={refundDue.map(forSelection)}
              locale={locale}
              labels={{
                select: c.select,
                selectAll: c.selectAll,
                order: c.order,
                stay: c.stay,
                bookingRef: c.bookingRef,
                status: c.status,
                payoutRef: c.payoutRef,
                commission: c.commission,
                settleTitle: c.settleTitle,
                nettedTitle: c.nettedTitle,
                none: c.selectedNone,
                selected: c.selected('{n}', '{total}', '{m}', '{netted}', '{expected}'),
              }}
            />
            <h3>{c.payoutTitle}</h3>
            <p className="muted">{c.payoutHint}</p>
            <div className="row3">
              <div className="field">
                <label htmlFor="payout-provider">{c.provider}</label>
                <select id="payout-provider" name="provider" defaultValue={providers[0]}>
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="payout-reference">{c.reference}</label>
                <input id="payout-reference" name="reference" required maxLength={100} autoComplete="off" aria-describedby="payout-reference-hint" />
                <small id="payout-reference-hint" className="muted">
                  {c.referenceHint}
                </small>
              </div>
              <div className="field">
                <label htmlFor="payout-received-on">{c.receivedOn}</label>
                <input id="payout-received-on" name="receivedOn" type="date" required max={istanbulToday(new Date())} />
              </div>
            </div>
            <div className="row3">
              <div className="field">
                <label htmlFor="payout-currency">{c.currency}</label>
                <select id="payout-currency" name="currency" defaultValue={currencies[0]}>
                  {currencies.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="payout-amount">{c.received(currencies[0] ?? '')}</label>
                <input id="payout-amount" name="amount" inputMode="decimal" required autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="payout-note">{c.note}</label>
                <input id="payout-note" name="note" maxLength={500} autoComplete="off" />
              </div>
            </div>
          </ActionForm>
        ) : view.rows.length === 0 ? (
          <p className="muted">{c.none}</p>
        ) : (
          <>
            {tab === 'UNPAID' && <p className="muted">{c.noPermission}</p>}
            <div className="table-wrap">
              <table data-testid="commission-rows">
                <thead>
                  <tr>
                    <th>{c.order}</th>
                    <th>{c.stay}</th>
                    <th>{c.bookingRef}</th>
                    {(tab === 'UNPAID' || tab === 'RECEIVED') && <th>{c.status}</th>}
                    {(tab === 'RECEIVED' || tab === 'REFUND_DUE') && <th>{c.payoutRef}</th>}
                    {tab === 'VOIDED' && <th>{c.clawbackRef}</th>}
                    <th className="num">{c.commission}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a href={`/yonetim/siparisler/${r.orderId}`}>{r.title ?? r.productType}</a>
                      </td>
                      <td>{stay(r.serviceStart, r.serviceEnd)}</td>
                      <td>{r.providerBookingRef ?? '—'}</td>
                      {(tab === 'UNPAID' || tab === 'RECEIVED') && <td>{bucket(r.bucket)}</td>}
                      {(tab === 'RECEIVED' || tab === 'REFUND_DUE') && <td>{r.payoutReference}</td>}
                      {tab === 'VOIDED' && <td>{r.clawbackReference ?? '—'}</td>}
                      <td className="num">{formatMoney(r.amount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>{c.payoutsTitle}</h2>
        {view.payouts.length === 0 ? (
          <p className="muted">{c.payoutsNone}</p>
        ) : (
          <div className="table-wrap">
            <table data-testid="commission-payouts">
              <thead>
                <tr>
                  <th>{c.receivedOn}</th>
                  <th>{c.provider}</th>
                  <th>{c.reference}</th>
                  <th className="num">{c.count}</th>
                  <th className="num">{c.amount}</th>
                  <th className="num">{c.netted}</th>
                  <th className="num">{c.difference}</th>
                  <th>{c.note}</th>
                  <th>{c.recordedBy}</th>
                </tr>
              </thead>
              <tbody>
                {view.payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.receivedOn, locale)}</td>
                    <td>{p.providerId}</td>
                    <td>{p.reference}</td>
                    <td className="num">{p.count}</td>
                    <td className="num">{formatMoney(p.amount, locale)}</td>
                    <td className="num">{p.clawbacks.minor === '0' ? '—' : formatMoney(p.clawbacks, locale)}</td>
                    <td className="num">{p.difference.minor === '0' ? '—' : formatMoney(p.difference, locale)}</td>
                    <td>{p.note ?? ''}</td>
                    <td>{who(p.recordedBy)}</td>
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
