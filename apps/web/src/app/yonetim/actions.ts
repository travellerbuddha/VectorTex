'use server';

import { redirect } from 'next/navigation';
import { isDomainError } from '@texholiday/contracts';
import { admin, allowAttempt, clearStaffCookie, continueSignIn, setStaffCookie, staffToken, userAgent } from '../../server/admin';

/** Sign-in steps of /yonetim (ADR-0010). Server actions only accept same-origin posts (Next.js origin check). */

const field = (form: FormData, name: string) => String(form.get(name) ?? '');
const isAuthFailure = (err: unknown) => isDomainError(err) && err.code === 'UNAUTHENTICATED';

export async function signInAction(form: FormData): Promise<void> {
  if (!(await allowAttempt('sign-in'))) redirect('/yonetim/giris?durum=sinir');
  let next: string;
  try {
    const out = await admin().auth.signIn(field(form, 'email'), field(form, 'password'), { userAgent: await userAgent() });
    await setStaffCookie(out.token);
    next = continueSignIn(out.stage);
  } catch (err) {
    if (isAuthFailure(err)) redirect('/yonetim/giris?durum=hata');
    throw err;
  }
  redirect(next);
}

export async function verifyCodeAction(form: FormData): Promise<void> {
  if (!(await allowAttempt('mfa'))) redirect('/yonetim/giris?durum=sinir');
  try {
    const out = await admin().auth.verifyMfa((await staffToken()) ?? '', field(form, 'code').replace(/\s/g, ''));
    await setStaffCookie(out.token);
  } catch (err) {
    if (isAuthFailure(err)) redirect('/yonetim/giris/kod?durum=hata');
    throw err;
  }
  redirect('/yonetim');
}

export async function completeEnrollmentAction(form: FormData): Promise<void> {
  if (!(await allowAttempt('mfa'))) redirect('/yonetim/giris?durum=sinir');
  try {
    const out = await admin().auth.completeEnrollment((await staffToken()) ?? '', field(form, 'code').replace(/\s/g, ''));
    await setStaffCookie(out.token);
  } catch (err) {
    if (isAuthFailure(err)) redirect('/yonetim/giris/mfa-kurulum?durum=hata');
    throw err;
  }
  redirect('/yonetim');
}

export async function completeSetupAction(form: FormData): Promise<void> {
  const token = field(form, 'token');
  const back = (state: string) => `/yonetim/kurulum/${encodeURIComponent(token)}?durum=${state}`;
  if (!(await allowAttempt('setup'))) redirect('/yonetim/giris?durum=sinir');
  const password = field(form, 'password');
  if (password !== field(form, 'confirm')) redirect(back('eslesme'));
  let next: string;
  try {
    const out = await admin().auth.completeSetup(token, password, { userAgent: await userAgent() });
    await setStaffCookie(out.token);
    next = continueSignIn(out.stage);
  } catch (err) {
    if (isDomainError(err) && err.code === 'VALIDATION_FAILED') redirect(back('zayif'));
    if (isDomainError(err) && err.code === 'NOT_FOUND') redirect(back('gecersiz'));
    throw err;
  }
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  await admin().auth.signOut(await staffToken());
  await clearStaffCookie();
  redirect('/yonetim/giris?durum=cikis');
}

export async function switchLanguageAction(form: FormData): Promise<void> {
  const { cookies } = await import('next/headers');
  (await cookies()).set('th_admin_lang', field(form, 'lang') === 'en' ? 'en' : 'tr', { httpOnly: true, sameSite: 'strict', path: '/yonetim', maxAge: 365 * 86_400 });
  const back = field(form, 'back');
  redirect(back.startsWith('/yonetim') && !back.startsWith('//') ? back : '/yonetim');
}
