'use server';

import { revalidatePath } from 'next/cache';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, requireStaff } from '../../../../server/admin';
import { actorOf, errorText, type FormState } from '../../../../server/admin-forms';

/** Operation task commands (tasks.manage, checked by the service). */

export async function takeTaskAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  try {
    await admin().orders.takeTask(actorOf(staff), String(form.get('taskId') ?? ''));
  } catch (err) {
    return { error: errorText(err, locale) };
  }
  revalidatePath('/yonetim/gorevler');
  revalidatePath(`/yonetim/siparisler/${String(form.get('orderId') ?? '')}`);
  return { ok: adminDict(locale).tasks.taken };
}

export async function resolveTaskAction(_: FormState, form: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const locale = await adminLocale();
  try {
    await admin().orders.resolveTask(actorOf(staff), String(form.get('taskId') ?? ''), String(form.get('resolution') ?? ''));
  } catch (err) {
    return { error: errorText(err, locale) };
  }
  revalidatePath('/yonetim/gorevler');
  revalidatePath(`/yonetim/siparisler/${String(form.get('orderId') ?? '')}`);
  return { ok: adminDict(locale).tasks.resolvedOk };
}
