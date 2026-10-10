import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
export type E2eAccount = 'admin' | 'finance' | 'approver' | 'editor';

export async function signIn(page: Page, key: E2eAccount): Promise<void> {
  await page.goto('/yonetim/giris');
  await page.getByLabel('E-posta').fill(`${key}@e2e.test`);
  await page.getByLabel('Şifre').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Devam' }).click();
  await expect(page).toHaveURL(/\/yonetim\/giris\/kod/);
  await page.getByLabel('Kod', { exact: true }).fill(await nextCode(page, key));
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL(/\/yonetim$/);
}

/**
 * A TOTP code of the account that has not been used yet. A code works once per account and only one step ahead is
 * accepted, so a second code within a step waits for the next one. The last step is kept in a file (global setup):
 * Playwright restarts the worker after a failed test, losing process state.
 */
export async function nextCode(page: Page, key: E2eAccount): Promise<string> {
  const secret = process.env[`E2E_SECRET_${key}`]!;
  const file = process.env.E2E_STEP_FILE!;
  const read = () => JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>;
  while (totpStep(new Date()) + 1 <= (read()[key] ?? 0)) await page.waitForTimeout(1000);
  const step = totpStep(new Date()) + 1;
  writeFileSync(file, JSON.stringify({ ...read(), [key]: step }));
  return hotp(base32Decode(secret), step);
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

/** The setup link from the newest e-mail to `to` (MOCK mailer files, see playwright.config.ts). */
export async function mailedLink(to: string): Promise<string> {
  const dir = process.env.E2E_MAIL_DIR!;
  let link: string | null = null;
  await expect
    .poll(
      () => {
        if (!existsSync(dir)) return null;
        const mails = readdirSync(dir)
          .sort()
          .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { to: string; text: string })
          .filter((m) => m.to === to);
        link = mails.at(-1)?.text.match(/https?:\/\/\S+\/yonetim\/kurulum\/[A-Za-z0-9_-]+/)?.[0] ?? null;
        return link;
      },
      { timeout: 10_000, message: `setup e-mail to ${to}` },
    )
    .not.toBeNull();
  return link!;
}
