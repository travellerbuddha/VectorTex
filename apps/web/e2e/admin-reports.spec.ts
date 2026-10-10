import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * /yonetim reports (P15b, P17c): each report only for the permissions it needs. Finance staff get the finance report
 * and its line CSV (no personal data); content editors get the content reports but not the finance one.
 */
test('reports: finance report and CSV for orders.view_financials only', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'panel screens');
  await signIn(page, 'finance');
  await page.getByRole('navigation', { name: 'Yönetim menüsü' }).getByRole('link', { name: 'Raporlar' }).click();
  await expect(page).toHaveURL(/\/yonetim\/raporlar$/);
  await expect(page.getByRole('link', { name: 'Finans raporu' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reklam sayfa feed’i' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Finans raporu' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Finans raporu' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bu ay' })).toHaveAttribute('aria-current', 'page');

  // A wrong period is refused, not guessed.
  await page.goto('/yonetim/raporlar/finans?bas=2026-03-02&bit=2026-03-01');
  await expect(page.getByRole('alert').filter({ hasText: 'Tarihleri kontrol edin' })).toBeVisible();

  await page.getByRole('link', { name: 'Son 30 gün' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Siparişler (müşteri tutarı)' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Satır bazında CSV indir' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^texholiday-finans-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toBe(
    'order_id,created_at_utc,order_status,item,product,provider,funding,booking_status,provider_booking_ref,currency,charge,supplier_currency,supplier_price,commission_currency,commission,commission_status,refunded_currency,refunded,payment_status',
  );
  expect(csv).not.toMatch(/@/); // no e-mail addresses

  // Content editors: content reports, no finance report, no CSV.
  const ctx = await browser.newContext();
  const editor = await ctx.newPage();
  await signIn(editor, 'editor');
  await editor.goto('/yonetim/raporlar');
  await expect(editor.getByRole('link', { name: 'Liste fiyatı doğruluğu' })).toBeVisible();
  await expect(editor.getByRole('link', { name: 'Finans raporu' })).toHaveCount(0);
  await editor.goto('/yonetim/raporlar/finans');
  await expect(editor.getByText('Bu sayfayı görüntüleme izniniz yok.')).toBeVisible();
  const refused = await editor.evaluate(async () => (await fetch('/api/v1/staff/finance-report?from=2026-01-01&to=2026-01-31', { credentials: 'same-origin' })).status);
  expect(refused).toBe(403);
  await ctx.close();
});
