import { expect, test, type Page } from '@playwright/test';

// Any uncaught page error fails the test, hydration mismatches included (server and browser must render the same).
let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('hotel booking with the provider-managed payment (MOCK): search → select → guest details → pay → confirmed', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/tr$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Otel arayın');
  await noHorizontalOverflow(page);

  await page.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await page.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await page.getByLabel('Çocuk', { exact: true }).selectOption('1');
  await page.getByLabel('Çocuk yaşı 1').selectOption('7');
  await page.getByRole('button', { name: 'Ara' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Sonuçlar' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'MOCK Kaleiçi Boutique' })).toBeVisible();
  // The suite priced below the hotel's suggested public price is not shown (rate parity).
  await expect(page.getByText('MOCK Suite')).toHaveCount(0);
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/ }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Rezervasyonu tamamlayın' })).toBeVisible();
  const total = await page.getByTestId('quote-total').innerText();
  await page.getByLabel('Ad', { exact: true }).fill('Ayşe');
  await page.getByLabel('Soyad', { exact: true }).fill('Yılmaz');
  await page.getByLabel('E-posta').fill('ayse@example.test');
  await page.getByLabel(/Telefon/).fill('+905321112233');
  const pay = page.getByRole('button', { name: 'Ödemeye geç' });
  await expect(pay).toBeDisabled();
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await noHorizontalOverflow(page);
  await pay.click();

  await expect(page.getByRole('heading', { level: 1, name: 'Ödeme' })).toBeVisible();
  await expect(page.getByTestId('quote-total')).toHaveText(total);
  await page.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();

  await expect(page).toHaveURL(/\/return$/);
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('booking-reference')).toHaveText(/^MOCK-BK-/);
});

test('the order page and APIs are closed to anyone without the order cookie', async ({ page, browser }) => {
  await page.goto('/tr');
  await page.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await page.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await page.getByRole('button', { name: /Seç: MOCK Lara Beach Resort/ }).first().click();
  await page.getByLabel('Ad', { exact: true }).fill('Can');
  await page.getByLabel('Soyad', { exact: true }).fill('Demir');
  await page.getByLabel('E-posta').fill('can@example.test');
  await page.getByLabel(/Telefon/).fill('+905321112244');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ödeme' })).toBeVisible();
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;

  const stranger = await browser.newContext();
  const res = await stranger.request.get(`/api/v1/orders/${orderId}/payment-session`);
  expect(res.status()).toBe(404);
  const pageRes = await (await stranger.newPage()).goto(`/tr/orders/${orderId}/payment`);
  expect(pageRes!.status()).toBe(404);
  // Cross-site POSTs are refused (CSRF).
  const csrf = await stranger.request.post(`/api/v1/orders/${orderId}/finalize`, { headers: { origin: 'https://evil.example' } });
  expect(csrf.status()).toBe(403);
  await stranger.close();
});

test('English pages and an unavailable currency route', async ({ page }) => {
  await page.goto('/en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find a hotel');
  // TRY needs our own payment gateway, which is not integrated yet (K13): it is not offered.
  await expect(page.getByLabel('Currency').locator('option')).toHaveText(['EUR', 'USD', 'GBP']);
});
