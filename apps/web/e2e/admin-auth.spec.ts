import { expect, test, type Page } from '@playwright/test';
import { base32Decode, hotp, totpStep } from '@texholiday/admin';

/** /yonetim sign-in with mandatory MFA (ADR-0010). Each project onboards its own account (setup links are single-use). */
const PASSWORD = 'a long staff passphrase 2027';
// The second test signs in to the account the first one created.
test.describe.configure({ mode: 'serial' });
const codeFor = (secret: string, stepOffset = 0) => hotp(base32Decode(secret), totpStep(new Date()) + stepOffset);

/** Our own alerts (Next.js adds an empty route-announcer alert of its own outside the main area). */
const alert = (page: Page) => page.locator('#admin-main').getByRole('alert');

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('staff onboarding and sign-in: invite link → password → authenticator → panel; wrong password; sign out', async ({ page }, info) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const setupToken = process.env[`E2E_SETUP_TOKEN_${info.project.name}`];
  expect(setupToken).toBeTruthy();
  const email = info.project.name === 'desktop' ? 'owner@e2e.test' : 'mobile@e2e.test';

  // Nothing is reachable without a session.
  await page.goto('/yonetim');
  await expect(page).toHaveURL(/\/yonetim\/giris/);
  await expect(page.getByRole('heading', { level: 1, name: 'Yönetim girişi' })).toBeVisible();
  await noHorizontalOverflow(page);

  // Invite link: choose a password (mismatch first).
  await page.goto(`/yonetim/kurulum/${setupToken}`);
  await expect(page.getByRole('heading', { level: 1, name: /Hesabınızı kurun/ })).toBeVisible();
  await page.getByLabel('Yeni şifre', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Yeni şifre (tekrar)').fill(`${PASSWORD}x`);
  await page.getByRole('button', { name: 'Şifreyi kaydet' }).click();
  await expect(alert(page)).toHaveText('İki şifre aynı değil.');
  await page.getByLabel('Yeni şifre', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Yeni şifre (tekrar)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Şifreyi kaydet' }).click();

  // Authenticator enrollment: QR code + manual key; a wrong code first.
  await expect(page).toHaveURL(/\/yonetim\/giris\/mfa-kurulum/);
  await expect(page.getByRole('img', { name: 'Authenticator uygulaması için QR kod' })).toBeVisible();
  await noHorizontalOverflow(page);
  const secret = (await page.getByTestId('mfa-secret').innerText()).replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('Kod', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Kurulumu tamamla' }).click();
  await expect(alert(page)).toContainText('Kod doğrulanamadı');
  await expect(page.getByTestId('mfa-secret')).toHaveText(/./); // same secret shown again
  expect((await page.getByTestId('mfa-secret').innerText()).replace(/\s/g, '')).toBe(secret);
  await page.getByLabel('Kod', { exact: true }).fill(codeFor(secret));
  await page.getByRole('button', { name: 'Kurulumu tamamla' }).click();

  await expect(page).toHaveURL(/\/yonetim$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Hoş geldiniz, E2E (Owner|Mobile)$/);
  if (info.project.name === 'mobile-320') await expect(page.getByText('Hesabınıza henüz bir izin verilmemiş')).toBeVisible();
  await noHorizontalOverflow(page);

  // English and back.
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Welcome, E2E/);
  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Hoş geldiniz/);

  // Sign out ends the session.
  await page.getByRole('button', { name: 'Çıkış' }).click();
  await expect(page.getByText('Çıkış yaptınız.')).toBeVisible();
  await page.goto('/yonetim');
  await expect(page).toHaveURL(/\/yonetim\/giris/);

  // Wrong password: one generic message.
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill('not the password at all');
  await page.getByRole('button', { name: 'Devam' }).click();
  await expect(alert(page)).toHaveText(/Giriş yapılamadı/);

  // Password + a fresh code (the enrollment code cannot be reused).
  await page.getByLabel('E-posta').fill(email);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Devam' }).click();
  await expect(page).toHaveURL(/\/yonetim\/giris\/kod/);
  // Before the code the panel stays closed.
  await page.goto('/yonetim');
  await expect(page).toHaveURL(/\/yonetim\/giris\/kod/);
  await page.getByLabel('Kod', { exact: true }).fill(codeFor(secret, 1));
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL(/\/yonetim$/);
  await expect(page.getByTestId('staff-name')).toHaveText(/E2E/);
  expect(pageErrors).toEqual([]);
});

test('the staff session cookie is httpOnly and same-site strict; a used setup link is dead', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'one check is enough');
  await page.goto(`/yonetim/kurulum/${process.env.E2E_SETUP_TOKEN_desktop}`);
  await expect(alert(page)).toContainText('geçersiz, kullanılmış ya da süresi dolmuş');
  await page.goto('/yonetim/giris');
  await page.getByLabel('E-posta').fill('owner@e2e.test');
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Devam' }).click();
  await expect(page).toHaveURL(/\/yonetim\/giris\/kod/);
  const cookie = (await context.cookies()).find((c) => c.name === 'th_staff');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
});
