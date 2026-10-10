import { expect, test, type Page } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * Online cancellation by the customer (T27, ADR-0021) on MOCK bookings: the expected fee is shown, a confirmation is
 * required, the booking is cancelled at the provider and the status follows; a non-refundable booking is not offered.
 */
async function bookMock(page: Page, choice: RegExp, surname: string): Promise<string> {
  await page.goto('/tr');
  await page.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await page.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await page.getByRole('button', { name: choice }).click();
  await page.getByLabel('Ad', { exact: true }).fill('Deniz');
  await page.getByLabel('Soyad', { exact: true }).fill(surname);
  await page.getByLabel('E-posta').fill(`deniz.${surname.toLowerCase()}@example.test`);
  await page.getByLabel(/Telefon/).fill('+905321112233');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await page.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  return page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;
}

test('the customer cancels a free-cancellation booking from the order page', async ({ page, browser }, info) => {
  test.setTimeout(90_000);
  const orderId = await bookMock(page, /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/, 'Iptalci');
  await page.goto(`/tr/orders/${orderId}`);
  const box = page.getByTestId('cancel-booking');
  await expect(box.getByRole('heading', { name: 'Rezervasyonu iptal et' })).toBeVisible();
  await expect(box.getByTestId('cancel-fee')).toContainText('tarihine kadar ücretsiz iptal edebilirsiniz');
  const submit = box.getByRole('button', { name: 'Rezervasyonu iptal et' });
  // Nothing is sent without the explicit confirmation.
  await expect(submit).toBeDisabled();
  await box.getByRole('checkbox', { name: 'Rezervasyonumu iptal etmek istiyorum.' }).check();
  await submit.click();
  await expect(page.getByText('Rezervasyonunuz iptal edildi.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cancel-booking')).toHaveCount(0);
  // Reloading shows the same: cancelled, nothing more to do.
  await page.reload();
  await expect(page.getByText('Rezervasyonunuz iptal edildi.')).toBeVisible();
  await expect(page.getByTestId('cancel-booking')).toHaveCount(0);
  // The API refuses a second cancellation and cross-site requests.
  const again = await page.evaluate(async (id) => {
    const r = await fetch(`/api/v1/orders/${id}/cancellation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acceptedFee: { currency: 'EUR', minor: '0' } }) });
    return { status: r.status, code: ((await r.json()) as { code: string }).code };
  }, orderId);
  expect(again).toEqual({ status: 409, code: 'ILLEGAL_TRANSITION' });
  const crossSite = await page.request.post(`/api/v1/orders/${orderId}/cancellation`, { headers: { origin: 'https://evil.example' }, data: { acceptedFee: { currency: 'EUR', minor: '0' } } });
  expect(crossSite.status()).toBe(403);

  // Staff see who cancelled in the order's timeline.
  if (info.project.name !== 'desktop') return;
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin');
  await admin.goto(`/yonetim/siparisler/${orderId}`);
  await expect(admin.locator('.timeline li').filter({ hasText: 'İptal istendi' })).toContainText('Müşteri (site)');
  await admin.context().close();
});

test('a non-refundable booking is not offered online cancellation', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const orderId = await bookMock(page, /Seç: MOCK Lara Beach Resort – MOCK Standard Room/, 'Iadesiz');
  await page.goto(`/tr/orders/${orderId}`);
  await expect(page.getByTestId('cancel-not-available')).toHaveText(/iade yapılmıyor; bu nedenle çevrimiçi iptal edilemez/);
  await expect(page.getByRole('button', { name: 'Rezervasyonu iptal et' })).toHaveCount(0);
  // Another browser (no order cookie) can neither see nor cancel the order.
  const stranger = await (await browser.newContext()).newPage();
  expect((await stranger.goto(`/tr/orders/${orderId}`))!.status()).toBe(404);
  const r = await stranger.request.get(`/api/v1/orders/${orderId}/cancellation`);
  expect(r.status()).toBe(404);
  await stranger.context().close();
});
