import { expect, test } from '@playwright/test';
import { alertIn, signIn, statusIn } from './admin-support';

/** Risk policy editing with four-eyes approval (G06, ADR-0007). Desktop only: it changes the shared policy. */
test('finance enters the first risk policy; invalid input is refused; an approver puts it into force', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared policy');
  page.on('dialog', (d) => void d.accept());
  await signIn(page, 'finance');
  await page.getByRole('navigation', { name: 'Yönetim menüsü' }).getByRole('link', { name: 'Risk politikası' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Risk politikası' })).toBeVisible();
  // No values are shipped: without an approved policy our own gateway stays closed.
  await expect(page.getByText('Onaylı bir risk politikası yok')).toBeVisible();

  await page.getByRole('link', { name: 'Yeni taslak oluştur' }).click();
  await expect(page).toHaveURL(/\/yonetim\/risk-politikasi\/yeni$/);
  await expect(page.getByLabel('EUR')).toHaveValue('');
  await expect(page.getByLabel('1. tercih')).toHaveValue('');
  // "12.50" is ambiguous in Turkish (12,50 or 1250?): refused, as is a missing funding choice. Nothing is created.
  await page.getByLabel('EUR').fill('12.50');
  await page.getByLabel('Provizyon güvenlik payı (saat)').fill('24');
  await page.getByRole('button', { name: 'Taslağı oluştur' }).click();
  await expect(alertIn(page)).toContainText('EUR: Tutarı para biriminin kuruş hassasiyetinde');
  await expect(alertIn(page)).toContainText('En az bir ödeme yöntemi seçin.');
  await expect(page).toHaveURL(/\/yeni$/);

  await page.getByLabel('EUR').fill('75.000');
  await page.getByLabel('1. tercih').selectOption({ label: 'Tedarikçi hesabındaki kart' });
  await page.getByLabel('Değişiklik notu').fill('İlk risk politikası');
  await page.getByRole('button', { name: 'Taslağı oluştur' }).click();
  await expect(page).toHaveURL(/\/yonetim\/risk-politikasi\/\d+$/);
  await expect(page.getByLabel('EUR')).toHaveValue('75000,00');
  await expect(page.getByRole('button', { name: 'Onayla ve yürürlüğe al' })).toHaveCount(0); // no self-approval permission

  const ctx = await browser.newContext();
  const approver = await ctx.newPage();
  approver.on('dialog', (d) => void d.accept());
  await signIn(approver, 'approver');
  await approver.goto('/yonetim/risk-politikasi');
  await approver.getByRole('link', { name: 'Taslağı aç' }).click();
  await expect(approver.getByTestId('risk-summary')).toContainText('EUR: 75.000,00');
  await expect(approver.getByTestId('risk-summary')).toContainText('Tedarikçi hesabındaki kart');
  await approver.getByRole('button', { name: 'Onayla ve yürürlüğe al' }).click();
  await expect(approver).toHaveURL(/durum=onaylandi/);
  await expect(statusIn(approver)).toContainText('yürürlüğe girdi (İki kişili onay).');
  await expect(approver.getByTestId('risk-summary')).toContainText('24');
  await expect(approver.getByTestId('risk-summary')).toContainText('TRY: Girilmedi');
  await ctx.close();
});
