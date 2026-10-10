import { expect, test, type Page } from '@playwright/test';
import { signIn } from './admin-support';

// Any uncaught page error fails the test, hydration mismatches included (server and browser must render the same).
let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const field = (page: Page, id: string) => page.locator(`[id="${id}"]`);

test('flight booking with the provider-managed payment (MOCK): search → fare check → passengers → pay → ticket → confirmed; the order in /yonetim', async ({ page, browser }, info) => {
  // The /yonetim sign-in may wait for the next authenticator step (a code is accepted once per account).
  test.setTimeout(90_000);
  const lastName = info.project.name === 'desktop' ? 'Uçuştest Masa' : 'Uçuştest Mobil';
  await page.goto('/tr');
  await page.getByRole('navigation', { name: 'Ürünler' }).getByRole('link', { name: 'Uçak' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Uçuş arayın');
  await noHorizontalOverflow(page);

  await page.getByRole('combobox', { name: 'Nereden' }).fill('Ist');
  await page.getByRole('option', { name: /IST · Istanbul/ }).click();
  await page.getByRole('combobox', { name: 'Nereye' }).fill('Antalya');
  await page.getByRole('option', { name: /AYT · Antalya/ }).click();
  await page.getByLabel('Çocuk (2–11)').selectOption('1');
  await page.getByLabel('Çocuk yaşı 1').selectOption('6');
  await page.getByRole('button', { name: 'Ara' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Uçuşlar' })).toBeVisible();
  await expect(page.locator('.flight-offer')).toHaveCount(3);
  await expect(page.locator('.flight-offer').first()).toContainText('IST');
  await expect(page.locator('.flight-offer').first()).toContainText('1 aktarma');
  await noHorizontalOverflow(page);
  // The cheapest fare: the provider re-checks it before the quote is made.
  await page.getByRole('button', { name: /^Seç:/ }).first().click();

  await expect(page.getByRole('heading', { level: 1, name: 'Yolcu bilgileri' })).toBeVisible();
  const total = await page.getByTestId('quote-total').innerText();
  await field(page, 'contact.firstName').fill('Ayşe');
  await field(page, 'contact.lastName').fill(lastName);
  await field(page, 'contact.email').fill('ucus@example.test');
  await field(page, 'contact.phoneNumber').fill('5321112233');
  // TEST-ONLY passengers (fictional people and documents).
  const childBirth = new Date(Date.now() - 6.5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const passengers = [
    { first: 'Ayşe', birth: '1988-03-04', gender: 'F', doc: 'TESTP0001' },
    { first: 'Can', birth: childBirth, gender: 'M', doc: 'TESTP0002' },
  ];
  for (const [i, p] of passengers.entries()) {
    await field(page, `passengers.${i}.firstName`).fill(p.first);
    await field(page, `passengers.${i}.lastName`).fill(lastName);
    await field(page, `passengers.${i}.birthDate`).fill(p.birth);
    await field(page, `passengers.${i}.document.number`).fill(p.doc);
    await field(page, `passengers.${i}.document.expiresOn`).fill('2035-01-01');
  }
  await field(page, 'passengers.0.gender').selectOption('F');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await noHorizontalOverflow(page);
  // A missing field comes back from the server next to the field.
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await expect(page.locator('p.error[role="alert"]')).toHaveText('Lütfen işaretli alanları kontrol edin.');
  await expect(field(page, 'passengers.1.gender')).toHaveAttribute('aria-invalid', 'true');
  await field(page, 'passengers.1.gender').selectOption('M');
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Ödeme' })).toBeVisible();
  await expect(page.getByTestId('quote-total')).toHaveText(total);
  await page.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();

  // Booked with an airline PNR first, confirmed only once the ticket is issued (T08).
  await expect(page).toHaveURL(/\/return$/);
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  const pnr = (await page.getByTestId('booking-reference').innerText()).trim();
  expect(pnr).toMatch(/^MOCK\d+$/);
  await expect(page.getByTestId('ticket-numbers')).toHaveText(/^MOCK-TKT-/);
  await expect(page.getByText(/25 USD hizmet bedelini/)).toBeVisible();
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;

  // Operations see the flight: itinerary, passengers (names only), PNR and the issued ticket.
  const ctx = await browser.newContext();
  const ops = await ctx.newPage();
  await signIn(ops, 'admin');
  await ops.goto(`/yonetim/siparisler/${orderId}`);
  await expect(ops.getByTestId('flight-pnr')).toHaveText(pnr);
  await expect(ops.getByTestId('flight-ticketing')).toHaveText('Düzenlendi');
  await expect(ops.getByTestId('order-item')).toContainText(`Ayşe ${lastName} (Yetişkin), Can ${lastName} (Çocuk)`);
  await expect(ops.getByTestId('order-item')).not.toContainText('TESTP000');
  await ctx.close();
});
