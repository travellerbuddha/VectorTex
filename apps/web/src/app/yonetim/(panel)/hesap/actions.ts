'use server';

import { revalidatePath } from 'next/cache';
import { isDomainError } from '@texholiday/contracts';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, requireStaff, staffToken } from '../../../../server/admin';
import { errorText, type FormState } from '../../../../server/admin-forms';

/** New recovery codes for the signed-in person, confirmed with a current authenticator code (ADR-0010). */
export async function createRecoveryCodesAction(_: FormState, form: FormData): Promise<FormState> {
  await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  try {
    const codes = await admin().auth.generateRecoveryCodes((await staffToken()) ?? '', String(form.get('totp') ?? ''));
    revalidatePath('/yonetim/hesap');
    revalidatePath('/yonetim');
    return { codes: { values: codes, note: t.account.shownOnce } };
  } catch (err) {
    if (isDomainError(err) && err.code === 'VALIDATION_FAILED') return { error: t.account.codeRejected };
    return { error: errorText(err, locale) };
  }
}
