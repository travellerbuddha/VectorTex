'use server';

import { revalidatePath } from 'next/cache';
import { parseAmount } from '@texholiday/admin';
import { currency, fromMajor, toJson, type Money } from '@texholiday/pricing';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { formatMoney } from '../../../../../i18n/format';
import { requireStaff } from '../../../../../server/admin';
import { actorOf, errorText, type FormState } from '../../../../../server/admin-forms';
import { booking } from '../../../../../server/booking';

/** Order commands (/yonetim). Permissions are checked by the booking application on every call, never here only. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const orderIdOf = (form: FormData) => {
  const id = String(form.get('orderId') ?? '');
  return UUID.test(id) ? id : null;
};

export async function checkStatusAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  const id = orderIdOf(form);
  if (!id) return { error: t.errors.notFound };
  try {
    const r = await (await booking()).app.staff.checkStatus(actorOf(staff), id);
    revalidatePath(`/yonetim/siparisler/${id}`);
    const status = t.orders.statuses[r.orderStatus] ?? r.orderStatus;
    if (r.busy) return { error: t.orders.commands.checked.busy };
    if (!r.providerAnswered) return { error: t.orders.commands.checked.noAnswer };
    return { ok: r.changed ? t.orders.commands.checked.changed(status) : t.orders.commands.checked.unchanged(status) };
  } catch (err) {
    return { error: errorText(err, locale) };
  }
}

export async function cancelOrderAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  const c = t.orders.commands;
  const id = orderIdOf(form);
  if (!id) return { error: t.errors.notFound };
  try {
    const r = await (await booking()).app.staff.cancel(actorOf(staff), id, String(form.get('reason') ?? ''), { customerAcceptedFee: form.get('acceptFee') === '1' });
    revalidatePath(`/yonetim/siparisler/${id}`);
    const fmt = (m: Money | null) => (m ? formatMoney(toJson(m), locale) : c.notReported);
    if (r.outcome === 'CANCELLED') return { ok: r.providerRefund && r.providerRefund.minor === 0n ? c.cancelledNoRefund(fmt(r.penalty)) : c.cancelled(fmt(r.penalty), fmt(r.providerRefund)) };
    if (r.outcome === 'REJECTED') return { error: c.cancelRejected(r.code) };
    return { error: c.cancelUnknown };
  } catch (err) {
    return { error: errorText(err, locale) };
  }
}

export async function recordRefundAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  const id = orderIdOf(form);
  if (!id) return { error: t.errors.notFound };
  let amount: Money;
  try {
    const plain = parseAmount(String(form.get('amount') ?? ''), locale === 'tr' ? ',' : '.');
    if (plain === null) throw new Error('format');
    amount = fromMajor(plain, currency(String(form.get('currency') ?? '')));
  } catch {
    return { error: t.orders.commands.refundAmountInvalid };
  }
  try {
    const r = await (await booking()).app.staff.recordProviderRefund(actorOf(staff), id, amount, String(form.get('reference') ?? ''));
    revalidatePath(`/yonetim/siparisler/${id}`);
    return { ok: t.orders.commands.refundSaved(formatMoney(toJson(r.refundedTotal), locale), t.orders.paymentStatuses[r.paymentStatus] ?? r.paymentStatus) };
  } catch (err) {
    return { error: errorText(err, locale) };
  }
}
