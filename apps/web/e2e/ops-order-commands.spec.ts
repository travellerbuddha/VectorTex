import { expect, test } from '@playwright/test';
import { alertIn, signIn, statusIn } from './admin-support';

/**
 * Order commands in /yonetim on a real (MOCK) booking: check status, cancel at the provider, record the refund the
 * provider made. The customer's status page follows.
 */
test('staff checks, cancels and records the provider refund; the customer sees the cancellation', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared data');
  const customer = await (await browser.newContext()).newPage();
  await customer.goto('/tr');
  await customer.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await customer.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await customer.getByRole('button', { name: 'Ara' }).click();
  await customer.getByRole('button', { name: /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/ }).click();
  await customer.getByLabel('Ad', { exact: true }).fill('Kemal');
  await customer.getByLabel('Soyad', { exact: true }).fill('İptaltest');
  await customer.getByLabel('E-posta').fill('kemal@example.test');
  await customer.getByLabel(/Telefon/).fill('+905321112233');
  await customer.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await customer.getByRole('button', { name: 'Ödemeye geç' }).click();
  await customer.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();
  await expect(customer.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  const orderUrl = customer.url();
  const orderId = orderUrl.match(/orders\/([0-9a-f-]{36})/)![1]!;

  page.on('dialog', (d) => void d.accept());
  await signIn(page, 'admin');
  await page.goto(`/yonetim/siparisler/${orderId}`);
  const commands = page.getByTestId('order-commands');

  // Check status: the provider still holds the booking.
  await commands.getByRole('button', { name: 'Durumu kontrol et' }).click();
  await expect(statusIn(page)).toHaveText('Kontrol edildi: değişiklik yok (Onaylandı).');

  // Cancel with a reason; the expected fee is shown first (free cancellation for this offer).
  await expect(commands.getByTestId('cancel-preview')).toContainText('Şimdi iptal edilirse beklenen iptal ücreti: €0,00');
  await expect(commands.getByLabel('Müşteri bu iptal ücretini kabul etti')).toHaveCount(0);
  await commands.getByLabel('İptal gerekçesi').fill('Misafir telefonla iptal istedi.');
  await commands.getByRole('button', { name: 'Rezervasyonu iptal et' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('İptal');
  await expect(page.getByText('İade sürüyor', { exact: true })).toBeVisible();
  const task = page.getByTestId('task').filter({ hasText: 'İade sonucu belirsiz' });
  await expect(task).toContainText('İadeyi kaydet');
  await expect(page.locator('.timeline')).toContainText('İptal istendi');
  await expect(page.locator('.timeline')).toContainText('Rezervasyon Nuitee’de iptal edildi');
  await expect(commands.getByRole('button', { name: 'Rezervasyonu iptal et' })).toHaveCount(0);

  // Record the refund: an ambiguous amount is refused, a partial refund is kept, an excess is refused.
  await commands.getByLabel(/İade tutarı/).fill('12.50');
  await commands.getByLabel('Nerede doğrulandı?').fill('Nuitee panel');
  await commands.getByRole('button', { name: 'İadeyi kaydet' }).click();
  await expect(alertIn(page)).toHaveText('Tutarı Türkçe yazımla ve para biriminin kuruş hassasiyetinde girin (ör. 1.250,50).');
  await commands.getByLabel(/İade tutarı/).fill('10,00');
  await commands.getByRole('button', { name: 'İadeyi kaydet' }).click();
  await expect(page.getByTestId('refunds')).toContainText('Nuitee panel');
  await expect(page.getByText('Kısmi iade', { exact: true })).toBeVisible();
  await commands.getByLabel(/İade tutarı/).fill('999.999,00');
  await commands.getByLabel('Nerede doğrulandı?').fill('Banka dekontu');
  await commands.getByRole('button', { name: 'İadeyi kaydet' }).click();
  await expect(alertIn(page)).toHaveText('Kayıtlı iadelerin toplamı müşterinin ödediği tutarı aşamaz.');

  // The customer's status page shows the cancellation.
  await customer.goto(orderUrl);
  await expect(customer.getByText('Rezervasyonunuz iptal edildi.')).toBeVisible();
});
