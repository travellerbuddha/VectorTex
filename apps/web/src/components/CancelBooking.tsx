'use client';

import { useEffect, useId, useState } from 'react';
import type { CustomerCancellationView, CustomerCancelResult, OrderView } from '@texholiday/booking';
import { dict, type Locale } from '../i18n/dictionaries';
import { formatInstant, formatMoney } from '../i18n/format';
import { api, ApiError } from './api';

type Notice = 'rejected' | 'feeChanged' | 'notAnymore' | 'failed' | null;

/**
 * Online cancellation by the booking's owner (T27, ADR-0021). The fee shown is the one sent back as accepted: if it
 * changed meanwhile, the server refuses and the new fee is shown. After a lost answer the state is read again; nothing
 * is re-sent.
 */
export function CancelBooking({
  locale,
  orderId,
  initial,
  onOrder,
}: {
  locale: Locale;
  orderId: string;
  initial: CustomerCancellationView | null;
  onOrder: (order: OrderView) => void;
}) {
  const t = dict(locale).order.cancel;
  const id = useId();
  const [view, setView] = useState(initial);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [polls, setPolls] = useState(0);

  const reload = async () => {
    const [c, order] = await Promise.all([
      api<{ cancellation: CustomerCancellationView | null }>(`/api/v1/orders/${orderId}/cancellation`),
      api<OrderView>(`/api/v1/orders/${orderId}`),
    ]);
    setView(c.cancellation);
    setConfirmed(false);
    onOrder(order);
    return c.cancellation;
  };

  // While a cancellation is being checked (lost answer or provider pending), read it again for a while.
  useEffect(() => {
    if (view?.state !== 'IN_PROGRESS' || polls >= 12) return;
    const timer = setTimeout(() => {
      reload()
        .catch(() => undefined)
        .finally(() => setPolls((n) => n + 1));
    }, 5000);
    return () => clearTimeout(timer);
  }, [view?.state, polls]);

  if (!view) return notice === 'rejected' ? <p className="notice" role="status">{t.rejected}</p> : null;

  if (view.state === 'NOT_AVAILABLE') {
    return (
      <section className="card cancel-booking" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{t.title}</h2>
        <p className="muted" data-testid="cancel-not-available">
          {view.reason === 'STAY_STARTED' ? t.stayStarted : t.noRefund}
        </p>
        {notice === 'notAnymore' && <p className="notice">{t.notAnymore}</p>}
      </section>
    );
  }

  if (view.state === 'IN_PROGRESS') {
    return (
      <p className="notice" role="status" data-testid="cancel-in-progress">
        {t.inProgress}
      </p>
    );
  }

  const fee = view.expectedFee;
  const charged = fee.minor !== '0';
  const submit = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<CustomerCancelResult>(`/api/v1/orders/${orderId}/cancellation`, { method: 'POST', body: { acceptedFee: fee } });
      onOrder(r.order);
      setView(r.cancellation);
      setConfirmed(false);
      if (r.outcome === 'REJECTED') setNotice('rejected');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setNotice(code === 'VERSION_CONFLICT' ? 'feeChanged' : code === 'ILLEGAL_TRANSITION' ? 'notAnymore' : 'failed');
      // The request may have reached us: show what is true now rather than guessing.
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card cancel-booking" aria-labelledby={`${id}-title`} data-testid="cancel-booking">
      <h2 id={`${id}-title`}>{t.title}</h2>
      {notice && (
        <p className="notice" role="alert">
          {t[notice]}
        </p>
      )}
      <p data-testid="cancel-fee">
        {charged ? t.fee(formatMoney(fee, locale), formatMoney(view.paid, locale)) : view.freeUntil ? t.freeUntil(formatInstant(view.freeUntil, locale)) : t.freeNow}
      </p>
      <p className="muted">{t.refund}</p>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
        <span>{charged ? t.confirmFee(formatMoney(fee, locale)) : t.confirmFree}</span>
      </label>
      <button type="button" className="danger" onClick={submit} disabled={!confirmed || busy}>
        {busy ? t.sending : t.submit}
      </button>
    </section>
  );
}
