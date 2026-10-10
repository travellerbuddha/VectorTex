import { expect, test } from '@playwright/test';
import { alertIn, signIn, statusIn } from './admin-support';

/** Pricing policy editing with four-eyes approval (G06, ADR-0007). Desktop only: it changes the shared policy. */
test('finance drafts a new margin, cannot approve it; an approver puts it into force', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared policy');
  page.on('dialog', (d) => void d.accept());
  await signIn(page, 'finance');
  await page.getByRole('navigation', { name: 'Yönetim menüsü' }).getByRole('link', { name: 'Fiyat politikası' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Fiyat politikası' })).toBeVisible();
  // Version 1 from the test setup: hotel 10 % when Nuitee collects.
  await expect(page.getByTestId('active-version')).toContainText('Sürüm 1');
  const hotelRow = page.getByTestId('margin-table').getByRole('row', { name: /Otel Nuitee tahsil eder/ });
  await expect(hotelRow).toContainText('%10');
  await expect(page.getByRole('button', { name: 'Yürürlükten kaldır' })).toHaveCount(0); // finance cannot withdraw

  await page.getByRole('button', { name: 'Yeni taslak oluştur' }).click();
  await expect(page).toHaveURL(/\/yonetim\/fiyat-politikasi\/2$/);
  const slot = page.getByTestId('slot-HOTEL-PROVIDER_MANAGED');
  await expect(slot.getByLabel('Oran (%)')).toHaveValue('10');
  // Invalid rate first: reported, nothing saved.
  await slot.getByLabel('Oran (%)').fill('150');
  await page.getByRole('button', { name: 'Taslağı kaydet' }).click();
  await expect(alertIn(page)).toContainText('Otel · Nuitee tahsil eder: Oran 0 ile 100 arasında');
  await slot.getByLabel('Oran (%)').fill('12,5');
  await page.getByLabel('Değişiklik notu').fill('Sezon marjı');
  await page.getByRole('button', { name: 'Taslağı kaydet' }).click();
  await expect(statusIn(page)).toHaveText('Taslak kaydedildi.');
  // The author cannot approve alone (no self-approval permission): no approve button.
  await expect(page.getByRole('button', { name: 'Onayla ve yürürlüğe al' })).toHaveCount(0);

  const ctx = await browser.newContext();
  const approver = await ctx.newPage();
  approver.on('dialog', (d) => void d.accept());
  await signIn(approver, 'approver');
  await approver.goto('/yonetim/fiyat-politikasi');
  await approver.getByRole('link', { name: 'Taslağı aç' }).click();
  await expect(approver.getByText('Bu taslağı başka biri hazırladı')).toBeVisible();
  await expect(approver.getByTestId('margin-table')).toContainText('%12,5'); // approvers see, but do not edit
  await approver.getByRole('button', { name: 'Onayla ve yürürlüğe al' }).click();
  await expect(approver).toHaveURL(/durum=onaylandi/);
  await expect(statusIn(approver)).toHaveText('Sürüm 2 yürürlüğe girdi (İki kişili onay).');
  await expect(approver.getByTestId('active-version')).toContainText('Sürüm 2');
  await expect(approver.getByTestId('margin-table').getByRole('row', { name: /Otel Nuitee tahsil eder/ })).toContainText('%12,5');
  await ctx.close();
});
