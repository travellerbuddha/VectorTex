import { expect, test, type Page } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * Commission collection (ADR-0019): Nuitee pays our commission when it collects the payment, before the stay.
 * Finance records the payout with its statement reference (a difference needs a note); a booking cancelled after
 * its commission was paid owes it back, and the next payout that deducts it is recorded with it. Viewing needs
 * orders.view_financials, recording commissions.record_payout.
 */
async function bookHotel(page: Page, lastName: string): Promise<{ orderId: string; ref: string }> {
  await page.goto('/tr');
  await page.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await page.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await page.getByRole('button', { name: /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/ }).click();
  await page.getByLabel('Ad', { exact: true }).fill('Komisyon');
  await page.getByLabel('Soyad', { exact: true }).fill(lastName);
  await page.getByLabel('E-posta').fill('komisyon@example.test');
  await page.getByLabel(/Telefon/).fill('+905321112299');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ödeme' })).toBeVisible();
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;
  await page.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  return { orderId, ref: await page.getByTestId('booking-reference').innerText() };
}

/** "12,34" from minor units (TR panel input). */
const trAmount = (minor: bigint) => `${minor / 100n},${String(minor % 100n).padStart(2, '0')}`;
/** The amount of a "€27,00"-style cell, in minor units. */
const minorOf = (text: string) => BigInt(text.replace(/[^\d]/g, ''));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());

test('commissions: paid before the stay, owed back after a cancellation, deducted from the next payout', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'panel screens');
  test.setTimeout(150_000);
  const customer = await (await browser.newContext()).newPage();
  const a = await bookHotel(customer, 'Peşin');
  const b = await bookHotel(customer, 'Sonraki');

  // Approver: sees the commissions awaiting payout but cannot record one.
  const approverCtx = await browser.newContext();
  const approver = await approverCtx.newPage();
  await signIn(approver, 'approver');
  await approver.goto('/yonetim/raporlar/komisyonlar');
  await expect(approver.getByRole('heading', { level: 1, name: 'Komisyon tahsilatı' })).toBeVisible();
  await expect(approver.getByText('komisyon ödemesi kaydetme')).toBeVisible();
  await expect(approver.getByTestId('commission-rows')).toContainText(a.ref);
  await expect(approver.getByRole('button', { name: 'Ödemeyi kaydet' })).toHaveCount(0);
  await approverCtx.close();

  // Finance: Nuitee paid a's commission right after collecting the payment (the stay is in the future).
  await signIn(page, 'finance');
  await page.goto('/yonetim/raporlar');
  await page.getByRole('link', { name: 'Komisyon tahsilatı' }).click();
  await expect(page.getByRole('link', { name: 'Ödeme bekleyen' })).toHaveAttribute('aria-current', 'page');
  const unpaid = page.getByTestId('unpaid-commissions');
  const rowA = unpaid.getByRole('row').filter({ hasText: a.ref });
  await expect(rowA).toContainText('Ödenmedi, konaklama sürüyor');
  const amountA = minorOf(await rowA.getByRole('cell').last().innerText());
  await expect(page.getByTestId('payout-selected')).toHaveText('Ödemenin kapsadığı komisyonları ve varsa düşülen iadeleri seçin.');
  await rowA.getByRole('checkbox').check();
  await expect(page.getByTestId('payout-selected')).toContainText('Seçilen: 1 komisyon');
  await expect(page.getByTestId('payout-selected')).toContainText(trAmount(amountA));

  const first = `NUITEE-E2E-${Date.now().toString(36).toUpperCase()}`;
  await page.getByLabel('Ekstre/ödeme referansı').fill(first);
  await page.getByLabel('Hesaba geçtiği gün').fill(today());
  // One cent less arrived: refused without an explanation, accepted with one.
  await page.getByLabel(/Gelen tutar/).fill(trAmount(amountA - 1n));
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'farkın nedenini yazın' })).toBeVisible();
  await page.getByLabel('Fark açıklaması (gerekirse)').fill('Banka masrafı 0,01 EUR');
  await page.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await expect(page).toHaveURL(/durum=RECEIVED/);
  await expect(page.getByRole('status').filter({ hasText: 'Kaydedildi: 1 komisyon' })).toContainText('Fark:');
  const receivedA = page.getByTestId('commission-rows').getByRole('row').filter({ hasText: a.ref });
  await expect(receivedA).toContainText('Peşin tahsil (konaklama sürüyor)');
  await expect(receivedA).toContainText(first);
  const payoutRow = page.getByTestId('commission-payouts').getByRole('row').filter({ hasText: first });
  await expect(payoutRow).toContainText(/-\s?€?\s?0,01/);
  await expect(payoutRow).toContainText('Banka masrafı 0,01 EUR');
  await expect(payoutRow).toContainText('E2E Finans');

  // The guest cancels a: its commission is owed back to Nuitee.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  admin.on('dialog', (d) => void d.accept());
  await signIn(admin, 'admin');
  await admin.goto(`/yonetim/siparisler/${a.orderId}`);
  const commands = admin.getByTestId('order-commands');
  await commands.getByLabel('İptal gerekçesi').fill('Misafir planını değiştirdi.');
  await commands.getByRole('button', { name: 'Rezervasyonu iptal et' }).click();
  await expect(admin.getByRole('heading', { level: 1 })).toContainText('İptal');
  await adminCtx.close();
  await page.getByRole('link', { name: 'Nuitee’ye iade/mahsup edilecek' }).click();
  await expect(page.getByTestId('commission-rows').getByRole('row').filter({ hasText: a.ref })).toContainText(first);

  // The next payout pays b's commission minus a's: both selected, the expected payout is shown, no difference.
  await page.getByRole('link', { name: 'Ödeme bekleyen' }).click();
  const rowB = page.getByTestId('unpaid-commissions').getByRole('row').filter({ hasText: b.ref });
  const amountB = minorOf(await rowB.getByRole('cell').last().innerText());
  await rowB.getByRole('checkbox').check();
  await page.getByTestId('netted-commissions').getByRole('row').filter({ hasText: a.ref }).getByRole('checkbox').check();
  await expect(page.getByTestId('payout-selected')).toContainText('1 komisyon');
  await expect(page.getByTestId('payout-selected')).toContainText('1 iade');
  const second = `${first}-2`;
  await page.getByLabel('Ekstre/ödeme referansı').fill(second);
  await page.getByLabel('Hesaba geçtiği gün').fill(today());
  // Same hotel and dates: the commissions are equal, so the deduction takes up the whole payout (0,00 arrives).
  await page.getByLabel(/Gelen tutar/).fill(trAmount(amountB - amountA));
  await page.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await expect(page).toHaveURL(/durum=RECEIVED/);
  await expect(page.getByRole('status').filter({ hasText: 'Kaydedildi: 1 komisyon' })).toContainText('düşülen iadeler');
  await expect(page.getByTestId('commission-payouts').getByRole('row').filter({ hasText: second })).toContainText(trAmount(amountA));

  // Netted: no longer owed back; the voided list shows where it was deducted.
  await page.getByRole('link', { name: 'Nuitee’ye iade/mahsup edilecek' }).click();
  await expect(page.getByText('Bu listede komisyon yok.')).toBeVisible();
  await page.getByRole('link', { name: 'İptal', exact: true }).click();
  await expect(page.getByTestId('commission-rows').getByRole('row').filter({ hasText: a.ref })).toContainText(second);
});
