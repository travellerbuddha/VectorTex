'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseAmount } from '@texholiday/admin';
import { currency, fromMajor, type Money } from '@texholiday/pricing';
import { adminDict, adminLocale } from '../../../../../i18n/admin';
import { requireStaff } from '../../../../../server/admin';
import { actorOf, errorText, type FormState } from '../../../../../server/admin-forms';
import { booking } from '../../../../../server/booking';

/** Records a commission payout (ADR-0019). The permission is checked by the booking application on every call. */
export async function recordPayoutAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale).reports.commissions;
  let amount: Money;
  try {
    const plain = parseAmount(String(form.get('amount') ?? ''), locale === 'tr' ? ',' : '.');
    if (plain === null) throw new Error('format');
    amount = fromMajor(plain, currency(String(form.get('currency') ?? '')));
  } catch {
    return { error: t.amountInvalid };
  }
  const ids = form.getAll('commission').map(String);
  let payoutId: string;
  try {
    const r = await (await booking()).app.commissions.recordPayout(actorOf(staff), {
      providerId: String(form.get('provider') ?? ''),
      reference: String(form.get('reference') ?? ''),
      amount,
      receivedOn: String(form.get('receivedOn') ?? ''),
      note: String(form.get('note') ?? ''),
      commissionIds: ids,
    });
    payoutId = r.payoutId;
  } catch (err) {
    return { error: errorText(err, locale) };
  }
  revalidatePath('/yonetim/raporlar/komisyonlar');
  // The settled rows leave this list: the result is shown on the "received" tab.
  redirect(`/yonetim/raporlar/komisyonlar?durum=RECEIVED&kayit=${payoutId}`);
}
