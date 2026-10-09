import { expect, type Page } from '@playwright/test';
import { base32Decode, hotp, totpStep } from '@texholiday/admin';
import { E2E_ADMIN_PASSWORD } from './keys';

export const codeFor = (secret: string, stepOffset = 0) => hotp(base32Decode(secret), totpStep(new Date()) + stepOffset);

/** Our own alerts (Next.js adds an empty route-announcer alert of its own outside the main area). */
export const alertIn = (page: Page) => page.locator('#admin-main').getByRole('alert');
export const statusIn = (page: Page) => page.locator('#admin-main').getByRole('status');

let lastStep = 0;
/** Signs in the e2e administrator; each sign-in uses a later TOTP step than the previous one (codes work once). */
export async function signInAdmin(page: Page): Promise<void> {
  const secret = process.env.E2E_ADMIN_SECRET!;
  await page.goto('/yonetim/giris');
  await page.getByLabel('E-posta').fill('admin@e2e.test');
  await page.getByLabel('Şifre').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Devam' }).click();
  await expect(page).toHaveURL(/\/yonetim\/giris\/kod/);
  const step = Math.max(totpStep(new Date()) + 1, lastStep + 1);
  lastStep = step;
  await page.getByLabel('Kod', { exact: true }).fill(hotp(base32Decode(secret), step));
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL(/\/yonetim$/);
}

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
