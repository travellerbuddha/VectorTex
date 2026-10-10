import { financePeriod, type CountAndAmount, type FinanceReport } from '@texholiday/admin';
import { DomainError } from '@texholiday/contracts';
import { canSeeReport } from '../../../../../components/admin/AdminNav';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { formatMoney } from '../../../../../i18n/format';
import { admin, requireStaff } from '../../../../../server/admin';
import { actorOf } from '../../../../../server/admin-forms';
import { istanbulToday, presetPeriods } from '../../../../../server/finance-period';

export const dynamic = 'force-dynamic';

/** Finance report (P15b): sums per currency for one period; the line-level CSV beside it. orders.view_financials. */
export default async function FinanceReportPage({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  if (!canSeeReport(staff, 'finance')) return <p className="notice">{t.noAccess}</p>;
  const f = t.reports.finance;
  const today = istanbulToday(new Date());
  const presets = presetPeriods(today);
  const sp = await searchParams;
  const asked = { from: sp.bas ?? presets.thisMonth.from, to: sp.bit ?? presets.thisMonth.to };
  let period: { from: string; to: string } | null = null;
  try {
    period = financePeriod(asked.from, asked.to);
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
  }
  const report: FinanceReport | null = period ? await admin().finance.report(actorOf(staff), period) : null;
  const status = (k: string) => t.orders.statuses[k] ?? t.orders.paymentStatuses[k] ?? f.commissionStatuses[k] ?? k;

  const table = (testId: string, rows: ReadonlyArray<CountAndAmount & { status?: string }>, withStatus: boolean) =>
    rows.length === 0 ? (
      <p className="muted">{f.none}</p>
    ) : (
      <div className="table-wrap">
        <table data-testid={testId}>
          <thead>
            <tr>
              {withStatus && <th>{f.status}</th>}
              <th>{f.currency}</th>
              <th className="num">{f.count}</th>
              <th className="num">{f.amount}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.status ?? ''}-${r.currency}`}>
                {withStatus && <td>{status(r.status ?? '')}</td>}
                <td>{r.currency}</td>
                <td className="num">{r.count}</td>
                <td className="num">{formatMoney(r.amount, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div>
      <h1>{f.title}</h1>
      <p className="muted">{f.intro}</p>
      <form className="card filters" method="get">
        <div className="field">
          <label htmlFor="bas">{f.from}</label>
          <input id="bas" name="bas" type="date" defaultValue={asked.from} required />
        </div>
        <div className="field">
          <label htmlFor="bit">{f.to}</label>
          <input id="bit" name="bit" type="date" defaultValue={asked.to} required />
        </div>
        <button type="submit" className="primary">
          {f.show}
        </button>
      </form>
      <nav className="tabs" aria-label={f.title}>
        {(['thisMonth', 'lastMonth', 'last30'] as const).map((k) => (
          <a key={k} href={`/yonetim/raporlar/finans?bas=${presets[k].from}&bit=${presets[k].to}`} aria-current={period && presets[k].from === period.from && presets[k].to === period.to ? 'page' : undefined}>
            {f.presets[k]}
          </a>
        ))}
      </nav>
      {!report || !period ? (
        <p className="notice" role="alert">
          {f.invalid}
        </p>
      ) : (
        <>
          <p className="muted">
            {f.environment}: <strong>{report.environment}</strong> ·{' '}
            <a className="button secondary" href={`/api/v1/staff/finance-report?from=${period.from}&to=${period.to}`} download>
              {f.csv}
            </a>{' '}
            <small>{f.csvNote}</small>
          </p>
          <section className="card">
            <h2>{f.ordersTitle}</h2>
            {table('finance-orders', report.orders, true)}
          </section>
          <section className="card">
            <h2>{f.salesTitle}</h2>
            <p className="muted">{f.salesIntro}</p>
            {report.sales.length === 0 ? (
              <p className="muted">{f.none}</p>
            ) : (
              <div className="table-wrap">
                <table data-testid="finance-sales">
                  <thead>
                    <tr>
                      <th>{f.product}</th>
                      <th className="num">{f.count}</th>
                      <th className="num">{f.charge}</th>
                      <th className="num">{f.supplierPrice}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sales.map((r) => (
                      <tr key={`${r.productType}-${r.charge.currency}-${r.supplierPrice.currency}`}>
                        <td>{r.productType}</td>
                        <td className="num">{r.count}</td>
                        <td className="num">{formatMoney(r.charge, locale)}</td>
                        <td className="num">{formatMoney(r.supplierPrice, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card">
            <h2>{f.commissionsTitle}</h2>
            {table('finance-commissions', report.commissions, true)}
            <h3>{f.openTitle}</h3>
            {table('finance-open-commissions', report.openCommissions, true)}
            <h3>{f.payoutsTitle}</h3>
            {table('finance-payouts', report.payouts, false)}
            <p className="muted">
              <a href="/yonetim/raporlar/komisyonlar">{t.reports.items.commissions!.title}</a>
            </p>
          </section>
          <section className="card">
            <h2>{f.cancellationsTitle}</h2>
            {table('finance-cancellations', report.cancellations, false)}
            <h2>{f.refundsTitle}</h2>
            {table('finance-refunds', report.refunds, false)}
          </section>
          <section className="card">
            <h2>{f.paymentsTitle}</h2>
            {table('finance-payments', report.payments, true)}
          </section>
        </>
      )}
    </div>
  );
}
