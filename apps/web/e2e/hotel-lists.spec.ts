import { readFileSync } from 'node:fs';
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

  // That search (list reference: 1 room, 2 adults, 1 night) was compared with the list price: the panel report shows it.
  await page.goto('/yonetim/raporlar');
  await page.getByRole('link', { name: 'Liste fiyatı doğruluğu' }).click();
  const eur = page.getByTestId('accuracy-EUR');
  await expect(eur).toBeVisible();
  const shownRow = eur.getByRole('row', { name: /Sayfada gösterilen/ });
  await expect(shownRow.locator('td').nth(1)).not.toHaveText(/^0 /);

  // Ads page feed: the list page and its hotel pages with labels; staff only.
  await page.goto('/yonetim/raporlar/reklam-sayfalari');
  await expect(page.getByTestId('feed-count')).toContainText('liste sayfası');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'CSV indir' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^texholiday-sayfa-feed-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toBe('Page URL,Custom label');
  expect(csv).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/tr/oteller/${slug},liste;tr;liste-${slug};fiyatli\r$`, 'm'));
  expect(csv).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/tr/otel/mock-lara-beach-resort-mock-h1,otel;tr;[^\\r]*liste-${slug}`, 'm'));
  expect((await visitor.request.get('/api/v1/staff/ads-page-feed')).status()).toBe(403);

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

test('hotel lists: editors find hotels by name in the panel and add their codes; the search is staff-only', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'panel screen');
  test.setTimeout(90_000);

  // Visitors cannot spend provider calls on the name search.
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await visitor.goto('/tr');
  expect((await call(visitor, 'GET', '/api/v1/staff/hotel-names?q=lara&country=TR')).status).toBe(403);
  await visitorCtx.close();

  await signIn(page, 'editor');
  await page.goto('/yonetim');
  expect((await call(page, 'GET', '/api/v1/staff/hotel-names?q=lara&country=TUR')).status).toBe(422);
  const found = await call(page, 'GET', '/api/v1/staff/hotel-names?q=lara&country=TR');
  expect(found.status).toBe(200);
  expect(found.json.data).toEqual([expect.objectContaining({ hotelId: 'MOCK-H1', name: 'MOCK Lara Beach Resort', city: 'Antalya', stars: 5 })]);

  await page.goto('/yonetim/icerik/collections/hotel-lists/create');
  const finder = page.getByTestId('hotel-finder');
  await expect(finder).toBeVisible({ timeout: 30_000 });
  await expect(finder.getByLabel('Ülke kodu')).toHaveValue('TR');
  await finder.getByLabel('Otel adı').fill('belek');
  const row = finder.getByRole('row').filter({ hasText: 'MOCK Belek Golf Resort' });
  await expect(row).toContainText('MOCK-H3');
  await expect(row).toContainText('★★★★★');

  // One click puts the code in "pin"; moving it to "remove" takes it out of "pin" (a code lives in one place).
  // Payload picks its language from the browser (here en-US); the code chips carry a "Remove" button.
  const chips = (label: RegExp) => page.locator('.field-type').filter({ hasText: label }).getByRole('button', { name: /^MOCK-H\d+ (Remove|Kaldır)$/ });
  const pinned = chips(/^(Hotel codes pinned to the top|Başa sabitlenecek otel kodları)/);
  const excluded = chips(/^(Hotel codes to remove|Çıkarılacak otel kodları)/);
  await row.getByRole('button', { name: 'MOCK Belek Golf Resort: Başa sabitle' }).click();
  await expect(row).toContainText('✓ başa sabitlendi');
  await expect(pinned).toHaveText([/^MOCK-H3/]);
  await row.getByRole('button', { name: 'MOCK Belek Golf Resort: Çıkar' }).click();
  await expect(row).toContainText('✓ çıkarıldı');
  await expect(excluded).toHaveText([/^MOCK-H3/]);
  await expect(pinned).toHaveCount(0);

  // Another country, no match.
  await finder.getByLabel('Ülke kodu').fill('EG');
  await expect(finder.getByText('Bu ülkede bu adla otel bulunamadı.')).toBeVisible();
});
