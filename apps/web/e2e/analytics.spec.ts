import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * Tracking and cookie consent (ADR-0018) with a test GTM container. The tag file is answered locally (no request
 * leaves the machine); the test counts how often it is asked for. Consent Mode v2 defaults are "denied" before any
 * tag; BASIC mode loads GTM only after a choice that allows it; the choice persists; GA4 e-commerce events reach the
 * dataLayer once, without personal data. The settings are cleared at the end so the banner does not cover other tests.
 */
const GTM = 'GTM-E2ETEST1';
const VERIFICATION = 'e2e-search-console-0123';

async function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    },
    { method, path, body },
  );
}

/** The dataLayer as plain JSON (gtag calls are `arguments` objects). */
const dataLayer = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []).map((x) => (Object.prototype.toString.call(x) === '[object Arguments]' ? Array.from(x as ArrayLike<unknown>) : x)),
  ) as Promise<unknown[]>;

const events = async (page: Page, name: string) => (await dataLayer(page)).filter((x) => (x as { event?: string }).event === name) as Array<Record<string, unknown>>;

async function stubTags(context: BrowserContext) {
  const loads: string[] = [];
  await context.route('https://www.googletagmanager.com/**', (route) => {
    loads.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* e2e: tag manager stub */' });
  });
  return loads;
}

const consentCookie = async (context: BrowserContext) => {
  const c = (await context.cookies()).find((x) => x.name === 'th_consent');
  return c ? (JSON.parse(decodeURIComponent(c.value)) as { a: boolean; m: boolean }) : null;
};

let admin: Page | null = null;

test.afterAll(async () => {
  if (!admin) return;
  const cleared = await call(admin, 'POST', '/api/cms/globals/tracking-settings', { gtmContainerId: null, ga4MeasurementId: null, searchConsoleVerification: null, consentMode: 'BASIC' });
  expect(cleared.status, JSON.stringify(cleared.json)).toBe(200);
  await admin.context().close();
  admin = null;
});

