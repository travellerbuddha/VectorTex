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
  source: string;
  earnedAt: string;
  amount: MoneyJson;
}

/**
 * Earned commissions with checkboxes for a payout form (ADR-0019). The selected total per currency is shown as the
 * person ticks rows, so it can be compared with the amount on the statement before saving.
 */
export function CommissionSelection({
  rows,
  locale,
  labels,
}: {
  rows: readonly SelectableCommission[];
  locale: AdminLocale;
  labels: { select: string; selectAll: string; order: string; stay: string; bookingRef: string; source: string; earnedAt: string; commission: string; none: string; /** With {n} and {total} placeholders (a function cannot cross to the browser). */ selected: string };
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const live = rows.filter((r) => picked.has(r.id));
  const totals = new Map<string, bigint>();
  for (const r of live) totals.set(r.amount.currency, (totals.get(r.amount.currency) ?? 0n) + BigInt(r.amount.minor));
  const total = [...totals].map(([currency, minor]) => formatMoney({ currency, minor: minor.toString() }, locale)).join(' + ');
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const all = rows.length > 0 && live.length === rows.length;
  return (
    <>
      <div className="table-wrap">
        <table data-testid="earned-commissions">
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label={labels.selectAll} checked={all} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
              </th>
              <th>{labels.order}</th>
              <th>{labels.stay}</th>
              <th>{labels.bookingRef}</th>
              <th>{labels.source}</th>
              <th>{labels.earnedAt}</th>
              <th className="num">{labels.commission}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input type="checkbox" name="commission" value={r.id} aria-label={`${labels.select}: ${r.title} ${r.bookingRef}`} checked={picked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
                </td>
                <td>
                  <a href={`/yonetim/siparisler/${r.orderId}`}>{r.title}</a>
                </td>
                <td>{r.stay}</td>
                <td>{r.bookingRef}</td>
                <td>{r.source}</td>
                <td>{r.earnedAt}</td>
                <td className="num">{formatMoney(r.amount, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" data-testid="payout-selected" aria-live="polite">
        {live.length === 0 ? labels.none : labels.selected.replace('{n}', String(live.length)).replace('{total}', total)}
      </p>
    </>
  );
}
