import { expect, test, type Page } from '@playwright/test';
import { CommissionRepository, createCoreDatabase } from '@texholiday/db';
import { signIn } from './admin-support';

/**
 * Commission collection (ADR-0019): a MOCK booking's commission is earned (the worker's job after check-out, run here
 * directly on the test database), finance records the payout with its statement reference; a difference needs a note.
 * Viewing needs orders.view_financials, recording commissions.record_payout.
 */
async function bookHotel(page: Page): Promise<string> {
  await page.goto('/tr');
  await page.getByRole('combobox', { name: 'Nereye?' }).fill('Antalya');
  await page.getByRole('option', { name: /Antalya \(MOCK\)/ }).click();
  await page.getByRole('button', { name: 'Ara' }).click();
  await page.getByRole('button', { name: /Seç: MOCK Kaleiçi Boutique – MOCK Superior Double/ }).click();
  await page.getByLabel('Ad', { exact: true }).fill('Komisyon');
  await page.getByLabel('Soyad', { exact: true }).fill('Testi');
  await page.getByLabel('E-posta').fill('komisyon@example.test');
  await page.getByLabel(/Telefon/).fill('+905321112299');
  await page.getByRole('checkbox', { name: /Satış koşullarını/ }).check();
  await page.getByRole('button', { name: 'Ödemeye geç' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ödeme' })).toBeVisible();
  const orderId = page.url().match(/orders\/([0-9a-f-]{36})/)![1]!;
  await page.getByRole('button', { name: 'MOCK: ödemeyi tamamla' }).click();
  await expect(page.getByText('Rezervasyonunuz kesinleşti.')).toBeVisible({ timeout: 20_000 });
  return orderId;
}

/** "12,34" from minor units (TR panel input). */
const trAmount = (minor: bigint) => `${minor / 100n},${String(minor % 100n).padStart(2, '0')}`;
/** As the panel shows it (tr-TR grouping), for matching. */
const trShown = (minor: bigint) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(minor) / 100);

test('commissions: earned after the stay, payout recorded by finance with its reference', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'panel screens');
  test.setTimeout(120_000);
  const orderId = await bookHotel(page);

  // The worker's job after check-out (date and provider check are covered by the integration tests).
  const core = createCoreDatabase(process.env.TEST_DATABASE_URL!, { max: 1 });
  let commission: { id: string; amount: bigint; ref: string };
  try {
    const r = await core.pool.query<{ id: string; amount: string; ref: string }>(
      `SELECT pc.id, pc.amount_minor::text AS amount, pb.provider_booking_ref AS ref
       FROM core.provider_commissions pc JOIN core.order_items i ON i.id = pc.order_item_id
       JOIN core.provider_bookings pb ON pb.order_item_id = i.id WHERE i.order_id = $1`,
      [orderId],
    );
    commission = { id: r.rows[0]!.id, amount: BigInt(r.rows[0]!.amount), ref: r.rows[0]!.ref };
    expect(await new CommissionRepository(core.db).markEarned(commission.id, new Date(), 'system:commission-earning')).toBe(true);
  } finally {
    await core.close();
  }

  // Approver: sees the commissions but cannot record a payout.
  const approverCtx = await browser.newContext();
  const approver = await approverCtx.newPage();
  await signIn(approver, 'approver');
  await approver.goto('/yonetim/raporlar/komisyonlar');
  await expect(approver.getByRole('heading', { level: 1, name: 'Komisyon tahsilatı' })).toBeVisible();
  await expect(approver.getByText('komisyon ödemesi kaydetme')).toBeVisible();
  await expect(approver.getByTestId('commission-rows')).toContainText(commission.ref);
  await expect(approver.getByRole('button', { name: 'Ödemeyi kaydet' })).toHaveCount(0);
  await approverCtx.close();

  // Finance: from the reports menu to the earned commissions.
  await signIn(page, 'finance');
  await page.goto('/yonetim/raporlar');
  await page.getByRole('link', { name: 'Komisyon tahsilatı' }).click();
  await expect(page.getByRole('link', { name: 'Hak edilen (ödeme bekleniyor)' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('payout-selected')).toHaveText('Ödemenin kapsadığı komisyonları seçin.');
  await page.getByRole('checkbox', { name: new RegExp(`Seç: MOCK Kaleiçi Boutique ${commission.ref}`) }).check();
  await expect(page.getByTestId('payout-selected')).toContainText('Seçilen: 1 komisyon');
  await expect(page.getByTestId('payout-selected')).toContainText(trShown(commission.amount));

  const reference = `NUITEE-E2E-${Date.now().toString(36).toUpperCase()}`;
  await page.getByLabel('Ekstre/payout referansı').fill(reference);
  await page.getByLabel('Hesaba geçtiği gün').fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date()));
  // One cent less arrived: without an explanation it is refused.
  await page.getByLabel(/Gelen tutar/).fill(trAmount(commission.amount - 1n));
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'farkın nedenini yazın' })).toBeVisible();
  await page.getByLabel('Fark açıklaması (gerekirse)').fill('Banka masrafı 0,01 EUR');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  // Received now, with the reference; the payout and its difference are listed.
  await expect(page).toHaveURL(/durum=RECEIVED/);
  await expect(page.getByRole('status').filter({ hasText: 'Kaydedildi: 1 komisyon' })).toContainText('Fark:');
  await expect(page.getByRole('link', { name: 'Tahsil edilen' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('commission-rows')).toContainText(reference);
  const payout = page.getByTestId('commission-payouts').getByRole('row').filter({ hasText: reference });
  await expect(payout).toContainText(/-\s?€?\s?0,01/);
  await expect(payout).toContainText('Banka masrafı 0,01 EUR');
  await expect(payout).toContainText('E2E Finans');
});
