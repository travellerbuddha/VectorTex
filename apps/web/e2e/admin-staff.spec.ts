import { expect, test } from '@playwright/test';
import { alertIn, onboard, signInAdmin, statusIn } from './admin-support';

/** Staff accounts and permissions in /yonetim (ADR-0007, ADR-0010). Desktop only: it changes shared accounts. */
test('invite, role preset, revoke, a restricted colleague, disable', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared accounts');
  page.on('dialog', (d) => void d.accept());
  await signInAdmin(page);
  await page.getByRole('navigation', { name: 'Yönetim menüsü' }).getByRole('link', { name: 'Personel ve izinler' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Personel ve izinler' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'owner@e2e.test' })).toBeVisible();

  // Invite: the one-time link is shown once.
  await page.getByLabel('Ad soyad').fill('Ops Kişi');
  await page.getByLabel('E-posta').fill('ops@e2e.test');
  await page.getByRole('button', { name: 'Davet bağlantısı oluştur' }).click();
  await expect(statusIn(page)).toHaveText('Ops Kişi için davet bağlantısı oluşturuldu.');
  const link = await page.getByTestId('one-time-link').inputValue();
  expect(link).toMatch(/\/yonetim\/kurulum\/[A-Za-z0-9_-]{43}$/);
  // The same email cannot be invited twice.
  await page.getByLabel('Ad soyad').fill('Ops Again');
  await page.getByLabel('E-posta').fill('OPS@e2e.test');
  await page.getByRole('button', { name: 'Davet bağlantısı oluştur' }).click();
  await expect(alertIn(page)).toHaveText('Bu e-posta ile bir personel hesabı zaten var.');

  // Role preset, then revoke one permission (history keeps both).
  await page.reload();
  await page.getByRole('link', { name: 'Ops Kişi' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ops Kişi' })).toBeVisible();
  await page.getByLabel('Rol').selectOption({ label: 'Operasyon' });
  await page.getByRole('button', { name: 'Paketi uygula' }).click();
  await expect(statusIn(page)).toHaveText('2 izin verildi.');
  await page.reload();
  const active = page.locator('.perm-list');
  await expect(active.getByText('Siparişleri, misafir bilgilerini ve operasyon görevlerini görüntüleme')).toBeVisible();
  await expect(active.getByText('Operasyon görevlerini üstlenme ve gerekçeyle kapatma')).toBeVisible();
  await active.locator('li', { hasText: 'tasks.manage' }).getByRole('button', { name: 'Geri al' }).click();
  // The revoked permission leaves the active list at once (its row, with the form, disappears).
  await expect(active.getByText('tasks.manage')).toHaveCount(0);
  await page.reload();
  await expect(active.getByText('tasks.manage')).toHaveCount(0);
  await expect(page.locator('table').getByRole('cell', { name: /Operasyon görevlerini üstlenme/ })).toBeVisible();

  // The colleague onboards in their own browser; without staff.manage/permissions.manage the page is closed.
  const other = await browser.newContext();
  const colleague = await other.newPage();
  await onboard(colleague, link, 'ops colleague passphrase');
  await expect(colleague.getByRole('navigation', { name: 'Yönetim menüsü' }).getByRole('link', { name: 'Personel ve izinler' })).toHaveCount(0);
  await colleague.goto('/yonetim/personel');
  await expect(colleague.getByText('Bu sayfayı görüntüleme izniniz yok.')).toBeVisible();

  // Disabling ends the colleague's session at once.
  await page.getByLabel('Gerekçe').fill('e2e test');
  await page.getByRole('button', { name: 'Hesabı kapat' }).click();
  // The page re-renders for a disabled account: status "Kapalı" and the enable action.
  await expect(page.getByRole('button', { name: 'Hesabı yeniden aç' })).toBeVisible();
  await expect(page.locator('dl.facts')).toContainText('Kapalı');
  await colleague.goto('/yonetim');
  await expect(colleague).toHaveURL(/\/yonetim\/giris/);
  await other.close();
});
