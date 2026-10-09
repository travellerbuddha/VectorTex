import { expect, type Page } from '@playwright/test';
import { base32Decode, hotp, totpStep } from '@texholiday/admin';
import { E2E_ADMIN_PASSWORD } from './keys';

export const codeFor = (secret: string, stepOffset = 0) => hotp(base32Decode(secret), totpStep(new Date()) + stepOffset);

/** Our own alerts (Next.js adds an empty route-announcer alert of its own outside the main area). */
export const alertIn = (page: Page) => page.locator('#admin-main').getByRole('alert');
export const statusIn = (page: Page) => page.locator('#admin-main').getByRole('status');

/**
 * Signs in one of the e2e panel accounts (admin, finance, approver; see global setup). A TOTP code works once per
 * account and only one step ahead is accepted, so a second sign-in of the same account within a step waits for it.
 */
export async function signIn(page: Page, key: 'admin' | 'finance' | 'approver'): Promise<void> {
  const secret = process.env[`E2E_SECRET_${key}`]!;
  const used = Number(process.env[`E2E_LAST_STEP_${key}`] ?? 0);
  while (totpStep(new Date()) + 1 <= used) await page.waitForTimeout(1000);
  const step = totpStep(new Date()) + 1;
  process.env[`E2E_LAST_STEP_${key}`] = String(step);
  await page.goto('/yonetim/giris');
  await page.getByLabel('E-posta').fill(`${key}@e2e.test`);
  await page.getByLabel('Şifre').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Devam' }).click();
  await expect(page).toHaveURL(/\/yonetim\/giris\/kod/);
  await page.getByLabel('Kod', { exact: true }).fill(hotp(base32Decode(secret), step));
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL(/\/yonetim$/);
}

export const signInAdmin = (page: Page) => signIn(page, 'admin');

/** Completes an invite link in the given page: password, then authenticator enrollment. Returns the TOTP secret. */
export async function onboard(page: Page, link: string, password: string): Promise<string> {
  await page.goto(link);
  await page.getByLabel('Yeni şifre', { exact: true }).fill(password);
  await page.getByLabel('Yeni şifre (tekrar)').fill(password);
  await page.getByRole('button', { name: 'Şifreyi kaydet' }).click();
  await expect(page).toHaveURL(/\/yonetim\/giris\/mfa-kurulum/);
  const secret = (await page.getByTestId('mfa-secret').innerText()).replace(/\s/g, '');
  await page.getByLabel('Kod', { exact: true }).fill(codeFor(secret));
  await page.getByRole('button', { name: 'Kurulumu tamamla' }).click();
  await expect(page).toHaveURL(/\/yonetim$/);
  return secret;
}