test('consent: denied by default, tags only after consent, stored choice, Search Console tag, GA4 e-commerce events', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'site-wide settings');
  test.setTimeout(120_000);

  // Without an id nothing is loaded and no banner is shown.
  const plain = await browser.newPage();
  await plain.goto('/tr');
  await expect(plain.getByTestId('consent-banner')).toHaveCount(0);
  expect(await plain.evaluate(() => 'dataLayer' in window)).toBe(false);
  await plain.context().close();

  admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin');
  // Malformed ids are refused.
  expect((await call(admin, 'POST', '/api/cms/globals/tracking-settings', { gtmContainerId: 'UA-1234' })).status).toBe(400);
  expect((await call(admin, 'POST', '/api/cms/globals/tracking-settings', { searchConsoleVerification: '<meta name="x">' })).status).toBe(400);
  const saved = await call(admin, 'POST', '/api/cms/globals/tracking-settings', { gtmContainerId: GTM, consentMode: 'BASIC', searchConsoleVerification: VERIFICATION });
  expect(saved.status, JSON.stringify(saved.json)).toBe(200);

  const context = await browser.newContext();
  const loads = await stubTags(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/tr');

  // Search Console HTML tag method.
  await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute('content', VERIFICATION);
  // Consent Mode v2: everything denied before any tag; BASIC loads nothing yet.
  const banner = page.getByTestId('consent-banner');
  await expect(banner).toBeVisible();
  const first = (await dataLayer(page))[0];
  expect(first).toEqual(['consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', functionality_storage: 'granted', security_storage: 'granted', wait_for_update: 500 }]);
  expect(loads).toEqual([]);

  // Reject: stored, still nothing loaded, banner gone on the next page too.
  await banner.getByRole('button', { name: 'Reddet' }).click();
  await expect(banner).toHaveCount(0);
  expect(await consentCookie(context)).toMatchObject({ a: false, m: false });
  expect(await dataLayer(page)).toContainEqual(['consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
  await page.reload();
  await expect(page.getByTestId('consent-banner')).toHaveCount(0);
  expect(loads).toEqual([]);

  // Change of mind from the footer: analytics only.
  await page.getByRole('button', { name: 'Çerez tercihleri' }).click();
  await expect(banner).toBeVisible();
  await banner.getByRole('checkbox', { name: /Analiz/ }).check();
  await expect(banner.getByRole('checkbox', { name: /Pazarlama/ })).not.toBeChecked();
  await banner.getByRole('button', { name: 'Seçimi kaydet' }).click();
  await expect(banner).toHaveCount(0);
  expect(await consentCookie(context)).toMatchObject({ a: true, m: false });
  await expect.poll(() => loads.length).toBe(1);
  expect(loads[0]).toBe(`https://www.googletagmanager.com/gtm.js?id=${GTM}`);
  expect(await dataLayer(page)).toContainEqual({ event: 'consent_update', consent_analytics: true, consent_marketing: false });

  // Next visit: the stored choice is applied by the inline bootstrap before GTM starts.
  await page.reload();
  const after = await dataLayer(page);
  const update = after.findIndex((x) => Array.isArray(x) && x[0] === 'consent' && x[1] === 'update');
  const start = after.findIndex((x) => (x as { event?: string }).event === 'gtm.js');
  expect(after[update]).toEqual(['consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
  expect(update).toBeGreaterThan(0);
  expect(start).toBeGreaterThan(update);

  // E-commerce: search results → checkout → payment → purchase (MOCK provider).
  await page.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await page.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sonuçlar' })).toBeVisible();
  await expect.poll(async () => (await events(page, 'view_item_list')).length).toBe(1);
  const list = (await events(page, 'view_item_list'))[0]!.ecommerce as { item_list_id: string; currency: string; items: Array<{ item_id: string; price: number }> };
  expect(list.item_list_id).toBe('search_results');
  expect(list.currency).toBe('EUR');
  expect(list.items.length).toBeGreaterThan(0);
  expect(typeof list.items[0]!.price).toBe('number');
  expect(await events(page, 'search')).toEqual([expect.objectContaining({ search_term: 'Antalya (MOCK)' })]);

  await page.getByRole('button', { name: /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rezervasyonu tamamlayın' })).toBeVisible();
  await expect.poll(async () => (await events(page, 'begin_checkout')).length).toBe(1);
  const checkout = (await events(page, 'begin_checkout'))[0]!.ecommerce as { currency: string; value: number; items: Array<{ item_name: string }> };
  expect(checkout).toMatchObject({ currency: 'EUR', items: [{ item_name: 'MOCK Kaleiçi Boutique', item_category: 'Hotel', quantity: 1 }] });

  await page.getByLabel('Ad', { exact: true }).fill('Ayşe');
  await page.getByLabel('Soyad', { exact: true }).fill('Yılmaz');
  await page.getByLabel('E-posta').fill('ayse.analytics@example.test');
  await page.getByLabel(/Telefon/).fill('+905321112233');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ödeme' })).toBeVisible();
  await expect.poll(async () => (await events(page, 'add_payment_info')).length).toBe(1);
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;
  await page.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await events(page, 'purchase')).length).toBe(1);
  const purchase = (await events(page, 'purchase'))[0]!.ecommerce as Record<string, unknown>;
  expect(purchase).toMatchObject({ transaction_id: orderId, currency: 'EUR', value: checkout.value });
  // No personal data in anything sent to the dataLayer.
  const all = JSON.stringify(await dataLayer(page));
  for (const pii of ['ayse.analytics@example.test', 'Yılmaz', '+905321112233', '5321112233']) expect(all).not.toContain(pii);

  // A reload of the confirmation page does not count the sale twice.
  await page.reload();
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(await events(page, 'purchase')).toHaveLength(0);
  expect(errors).toEqual([]);
  await context.close();
});
