import { appendFileSync } from 'node:fs';
import { expect, type Frame, type Page } from '@playwright/test';
import { NuiteeHotelConnector } from '@texholiday/connectors';

/**
 * SANDBOX helpers. Never used against production: the config refuses to start unless the key is declared sandbox,
 * and the connector rejects responses from another environment.
 */
export function sandboxHotelConnector(): NuiteeHotelConnector {
  return new NuiteeHotelConnector({
    apiKey: process.env.NUITEE_API_KEY ?? '',
    environment: 'sandbox',
    searchBaseUrl: 'https://api.liteapi.travel/v3.0',
    bookBaseUrl: 'https://book.liteapi.travel/v3.0',
    searchTimeoutSeconds: 6,
    bookTimeoutSeconds: 120,
  });
}

/** PII-free evidence line (ids, statuses, amounts) on stdout and, if set, in SANDBOX_EVIDENCE_FILE (JSON lines). */
export function evidence(step: string, data: unknown): void {
  const line = JSON.stringify({ at: new Date().toISOString(), step, data }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  console.log(`EVIDENCE ${line}`);
  if (process.env.SANDBOX_EVIDENCE_FILE) appendFileSync(process.env.SANDBOX_EVIDENCE_FILE, `${line}\n`);
}

/** Records Content-Security-Policy violations of every document in the page (ours and the provider's frames). */
export async function watchCsp(page: Page): Promise<() => Promise<{ directive: string; blocked: string; origin: string }[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp?: { directive: string; blocked: string; origin: string }[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp!.push({ directive: e.violatedDirective, blocked: e.blockedURI, origin: location.origin }));
  });
  return () => page.evaluate(() => (window as unknown as { __csp?: { directive: string; blocked: string; origin: string }[] }).__csp ?? []);
}

/**
 * The Stripe frame with the card number field. Depending on the currency the component lists several methods
 * (USD sandbox: Cash App Pay, Afterpay, Affirm, Card, Amazon Pay, Klarna) with another one preselected; then "Card" is
 * chosen first.
 */
async function cardFrame(page: Page): Promise<Frame> {
  let found: Frame | null = null;
  await expect
    .poll(
      async () => {
        for (const f of page.frames()) {
          if ((await f.locator('input[name="number"]').count().catch(() => 0)) > 0 && (await f.locator('input[name="number"]').isVisible().catch(() => false))) {
            found = f;
            return true;
          }
        }
        for (const f of page.frames()) {
          const card = f.getByText('Card', { exact: true });
          if ((await card.count().catch(() => 0)) > 0) await card.first().click().catch(() => undefined);
        }
        return false;
      },
      { timeout: 60_000, intervals: [1_000], message: 'card form of the payment component' },
    )
    .toBe(true);
  return found!;
}

/**
 * Pays in the Nuitee payment component with Stripe's public test card (4242…; any future expiry, any CVC). Test cards
 * only work with sandbox (test-mode) payment keys; the component's publicKey is 'sandbox' in this run.
 */
export async function payWithTestCard(page: Page): Promise<void> {
  const frame = await cardFrame(page);
  const yy = String((new Date().getUTCFullYear() + 3) % 100).padStart(2, '0');
  // Stripe's fields can drop input typed while they are still mounting (seen once in sandbox): type, then check that
  // the field kept a value, and type again if not.
  const typeInto = async (name: string, value: string) => {
    const field = frame.locator(`input[name="${name}"]`);
    await expect
      .poll(
        async () => {
          if ((await field.inputValue()).replace(/\D/g, '') !== '') return true;
          await field.click();
          await field.fill(value);
          return (await field.inputValue()).replace(/\D/g, '') !== '';
        },
        { timeout: 20_000, intervals: [500], message: `payment field ${name}` },
      )
      .toBe(true);
  };
  await typeInto('number', '4242424242424242');
  await typeInto('expiry', `12 / ${yy}`);
  await typeInto('cvc', '123');
  const postal = frame.locator('input[name="postalCode"]');
  if ((await postal.count()) > 0) await typeInto('postalCode', '12345');
  const pay = page.getByRole('button', { name: /^\s*pay\s*$/i });
  // The provider's frames keep resizing and scrolling the page while the last field settles (seen at 320px): click
  // only once the button has stayed in place, or the tap lands where it used to be.
  await pay.scrollIntoViewIfNeeded();
  let last = '';
  for (let i = 0; i < 20; i += 1) {
    const box = JSON.stringify(await pay.boundingBox());
    if (box === last) break;
    last = box;
    await page.waitForTimeout(500);
  }
  await pay.click();
}
