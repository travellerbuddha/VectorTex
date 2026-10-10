'use client';

import { useState } from 'react';
import type { AdminLocale } from '../../i18n/admin';
import { formatMoney } from '../../i18n/format';

type MoneyJson = { currency: string; minor: string };

export interface SelectableCommission {
  id: string;
  orderId: string;
  title: string;
  stay: string;
  bookingRef: string;
  /** Where it stands (e.g. "not paid, stay not over"). */
  stage: string;
  /** For refunds: the payout that paid it. */
  payoutRef?: string;
  amount: MoneyJson;
}

export interface SelectionLabels {
  select: string;
  selectAll: string;
  order: string;
  stay: string;
  bookingRef: string;
  status: string;
  payoutRef: string;
  commission: string;
  settleTitle: string;
  nettedTitle: string;
  none: string;
  /** With {n} {total} {m} {netted} {expected} placeholders (a function cannot cross to the browser). */
  selected: string;
}

/**
 * The payout form's selection (ADR-0019): commissions the payout covers and refunds Nuitee deducted from it. The
 * expected payout (covered − deducted, per currency) is shown as the person ticks rows, to compare with the statement.
 */
export function CommissionSelection({
  settle,
  netted,
  locale,
  labels,
}: {
  settle: readonly SelectableCommission[];
  netted: readonly SelectableCommission[];
  locale: AdminLocale;
  labels: SelectionLabels;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const chosen = (rows: readonly SelectableCommission[]) => rows.filter((r) => picked.has(r.id));
  const sum = (rows: readonly SelectableCommission[]) => {
    const totals = new Map<string, bigint>();
    for (const r of rows) totals.set(r.amount.currency, (totals.get(r.amount.currency) ?? 0n) + BigInt(r.amount.minor));
    return totals;
  };
  const show = (totals: Map<string, bigint>) =>
    totals.size === 0 ? formatMoney({ currency: [...settle, ...netted][0]?.amount.currency ?? 'EUR', minor: '0' }, locale) : [...totals].map(([currency, minor]) => formatMoney({ currency, minor: minor.toString() }, locale)).join(' + ');
  const a = chosen(settle);
  const b = chosen(netted);
  const plus = sum(a);
  const minus = sum(b);
  const expected = new Map(plus);
  for (const [ccy, minor] of minus) expected.set(ccy, (expected.get(ccy) ?? 0n) - minor);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const setAll = (rows: readonly SelectableCommission[], on: boolean) => {
    const next = new Set(picked);
    for (const r of rows) {
      if (on) next.add(r.id);
      else next.delete(r.id);
    }
    setPicked(next);
  };

  const table = (rows: readonly SelectableCommission[], name: 'commission' | 'clawback', testId: string) => (
    <div className="table-wrap">
      <table data-testid={testId}>
        <thead>
          <tr>
            <th>
              <input type="checkbox" aria-label={`${labels.selectAll}: ${name === 'commission' ? labels.settleTitle : labels.nettedTitle}`} checked={rows.length > 0 && chosen(rows).length === rows.length} onChange={(e) => setAll(rows, e.target.checked)} />
            </th>
            <th>{labels.order}</th>
            <th>{labels.stay}</th>
            <th>{labels.bookingRef}</th>
            <th>{name === 'commission' ? labels.status : labels.payoutRef}</th>
            <th className="num">{labels.commission}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <input type="checkbox" name={name} value={r.id} aria-label={`${labels.select}: ${r.title} ${r.bookingRef}`} checked={picked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
              </td>
              <td>
                <a href={`/yonetim/siparisler/${r.orderId}`}>{r.title}</a>
              </td>
              <td>{r.stay}</td>
              <td>{r.bookingRef}</td>
              <td>{name === 'commission' ? r.stage : (r.payoutRef ?? '—')}</td>
              <td className="num">{formatMoney(r.amount, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {settle.length > 0 && (
        <>
          <h3>{labels.settleTitle}</h3>
          {table(settle, 'commission', 'unpaid-commissions')}
        </>
      )}
      {netted.length > 0 && (
        <>
          <h3>{labels.nettedTitle}</h3>
          {table(netted, 'clawback', 'netted-commissions')}
        </>
      )}
      <p className="muted" data-testid="payout-selected" aria-live="polite">
        {a.length + b.length === 0
          ? labels.none
          : labels.selected.replace('{n}', String(a.length)).replace('{total}', show(plus)).replace('{m}', String(b.length)).replace('{netted}', show(minus)).replace('{expected}', show(expected))}
      </p>
    </>
  );
}
