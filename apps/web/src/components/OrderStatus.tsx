'use client';

import { useEffect, useState } from 'react';
import type { OrderView } from '@texholiday/booking';
import { dict, type Locale } from '../i18n/dictionaries';
import { api } from './api';

const OPEN = new Set(['PREPARING_PAYMENT', 'AWAITING_PAYMENT', 'CONFIRMING']);

/**
 * Shows the server's order stage. After a return from the payment page it keeps asking the server to finalize
 * for a while; the worker continues afterwards even if the page is closed.
 */
export function OrderStatus({ locale, initial, finalizeWhileOpen }: { locale: Locale; initial: OrderView; finalizeWhileOpen: boolean }) {
  const t = dict(locale);
  const [order, setOrder] = useState(initial);
  const [tries, setTries] = useState(0);
  const open = OPEN.has(order.stage);
  const giveUp = tries >= 12;

  useEffect(() => {
    if (!open || giveUp) return;
    const delay = Math.min(2000 * 1.5 ** tries, 10_000);
    const timer = setTimeout(async () => {
      try {
        const next = finalizeWhileOpen
          ? await api<OrderView>(`/api/v1/orders/${order.orderId}/finalize`, { method: 'POST' })
          : await api<OrderView>(`/api/v1/orders/${order.orderId}`);
        setOrder(next);
      } finally {
        setTries((n) => n + 1);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [open, giveUp, tries, order.orderId, finalizeWhileOpen]);

  return (
    <section aria-live="polite" className={`status status-${order.stage.toLowerCase()}`}>
      <p className="status-message">{t.order.stage[order.stage]}</p>
      {open && !giveUp && <p className="muted">{t.order.checking}</p>}
      {open && giveUp && <p className="muted">{t.order.stillWorking}</p>}
      {order.stage === 'CONFIRMED' && order.bookingReference && (
        <p>
          {t.order.reference}: <strong data-testid="booking-reference">{order.bookingReference}</strong>
          <br />
          <span className="muted">{t.order.voucher}</span>
        </p>
      )}
      {order.paymentHoldMayExist && <p className="notice">{t.order.hold}</p>}
      {order.stage === 'AWAITING_PAYMENT' && (
        <p>
          <a className="secondary" href={`/${locale}/orders/${order.orderId}/payment`}>
            {t.order.goPay}
          </a>
        </p>
      )}
      {['PRICE_CHANGED', 'EXPIRED', 'FAILED'].includes(order.stage) && (
        <p>
          <a className="secondary" href={`/${locale}`}>
            {t.order.newSearch}
          </a>
        </p>
      )}
    </section>
  );
}
