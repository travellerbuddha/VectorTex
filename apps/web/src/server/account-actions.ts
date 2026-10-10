'use server';

import { redirect } from 'next/navigation';
import { isDomainError } from '@texholiday/contracts';
import { normalizeCustomerEmail } from '@texholiday/booking';
import type { Locale } from '../i18n/dictionaries';
import { allowAttempt } from './admin';
import { clearCustomerCookie, customerAccounts, customerToken, pendingEmail, setCustomerCookie, setPendingEmail } from './customer';
import { ACCOUNT_DIR } from './seo';

/** Sign-in steps of "Rezervasyonlarım" (ADR-0017). Plain form posts: they work without JavaScript. */
const page = (locale: Locale, state?: string) => `/${locale}/${ACCOUNT_DIR[locale]}${state ? `?durum=${state}` : ''}`;
const localeOf = (form: FormData): Locale => (form.get('locale') === 'en' ? 'en' : 'tr');

export async function requestCodeAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const email = normalizeCustomerEmail(form.get('email'));
  if (!email) redirect(page(locale, 'eposta'));
  // Per client on top of the per-address limit in the service.
  if (!(await allowAttempt('customer-code', 10, 15 * 60_000))) redirect(page(locale, 'sinir'));
  let state = 'kod';
  try {
    await (await customerAccounts()).requestCode(email, locale);
    await setPendingEmail(email);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    state = err.code === 'RATE_LIMITED' ? 'sinir' : err.code === 'CAPABILITY_NOT_AVAILABLE' ? 'kapali' : 'eposta';
  }
  redirect(page(locale, state));
}

export async function verifyCodeAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const email = await pendingEmail();
  if (!email) redirect(page(locale));
  if (!(await allowAttempt('customer-verify', 20, 15 * 60_000))) redirect(page(locale, 'sinir'));
  let ok = false;
  try {
    const s = await (await customerAccounts()).verify(email, form.get('code'));
    await setCustomerCookie(s.token, s.expiresAt);
    await setPendingEmail(null);
    ok = true;
  } catch (err) {
    if (!isDomainError(err)) throw err;
  }
  redirect(ok ? page(locale) : page(locale, 'hatali'));
}

export async function restartSignInAction(form: FormData): Promise<void> {
  await setPendingEmail(null);
  redirect(page(localeOf(form)));
}

export async function customerSignOutAction(form: FormData): Promise<void> {
  await (await customerAccounts()).signOut(await customerToken());
  await clearCustomerCookie();
  redirect(page(localeOf(form)));
}
