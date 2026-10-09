import { expect, test } from '@playwright/test';
import { opaque } from '@texholiday/contracts';
import { evidence, payWithTestCard, sandboxHotelConnector, watchCsp } from './support';

/**
 * The customer site against the Nuitee SANDBOX (ADR-0008): search → refundable offer → guest details → Nuitee payment
 * component (test card) → provider return → confirmed. Also proves our Content-Security-Policy lets the component
 * work. The booking is cancelled at the end.
 */
const destination = process.env.SANDBOX_SITE_DESTINATION ?? 'Antalya';

test('hotel booking on our site with the Nuitee payment component (sandbox)', async ({ page }) => {
  const csp = await watchCsp(page);
  await page.goto('/tr');
  await page.getByRole('combobox', { name: 'Nereye?' }).fill(destination);
  const suggestions = page.getByRole('listbox');
  await expect(suggestions).toBeVisible({ timeout: 30_000 });
  await suggestions.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sonuçlar' })).toBeVisible({ timeout: 60_000 });

  // A refundable offer, so the test booking can be cancelled without a penalty.
  const offer = page.locator('li.offer').filter({ hasText: 'ücretsiz iptal' }).first();
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.getByRole('button', { name: /^Seç:/ }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Rezervasyonu tamamlayın' })).toBeVisible({ timeout: 60_000 });
  const total = await page.getByTestId('quote-total').innerText();
  await page.getByLabel('Ad', { exact: true }).fill('Sandbox');
  await page.getByLabel('Soyad', { exact: true }).fill('Tester');
  await page.getByLabel('E-posta').fill('sandbox-tester@example.invalid');
  await page.getByLabel(/Telefon/).fill('+905000000000');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Ödeme' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('quote-total')).toHaveText(total);
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;
  evidence('site.payment_page', { orderId, total });
  // The component must fit the screen (320px and up): no horizontal page scroll.
  await page.locator('#nuitee-payment iframe').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(2_000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // No full-page screenshot here: it resizes the viewport and the provider's form then no longer submits.

  await payWithTestCard(page);
  await page.waitForURL(/\/return/, { timeout: 90_000 });
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 120_000 });
  const ref = (await page.getByTestId('booking-reference').innerText()).trim();
  evidence('site.confirmed', { orderId, providerBookingRef: ref });

  const violations = await csp();
  evidence('site.csp', { violations });
  try {
    expect(violations).toEqual([]);
  } finally {
    const cancel = await sandboxHotelConnector().cancel(opaque(ref));
    evidence('site.cancel', cancel.kind === 'SUCCEEDED' ? { ref, kind: cancel.kind, status: cancel.value.status, penalty: cancel.value.penalty } : { ref, ...cancel });
    expect(cancel).toMatchObject({ kind: 'SUCCEEDED', value: { status: 'CANCELLED' } });
  }
});
