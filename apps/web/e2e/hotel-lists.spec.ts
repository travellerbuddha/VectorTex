import { expect, test, type Page } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * Hotel list pages (ADR-0014) with the MOCK hotel connector: a publisher sets the price display settings and publishes
 * "Antalya Otelleri" from two places; the scanner (the worker's job; here the MOCK-only dev route) prices 30 days;
 * visitors get the list with prices and conditions, an ItemList of hotel pages, the hotel page and a search that shows
 * the same lowest price for the same date.
 */
async function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    },
    { method, path, body },
  );
}

test('hotel lists: publish a list, prices from the scan, ItemList markup, hotel page, the same price in the search', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared content and one scan');
  test.setTimeout(120_000);
  const slug = `antalya-${Date.now().toString(36)}`;
  await signIn(page, 'admin');
  await page.goto('/yonetim');

  // Price display settings: nothing is defaulted; without them no prices are shown.
  const settings = await call(page, 'POST', '/api/cms/globals/hotel-list-settings', { trCurrency: 'EUR', trNationality: 'TR', enCurrency: 'EUR', enNationality: 'GB', maxPriceAgeHours: 26 });
  expect(settings.status, JSON.stringify(settings.json)).toBe(200);

  // A list needs a source to be published.
  const empty = await call(page, 'POST', '/api/cms/hotel-lists?locale=tr', { title: 'Boş', slug: `${slug}-bos`, boardType: 'ANY', sort: 'PRICE', maxItems: 30, _status: 'published' });
  expect(empty.status).toBe(400);

  const created = await call(page, 'POST', '/api/cms/hotel-lists?locale=tr', {
    title: 'Antalya Otelleri',
    slug,
    intro: 'Antalya merkez ve Belek’teki MOCK oteller, önümüzdeki 30 günün en düşük fiyatlarıyla.',
    places: [
      { placeId: 'MOCK-PLACE-ANTALYA', name: 'Antalya (MOCK)', address: 'Antalya, Türkiye' },
      { placeId: 'MOCK-PLACE-BELEK', name: 'Belek (MOCK)', address: 'Serik, Antalya, Türkiye' },
    ],
    boardType: 'ANY',
    sort: 'PRICE',
    maxItems: 30,
    faq: [{ question: 'Fiyatlar neyi kapsar?', answer: '1 oda, 2 yetişkin, 1 gece; vergiler dahil.' }],
    _status: 'published',
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);

  // The scan runs at the provider pace (MOCK: on the web process, publishers only).
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await visitor.goto('/tr');
  expect((await call(visitor, 'POST', '/api/v1/dev/hotel-lists')).status).toBe(403);
  const scan = await call(page, 'POST', '/api/v1/dev/hotel-lists');
  expect(scan.status, JSON.stringify(scan.json)).toBe(200);

  // Visitors: the list with prices and their conditions.
  await visitor.goto(`/tr/oteller/${slug}`);
  await expect(visitor.getByRole('heading', { level: 1, name: 'Antalya Otelleri' })).toBeVisible();
  const cards = visitor.getByTestId('hotel-cards').locator(':scope > li');
  await expect(cards).toHaveCount(3);
  await expect(visitor.getByTestId('list-summary')).toContainText('3 otel');
  await expect(cards.first()).toContainText('1 gece · 2 yetişkin');
  await expect(cards.first()).toContainText('vergiler dahil');
  await expect(visitor.getByText(/itibarıyla sağlayıcıdan alındı/)).toBeVisible();
  const firstPrice = (await cards.first().getByTestId('list-price').innerText()).trim();

  // Structured data: an ItemList of hotel pages on this site, no ratings marked up.
  const blocks = (await visitor.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);
  const itemList = blocks.find((b) => b['@type'] === 'ItemList') as { itemListElement: Array<{ position: number; item: { '@type': string; url: string; image: string[] } }> };
  expect(itemList.itemListElement).toHaveLength(3);
  for (const el of itemList.itemListElement) {
    expect(el.item['@type']).toBe('Hotel');
    expect(el.item.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/tr\/otel\/mock-[a-z0-9-]+$/);
    expect(el.item.image[0]).toMatch(/\/mock\/hotel-\d\.svg$/);
  }
  expect(JSON.stringify(blocks)).not.toContain('aggregateRating');
  expect(blocks.some((b) => b['@type'] === 'BreadcrumbList')).toBe(true);
  const robots = await visitor.locator('meta[name="robots"]').count();
  expect(robots).toBe(0);
  await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/tr/oteller/${slug}$`));

  // Hotel page from "see prices": the date of the list price, the hotel preset in the search form.
  await cards.first().getByRole('link', { name: 'Fiyatları gör' }).click();
  await expect(visitor).toHaveURL(/\/tr\/otel\/mock-[a-z0-9-]+\?checkin=\d{4}-\d{2}-\d{2}$/);
  await expect(visitor.getByRole('heading', { level: 1 })).toContainText('MOCK');
  await expect(visitor.getByText('MOCK açıklama')).toBeVisible();
  const hotelLd = (await visitor.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>).find((b) => b['@type'] === 'Hotel')!;
  expect(hotelLd).toMatchObject({ geo: { '@type': 'GeoCoordinates' }, checkinTime: '14:00:00' });
  await visitor.getByRole('button', { name: 'Ara', exact: true }).click();
  await expect(visitor).toHaveURL(/\/tr\/search\/hotels\/[0-9a-f-]{36}\?hotel=MOCK-H/);
  await expect(visitor.locator('.hotel .from strong').first()).toHaveText(firstPrice);

  // Old search addresses move to the new place; list addresses do not.
  const sessionPath = new URL(visitor.url()).pathname.replace('/search/hotels/', '/hotels/');
  const moved = await visitor.request.get(sessionPath, { maxRedirects: 0 });
  expect(moved.status()).toBe(308);
  expect(moved.headers().location).toContain('/tr/search/hotels/');

  // The hub lists the published list; the sitemap carries the list and its hotel pages.
  await visitor.goto('/tr/oteller');
  await expect(visitor.getByRole('link', { name: 'Antalya Otelleri' }).first()).toBeVisible();
  const sitemap = await (await visitor.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`/tr/oteller/${slug}`);
  expect(sitemap).toMatch(/\/tr\/otel\/mock-lara-beach-resort-mock-h1/);
  await visitorCtx.close();
});
