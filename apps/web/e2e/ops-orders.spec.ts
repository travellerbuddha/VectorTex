import { expect, test } from '@playwright/test';
import pg from 'pg';
import { signIn } from './admin-support';

/** Operations screens (§16): a real (MOCK) booking found in /yonetim, its detail, and an operation task closed. */
test('a booking appears in the panel; its task is taken and closed with a note', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared data');
  // A customer books on the site (MOCK provider).
  const customer = await (await browser.newContext()).newPage();
  await customer.goto('/tr');
  await customer.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await customer.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await customer.getByRole('button', { name: 'Ara' }).click();
  await customer.getByRole('button', { name: /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/ }).click();
  await customer.getByLabel('Ad', { exact: true }).fill('Zeynep');
  await customer.getByLabel('Soyad', { exact: true }).fill('Operasyontest');
  await customer.getByLabel('E-posta').fill('zeynep@example.test');
  await customer.getByLabel(/Telefon/).fill('+905321110000');
  await customer.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await customer.getByRole('button', { name: 'Ödemeye geç' }).click();
  await customer.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();
  await expect(customer.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  const bookingRef = (await customer.getByTestId('booking-reference').innerText()).trim();
  const orderId = customer.url().match(/orders\/([0-9a-f-]{36})/)![1]!;

  // An operation task on that order (as the system would open it).
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  await db.query(`INSERT INTO core.operation_tasks (order_id, reason, detail) VALUES ($1, 'PROVIDER_PAYMENT_HOLD', 'e2e task')`, [orderId]);
  await db.end();

  page.on('dialog', (d) => void d.accept());
  await signIn(page, 'admin');
  await expect(page.getByTestId('ops-stats')).toContainText('Görevler');
  await page.getByRole('navigation', { name: 'Yönetim menüsü' }).getByRole('link', { name: 'Siparişler' }).click();
  await page.getByLabel('Ara').fill('operasyontest');
  await page.getByRole('button', { name: 'Listele' }).click();
  const rows = page.getByTestId('orders-table').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('MOCK Kaleiçi Boutique');
  await expect(rows.first()).toContainText('Zeynep Operasyontest');
  await expect(rows.first()).toContainText(bookingRef);
  await rows.first().getByRole('link', { name: orderId.slice(0, 8) }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Sipariş ${orderId.slice(0, 8)}`);
  await expect(page.getByTestId('provider-ref')).toHaveText(bookingRef);
  await expect(page.getByTestId('financials')).toContainText('Nuitee komisyonu');
  await expect(page.getByText('Zeynep Operasyontest · zeynep@example.test')).toBeVisible();

  // The task: what to do, take it, close it with a note; the timeline records both.
  const task = page.getByTestId('task');
  await expect(task).toContainText('Ödeme provizyonu olabilir, rezervasyon yok');
  await expect(task).toContainText('1-2 iş günü');
  await task.getByRole('button', { name: 'Üstlen' }).click();
  await expect(task).toContainText('E2E Admin');
  await task.getByLabel('Ne yapıldı?').fill('Müşteri arandı, bilgilendirildi.');
  await task.getByRole('button', { name: 'Görevi kapat' }).click();
  await expect(task).toContainText('Kapanmış');
  await expect(page.locator('.timeline')).toContainText('Görev kapatıldı: Ödeme provizyonu olabilir, rezervasyon yok');

  await page.getByRole('navigation', { name: 'Yönetim menüsü' }).getByRole('link', { name: 'Görevler' }).click();
  await page.getByRole('link', { name: 'Kapanmış' }).click();
  await expect(page.getByTestId('task').filter({ hasText: 'Müşteri arandı, bilgilendirildi.' })).toBeVisible();
});
