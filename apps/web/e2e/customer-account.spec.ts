import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * "Rezervasyonlarım" (ADR-0017): a guest books, then on another device signs in with a one-time code sent by e-mail
 * (MOCK mailer files) and opens the booking without the checkout cookie. Unknown addresses get the same answer.
 */
async function mailedCode(to: string, after: number): Promise<string> {
  const dir = process.env.E2E_MAIL_DIR!;
  let code: string | null = null;
  await expect
    .poll(
      () => {
        if (!existsSync(dir)) return null;
        const mails = readdirSync(dir)
          .sort()
          .map((f) => ({ f, ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as { to: string; subject: string; text: string }) }))
          .filter((m) => m.to === to && /giriş kodunuz/.test(m.subject));
        code = mails.length > after ? (mails.at(-1)!.text.match(/\b(\d{6})\b/)?.[1] ?? null) : null;
        return code;
      },
      { timeout: 10_000, message: `sign-in code e-mail to ${to}` },
    )
    .not.toBeNull();
  return code!;
}

const mailCount = (to: string) => {
  const dir = process.env.E2E_MAIL_DIR!;
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { to: string; subject: string };
    return m.to === to && /giriş kodunuz/.test(m.subject);
  }).length;
};

async function bookAsGuest(page: Page, email: string): Promise<string> {
  await page.goto('/tr');
  await page.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await page.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await page.getByRole('button', { name: /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rezervasyonu tamamlayın' })).toBeVisible();
  await page.getByLabel('Ad', { exact: true }).fill('Zeynep');
  await page.getByLabel('Soyad', { exact: true }).fill('Kara');
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel(/Telefon/).fill('+905321112233');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await page.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  return page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;
}

test('customer signs in with an e-mailed code and sees their booking on another device', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one booking per run');
  const email = `zeynep.${Date.now().toString(36)}@example.test`;
  const orderId = await bookAsGuest(page, email);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  // Another device: the order page is closed without the checkout cookie.
  expect((await other.goto(`/tr/orders/${orderId}`))!.status()).toBe(404);

  await other.goto('/tr');
  await other.getByRole('link', { name: 'Rezervasyonlarım' }).click();
  await expect(other).toHaveURL(/\/tr\/hesabim$/);
  await expect(other.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  // An address without bookings gets the same answer, and no e-mail.
  await other.getByLabel('E-posta adresi').fill('nobody@example.test');
  await other.getByRole('button', { name: 'Kod gönder' }).click();
  await expect(other.getByText(/adresine ait bir rezervasyon varsa 6 haneli kodu gönderdik/)).toBeVisible();
  expect(mailCount('nobody@example.test')).toBe(0);
  await other.getByRole('button', { name: 'Başka bir adres kullan' }).click();

  const before = mailCount(email);
  await other.getByLabel('E-posta adresi').fill(email.toUpperCase());
  await other.getByRole('button', { name: 'Kod gönder' }).click();
  await expect(other.getByText(/zeynep\.\*\*\*|ze\*\*\*@example\.test/)).toBeVisible();
  const code = await mailedCode(email, before);
  await other.getByLabel('Giriş kodu').fill('000000' === code ? '111111' : '000000');
  await other.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(other.getByRole('alert').filter({ hasText: 'Kod hatalı ya da süresi dolmuş' })).toBeVisible();
  await other.getByLabel('Giriş kodu').fill(code);
  await other.getByRole('button', { name: 'Giriş yap' }).click();

  await expect(other.getByText(`${email} ile giriş yaptınız.`)).toBeVisible();
  const list = other.getByTestId('account-orders');
  await expect(list.locator(':scope > li')).toHaveCount(1);
  await expect(list).toContainText('MOCK Kaleiçi Boutique');
  await expect(list).toContainText('Onaylandı');
  await list.getByRole('link', { name: 'Ayrıntılar' }).click();
  await expect(other).toHaveURL(new RegExp(`/tr/orders/${orderId}$`));
  await expect(other.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(other.getByTestId('booking-reference')).toHaveText(/^MOCK-BK-/);

  // Signing out closes the order again on this device.
  await other.goto('/tr/hesabim');
  await other.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(other.getByLabel('E-posta adresi')).toBeVisible();
  expect((await other.goto(`/tr/orders/${orderId}`))!.status()).toBe(404);
  await ctx.close();
});
