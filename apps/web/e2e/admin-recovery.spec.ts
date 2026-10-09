import { expect, test } from '@playwright/test';
import { E2E_ADMIN_PASSWORD } from './keys';
import { alertIn, nextCode, signIn } from './admin-support';

/** MFA recovery codes (ADR-0010): created with a current authenticator code, shown once, each works once. */
test('a person creates recovery codes and signs in with one when the phone is not at hand', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared account');
  page.on('dialog', (d) => void d.accept());
  await signIn(page, 'approver');
  await page.getByTestId('recovery-warning').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hesabım' })).toBeVisible();
  await expect(page.getByTestId('recovery-status')).toHaveText('Henüz kurtarma kodu oluşturmadınız.');

  // A wrong authenticator code creates nothing.
  await page.getByLabel('Doğrulama uygulamasındaki güncel kod').fill('000000');
  await page.getByRole('button', { name: 'Kurtarma kodlarını oluştur' }).click();
  await expect(alertIn(page)).toHaveText(/Doğrulama kodu kabul edilmedi/);
  await page.getByLabel('Doğrulama uygulamasındaki güncel kod').fill(await nextCode(page, 'approver'));
  await page.getByRole('button', { name: 'Kurtarma kodlarını oluştur' }).click();
  const shown = page.getByTestId('recovery-codes');
  await expect(shown.locator('code')).toHaveCount(10);
  await expect(shown).toContainText('Bu kodlar bir daha gösterilmez.');
  const code = (await shown.locator('code').first().innerText()).trim();
  expect(code).toMatch(/^[0-9a-z]{5}-[0-9a-z]{5}$/);
  await page.reload();
  await expect(page.getByTestId('recovery-codes')).toHaveCount(0); // shown once
  await expect(page.getByTestId('recovery-status')).toContainText('10 koddan 10 tanesi kullanılmadı.');

  // Sign out; sign in with the password and a recovery code instead of the authenticator.
  const viaRecovery = async (value: string) => {
    await page.goto('/yonetim/giris');
    await page.getByLabel('E-posta').fill('approver@e2e.test');
    await page.getByLabel('Şifre').fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Devam' }).click();
    await page.getByRole('link', { name: 'Telefonunuz yanınızda değil mi? Kurtarma kodu kullanın' }).click();
    await page.getByLabel('Kurtarma kodu').fill(value);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
  };
  await page.getByRole('button', { name: 'Çıkış' }).click();
  await viaRecovery(code.toUpperCase());
  await expect(page).toHaveURL(/\/yonetim\/hesap\?kurtarma=9$/);
  await expect(page.locator('#admin-main').getByRole('status')).toContainText('9 kodunuz kaldı');

  // The same code does not work twice.
  await page.getByRole('button', { name: 'Çıkış' }).click();
  await viaRecovery(code);
  await expect(page).toHaveURL(/\/yonetim\/giris\/kurtarma\?durum=hata$/);
  await expect(page.getByText('Kod kabul edilmedi.')).toBeVisible();
});
