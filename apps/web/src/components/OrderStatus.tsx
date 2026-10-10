'use client';

import { useEffect, useState } from 'react';
import type { CustomerCancellationView, OrderView } from '@texholiday/booking';
import { CircleCheck, CircleX, Hourglass, Info, TriangleAlert } from 'lucide-react';
import { dict, type Locale } from '../i18n/dictionaries';
import { api } from './api';
import { CancelBooking } from './CancelBooking';
import { pushEvent, type AnalyticsItem } from './tracking/TrackEvent';

const OPEN = new Set(['PREPARING_PAYMENT', 'AWAITING_PAYMENT', 'CONFIRMING', 'ISSUING']);

/**
 * Shows the server's order stage. After a return from the payment page it keeps asking the server to finalize
 * for a while; the worker continues afterwards even if the page is closed.
 */
export function OrderStatus({
  locale,
  initial,
  finalizeWhileOpen,
  purchase,
  cancellation,
}: {
  locale: Locale;
  initial: OrderView;
  finalizeWhileOpen: boolean;
  /** Return page only (ADR-0018): GA4 purchase sent once per order from this browser when the booking is confirmed. */
  purchase?: { currency: string; value: number; items: AnalyticsItem[] };
  /** Order page only (ADR-0021): online cancellation by the owner; undefined hides it. */
  cancellation?: CustomerCancellationView | null;
}) {
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

  useEffect(() => {
    if (purchase && order.stage === 'CONFIRMED') pushEvent('purchase', { transaction_id: order.orderId, ...purchase }, `purchase_${order.orderId}`);
  }, [purchase, order.stage, order.orderId]);

  const icon =
    order.stage === 'CONFIRMED' ? <CircleCheck /> : order.stage === 'CANCELLED' ? <CircleX /> : open ? <Hourglass /> : order.stage === 'NEEDS_ATTENTION' ? <Info /> : <TriangleAlert />;
  const status = (
    <section aria-live="polite" className={`status status-${order.stage.toLowerCase()}`}>
      <div className="status-head">
        <span className="status-icon" aria-hidden="true">
          {icon}
        </span>
        <div>
          <p className="status-message">{t.order.stage[order.stage]}</p>
          {open && !giveUp && (
            <p className="muted status-checking">
              <span className="spinner" aria-hidden="true" />
              {t.order.checking}
            </p>
          )}
          {open && giveUp && <p className="muted">{t.order.stillWorking}</p>}
        </div>
      </div>
      {order.stage === 'CONFIRMED' && order.bookingReference && order.quote.product === 'HOTEL' && (
        <>
          <p className="reference">
            <span className="muted">{t.order.reference}</span>
            <strong data-testid="booking-reference">{order.bookingReference}</strong>
          </p>
          <p className="muted">{t.order.voucher}</p>
        </>
      )}
      {order.stage === 'CONFIRMED' && order.quote.product === 'FLIGHT' && (
        <>
          {order.bookingReference && (
            <p className="reference">
              <span className="muted">{t.flight.pnr}</span>
              <strong data-testid="booking-reference">{order.bookingReference}</strong>
            </p>
          )}
          <p>
            {order.ticketNumbers.length > 0 && (
              <>
                {t.flight.tickets}: <span data-testid="ticket-numbers">{order.ticketNumbers.join(', ')}</span>
                <br />
              </>
            )}
            <span className="muted">{t.flight.ticketMail}</span>
          </p>
          <p className="muted">{t.flight.support}</p>
        </>
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
          <a className="secondary" href={order.quote.product === 'FLIGHT' ? `/${locale}/flights` : `/${locale}`}>
            {t.order.newSearch}
          </a>
        </p>
      )}
    </section>
  );
  // The cancellation form stays outside the live region, which only announces the stage.
  if (cancellation === undefined) return status;
  return (
    <div>
      {status}
      <CancelBooking locale={locale} orderId={order.orderId} initial={cancellation} onOrder={setOrder} />
    </div>
  );
}
