import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * Automated accessibility audit (T33): axe-core with the WCAG 2.0/2.1/2.2 A and AA rules on the customer pages of the
 * hotel flow and the main panel pages, desktop and 320 px. Automated rules find about a third of the problems; screen
 * reader and keyboard checks by a person are still needed (docs/plan/test-matrisi.md, T33).
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

async function audit(page: Page, name: string): Promise<string[]> {
  // The Payload editor and the provider's payment component are third-party and audited by their makers.
  const result = await new AxeBuilder({ page }).withTags(TAGS).exclude('#nuitee-payment').analyze();
  // Rules really ran on this page (an empty result would hide a broken audit).
  expect(result.passes.length, `${name}: no axe rule passed`).toBeGreaterThan(10);
  return result.violations.map((v) => `${name}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
}

test('customer pages of the hotel flow have no automatically detectable WCAG A/AA violations', async ({ page }) => {
  test.setTimeout(120_000);
  const found: string[] = [];
  await page.goto('/tr');
  found.push(...(await audit(page, '/tr')));
  await page.goto('/en');
  found.push(...(await audit(page, '/en')));

  await page.goto('/tr');
  await page.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await page.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sonuçlar' })).toBeVisible();
  found.push(...(await audit(page, 'search results')));

  await page.getByRole('button', { name: /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rezervasyonu tamamlayın' })).toBeVisible();
  found.push(...(await audit(page, 'checkout')));
  await page.getByLabel('Ad', { exact: true }).fill('Erişim');
  await page.getByLabel('Soyad', { exact: true }).fill('Denetimi');
  await page.getByLabel('E-posta').fill('erisim@example.test');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  // The form with a field error from the server shown.
  await page.getByLabel(/Telefon/).fill('12345');
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
  found.push(...(await audit(page, 'checkout with a field error')));
  await page.getByLabel(/Telefon/).fill('+905321112233');
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ödeme' })).toBeVisible();
  found.push(...(await audit(page, 'payment')));
  await page.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  found.push(...(await audit(page, 'confirmation')));
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;
  await page.goto(`/tr/orders/${orderId}`);
  await expect(page.getByTestId('cancel-booking')).toBeVisible();
  found.push(...(await audit(page, 'order page with cancellation')));

  for (const path of ['/tr/hesabim', '/en/account', '/tr/cerez-politikasi', '/tr/flights', '/tr/sss', '/tr/rehber']) {
    await page.goto(path);
    found.push(...(await audit(page, path)));
  }
  // A missing page keeps the site's language and layout.
  for (const [path, title] of [['/tr/bu-sayfa-yok', 'Sayfa bulunamadı'], ['/en/no-such-page', 'Page not found']] as const) {
    expect((await page.goto(path))!.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    found.push(...(await audit(page, path)));
  }
  expect(found, found.join('\n')).toEqual([]);
});

test('flight results and the passenger form have no automatically detectable WCAG A/AA violations', async ({ page }) => {
  test.setTimeout(90_000);
  const found: string[] = [];
  await page.goto('/tr/flights');
  await page.getByRole('combobox', { name: 'Nereden' }).fill('Ist');
  await page.getByRole('option', { name: /IST · Istanbul/ }).click();
  await page.getByRole('combobox', { name: 'Nereye' }).fill('Antalya');
  await page.getByRole('option', { name: /AYT · Antalya/ }).click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Uçuşlar' })).toBeVisible();
  found.push(...(await audit(page, 'flight results')));
  await page.getByRole('button', { name: /^Seç:/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Yolcu bilgileri' })).toBeVisible();
  found.push(...(await audit(page, 'flight passengers')));
  expect(found, found.join('\n')).toEqual([]);
});

test('panel pages have no automatically detectable WCAG A/AA violations', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'staff work on desktop; the panel is checked once');
  test.setTimeout(120_000);
  const found: string[] = [];
  await page.goto('/yonetim/giris');
  found.push(...(await audit(page, '/yonetim/giris')));
  await signIn(page, 'admin');
  for (const path of ['/yonetim', '/yonetim/siparisler', '/yonetim/gorevler', '/yonetim/personel', '/yonetim/fiyat-politikasi', '/yonetim/risk-politikasi', '/yonetim/raporlar', '/yonetim/raporlar/komisyonlar', '/yonetim/raporlar/finans', '/yonetim/hesap']) {
    const res = await page.goto(path);
    expect(res!.status(), path).toBeLessThan(400);
    found.push(...(await audit(page, path)));
  }
  // An order's detail page, when there is one.
  const first = page.locator('a[href^="/yonetim/siparisler/"]').first();
  await page.goto('/yonetim/siparisler');
  if ((await first.count()) > 0) {
    await first.click();
    await expect(page.locator('.timeline')).toBeVisible();
    found.push(...(await audit(page, 'order detail')));
  }
  expect(found, found.join('\n')).toEqual([]);
});
