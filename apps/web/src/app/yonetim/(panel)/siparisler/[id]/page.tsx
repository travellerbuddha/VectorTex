import { notFound } from 'next/navigation';
import { isDomainError } from '@texholiday/contracts';
import { ActionForm } from '../../../../../components/admin/ActionForm';
import { TaskList } from '../../../../../components/admin/TaskList';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { formatDate, formatMoney } from '../../../../../i18n/format';
import { admin, can, requireStaff } from '../../../../../server/admin';
import { actorOf, formatAdminInstant } from '../../../../../server/admin-forms';
import { cancelOrderAction, checkStatusAction, recordRefundAction } from './actions';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type MoneyJson = { currency: string; minor: string };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  const d = t.orders.detail;
  if (!can(staff, 'orders.view')) return <p className="notice">{t.noAccess}</p>;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { orders, auth } = admin();
  let order;
  try {
    order = await orders.detail(actorOf(staff), id);
  } catch (err) {
    if (isDomainError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  const accounts = await auth.accounts();
  const names = new Map(accounts.map((a) => [a.id, a.displayName]));
  const who = (actor: string) => {
    const id = actor.startsWith('staff:') ? actor.slice(6) : actor;
    return names.get(id) ?? (actor.startsWith('system:') ? t.common.system : actor);
  };
  const c = t.orders.commands;
  const first = order.items[0];
  const pm = order.payment?.mode === 'PROVIDER_MANAGED';
  const mayCheck = pm && order.status !== 'CANCELLED' && can(staff, 'tasks.manage');
  const mayCancel =
    pm && order.status === 'CONFIRMED' && (first?.booking?.status === 'CONFIRMED' || first?.booking?.status === 'ISSUED') && can(staff, 'orders.cancel');
  const mayRecordRefund =
    pm && order.status === 'CANCELLED' && ['CAPTURED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(order.payment?.status ?? '') && can(staff, 'orders.record_refund');
  const describe = (action: string, detail: unknown) => {
    const label = t.orders.events[action] ?? action;
    const x = (detail ?? {}) as Record<string, unknown>;
    const map = action === 'order.status' ? t.orders.statuses : action === 'booking.status' ? t.orders.bookingStatuses : action === 'payment.status' ? t.orders.paymentStatuses : null;
    if (map && typeof x.from === 'string' && typeof x.to === 'string') return `${label}: ${map[x.from] ?? x.from} → ${map[x.to] ?? x.to}${typeof x.reason === 'string' ? ` (${x.reason})` : ''}`;
    if (action === 'task.opened' || action === 'task.assigned' || action === 'task.resolved') return `${label}: ${t.tasks.reasons[String(x.reason)] ?? String(x.reason ?? '')}`;
    return label;
  };

  return (
    <div>
      <p>
        <a href="/yonetim/siparisler">← {d.back}</a>
      </p>
      <h1>
        {t.orders.order} {order.id.slice(0, 8)}{' '}
        <span className={`tag ${order.status === 'CONFIRMED' ? 'ok' : order.status === 'ACTION_REQUIRED' ? 'bad' : 'warn'}`}>{t.orders.statuses[order.status]}</span>
      </h1>
      <div className="grid2">
        <section className="card">
          <h2>{d.summary}</h2>
          <dl className="facts">
            <dt>{d.orderNo}</dt>
            <dd>
              <code>{order.id}</code>
            </dd>
            <dt>{d.createdAt}</dt>
            <dd>{formatAdminInstant(order.createdAt, locale)}</dd>
            <dt>{d.updatedAt}</dt>
            <dd>{formatAdminInstant(order.updatedAt, locale)}</dd>
            <dt>{t.orders.total}</dt>
            <dd>
              <strong>{formatMoney(order.total, locale)}</strong>
            </dd>
            {order.compensationReason && (
              <>
                <dt>{d.reason}</dt>
                <dd>{order.compensationReason}</dd>
              </>
            )}
            <dt>{d.customer}</dt>
            <dd>
              {order.customer.email} · {d.language}: {order.customer.locale.toUpperCase()}
            </dd>
          </dl>
        </section>
        <section className="card">
          <h2>{d.paymentTitle}</h2>
          {order.payment ? (
            <dl className="facts">
              <dt>{d.mode}</dt>
              <dd>{d.modes[order.payment.mode] ?? order.payment.mode}</dd>
              <dt>{t.orders.status}</dt>
              <dd>{t.orders.paymentStatuses[order.payment.status] ?? order.payment.status}</dd>
              <dt>{t.orders.total}</dt>
              <dd>{formatMoney(order.payment.amount, locale)}</dd>
              {order.payment.providerTransactionId && (
                <>
                  <dt>{d.transaction}</dt>
                  <dd>
                    <code>{order.payment.providerTransactionId}</code>
                  </dd>
                </>
              )}
              {order.payment.payBy && (
                <>
                  <dt>{d.payBy}</dt>
                  <dd>{formatAdminInstant(order.payment.payBy, locale)}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="muted">—</p>
          )}
          {order.payment && order.payment.refunds.length > 0 && (
            <div className="top-gap" data-testid="refunds">
              <h3>{d.refunds}</h3>
              <ul className="plain">
                {order.payment.refunds.map((r, i) => (
                  <li key={i}>{d.refundRow(formatMoney(r.amount, locale), r.reference, who(r.recordedBy), formatAdminInstant(r.at, locale))}</li>
                ))}
              </ul>
              <p>
                {d.refundedTotal}: <strong>{formatMoney(order.payment.refundedTotal, locale)}</strong>
              </p>
            </div>
          )}
        </section>
      </div>

      {(mayCheck || mayCancel || mayRecordRefund) && (
        <section className="card" data-testid="order-commands">
          <h2>{c.title}</h2>
          <div className="stack">
            {mayCheck && (
              <ActionForm action={checkStatusAction} submit={c.check} variant="secondary">
                <input type="hidden" name="orderId" value={order.id} />
                <small className="muted">{c.checkHint}</small>
              </ActionForm>
            )}
            {mayCancel && (
              <ActionForm action={cancelOrderAction} submit={c.cancel} variant="danger" confirmText={c.cancelConfirm} className="stack top-gap">
                <input type="hidden" name="orderId" value={order.id} />
                <p className="muted">{c.cancelHint}</p>
                <div className="field">
                  <label htmlFor="cancel-reason">{c.cancelReason}</label>
                  <textarea id="cancel-reason" name="reason" required minLength={5} maxLength={500} />
                </div>
              </ActionForm>
            )}
            {mayRecordRefund && order.payment && (
              <ActionForm action={recordRefundAction} submit={c.refund} confirmText={c.refundConfirm} className="stack top-gap">
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="currency" value={order.payment.amount.currency} />
                <p className="muted">{c.refundHint}</p>
                <div className="row3">
                  <div className="field">
                    <label htmlFor="refund-amount">{c.refundAmount(order.payment.amount.currency)}</label>
                    <input id="refund-amount" name="amount" inputMode="decimal" required autoComplete="off" />
                  </div>
                  <div className="field">
                    <label htmlFor="refund-reference">{c.refundReference}</label>
                    <input id="refund-reference" name="reference" required minLength={3} maxLength={200} aria-describedby="refund-reference-hint" />
                    <small id="refund-reference-hint" className="muted">
                      {c.refundReferenceHint}
                    </small>
                  </div>
                </div>
              </ActionForm>
            )}
          </div>
        </section>
      )}

      {order.items.map((item) => {
        const o = item.option as {
          hotelName?: string;
          address?: string | null;
          room?: { name?: string | null; boardName?: string | null };
          checkin?: string;
          checkout?: string;
          nights?: number;
          rooms?: Array<{ occupancyNumber: number; adults: number; childAges: number[] }>;
          rateParity?: { suggestedSellingPrice: MoneyJson | null; belowSuggestedPrice: boolean } | null;
        };
        const cancel = item.cancellation as { refundable?: boolean; steps?: Array<{ from: string; penalty: { minor: string } }> } | null;
        const freeUntil = cancel?.refundable ? cancel.steps?.find((s) => s.penalty.minor !== '0')?.from : null;
        return (
          <section className="card" key={item.id} data-testid="order-item">
            <h2>
              {d.item} {item.position + 1}: {t.pricing.products[item.productType] ?? item.productType}
            </h2>
            <div className="grid2">
              <dl className="facts">
                <dt>{d.hotel}</dt>
                <dd>
                  {o.hotelName ?? '—'}
                  {o.address && <small className="muted"> · {o.address}</small>}
                </dd>
                <dt>{d.room}</dt>
                <dd>{[o.room?.name, o.room?.boardName].filter(Boolean).join(' · ') || '—'}</dd>
                <dt>{d.stay}</dt>
                <dd>{o.checkin && o.checkout ? `${formatDate(o.checkin, locale)} → ${formatDate(o.checkout, locale)} · ${d.nights(o.nights ?? 0)}` : '—'}</dd>
                <dt>{d.rooms}</dt>
                <dd>{(o.rooms ?? []).map((r) => `${r.adults}+${r.childAges.length}`).join(', ') || '—'}</dd>
                <dt>{d.cancellation}</dt>
                <dd>{cancel?.refundable ? (freeUntil ? d.freeUntil(formatAdminInstant(freeUntil, locale)) : '—') : d.nonRefundable}</dd>
                <dt>{d.parity}</dt>
                <dd>
                  {!o.rateParity?.suggestedSellingPrice
                    ? d.parityNone
                    : o.rateParity.belowSuggestedPrice
                      ? d.parityBelow(formatMoney(o.rateParity.suggestedSellingPrice, locale))
                      : d.parityOk(formatMoney(o.rateParity.suggestedSellingPrice, locale))}
                </dd>
              </dl>
              <dl className="facts">
                <dt>{t.orders.booking}</dt>
                <dd>{item.booking ? (t.orders.bookingStatuses[item.booking.status] ?? item.booking.status) : '—'}</dd>
                {item.booking?.providerBookingRef && (
                  <>
                    <dt>{d.providerRef}</dt>
                    <dd>
                      <code data-testid="provider-ref">{item.booking.providerBookingRef}</code>
                    </dd>
                  </>
                )}
                {item.booking?.clientReference && (
                  <>
                    <dt>{d.clientRef}</dt>
                    <dd>
                      <code>{item.booking.clientReference}</code>
                    </dd>
                  </>
                )}
                <dt>{d.voucher}</dt>
                <dd>{item.booking?.voucherReady ? d.ready : d.notReady}</dd>
                {item.booking?.failureCode && (
                  <>
                    <dt>{d.failure}</dt>
                    <dd>
                      <code>{item.booking.failureCode}</code>
                    </dd>
                  </>
                )}
                {item.booking && item.booking.lookupAttempts > 0 && (
                  <>
                    <dt>{d.lookups}</dt>
                    <dd>{item.booking.lookupAttempts}</dd>
                  </>
                )}
              </dl>
            </div>
            {item.guests && (
              <dl className="facts top-gap">
                <dt>{d.holder}</dt>
                <dd>
                  {item.guests.holder.firstName} {item.guests.holder.lastName} · {item.guests.holder.email} · {item.guests.holder.phone}
                </dd>
                {item.guests.roomGuests.map((g) => (
                  <div key={String(g.occupancyNumber)} className="contents">
                    <dt>{d.roomGuest(Number(g.occupancyNumber))}</dt>
                    <dd>
                      {String(g.firstName ?? '')} {String(g.lastName ?? '')}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <h3 className="top-gap">{d.financials}</h3>
            {item.financials ? (
              <dl className="facts" data-testid="financials">
                <dt>{d.sell}</dt>
                <dd>{formatMoney(item.financials.sell, locale)}</dd>
                <dt>{d.cost}</dt>
                <dd>{formatMoney(item.financials.supplierCost, locale)}</dd>
                <dt>{d.commission}</dt>
                <dd>
                  {item.financials.providerCommission ? formatMoney(item.financials.providerCommission, locale) : '—'}
                  {item.financials.commissionStatus && <small className="muted"> ({d.commissionStatuses[item.financials.commissionStatus] ?? item.financials.commissionStatus})</small>}
                </dd>
              </dl>
            ) : (
              <p className="muted">{d.noFinancials}</p>
            )}
          </section>
        );
      })}

      <section className="card">
        <h2>{d.tasks}</h2>
        {order.tasks.length === 0 ? (
          <p className="muted">{d.noTasks}</p>
        ) : (
          <TaskList tasks={order.tasks} locale={locale} canManage={can(staff, 'tasks.manage')} names={names} showOrder={false} meId={staff.id} />
        )}
      </section>

      <section className="card">
        <h2>{d.timeline}</h2>
        <ol className="timeline">
          {order.timeline.map((e, i) => (
            <li key={i}>
              <time>{formatAdminInstant(e.at, locale)}</time> <span>{describe(e.action, e.detail)}</span> <small className="muted">· {who(e.actor)}</small>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
