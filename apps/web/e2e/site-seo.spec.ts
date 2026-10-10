import { expect, test, type Page } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * P17: old-site address map in the CMS (live at once, so only content.publish manages it), served by the proxy as a
 * permanent redirect; sitemap.xml lists published pages with hreflang; robots.txt keeps non-production sites out.
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

const errorText = (r: { json: Record<string, unknown> }) => JSON.stringify(r.json);

test('seo: publishers manage old-address redirects, visitors get a 301; sitemap and robots', async ({ page, browser, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared content');
  test.setTimeout(180_000);
  const id = Date.now().toString(36);
  const slug = `kemer-otelleri-${id}`;
  const oldPath = `/eski-kemer-otelleri-${id}/`;

  // content.edit alone cannot create a rule (rules are live at once).
  const editorCtx = await browser.newContext();
  const editor = await editorCtx.newPage();
  await signIn(editor, 'editor');
  await editor.goto('/yonetim');
  expect((await call(editor, 'POST', '/api/cms/redirects', { from: oldPath, to: '/tr' })).status).toBe(403);
  await editorCtx.close();

  await signIn(page, 'admin');
  await page.goto('/yonetim');
  const created = await call(page, 'POST', '/api/cms/pages?locale=tr', {
    title: 'Kemer otelleri',
    slug,
    _status: 'published',
    layout: [{ blockType: 'hero', heading: 'Kemer’de otel', showHotelSearch: false }],
    seo: { title: 'Kemer Otelleri', noindex: false },
  });
  expect(created.status, errorText(created)).toBe(201);

  // Off-site targets, the panel and chains are refused; the stored form is canonical (no trailing slash).
  expect((await call(page, 'POST', '/api/cms/redirects', { from: `/x-${id}`, to: 'https://evil.example/' })).status).toBe(400);
  expect((await call(page, 'POST', '/api/cms/redirects', { from: `/yonetim/x-${id}`, to: '/tr' })).status).toBe(400);
  const rule = await call(page, 'POST', '/api/cms/redirects', { from: oldPath, to: `/tr/${slug}`, status: '301', note: 'E2E' });
  expect(rule.status, errorText(rule)).toBe(201);
  expect((rule.json.doc as { from: string }).from).toBe(oldPath.replace(/\/$/, ''));
  const chain = await call(page, 'POST', '/api/cms/redirects', { from: `/zincir-${id}`, to: oldPath });
  expect(chain.status, errorText(chain)).toBe(400);

  // Visitors: one permanent redirect to the site origin's new path (the proxy keeps its copy of the map for up to a minute).
  await expect
    .poll(async () => {
      const r = await request.get(oldPath, { maxRedirects: 0 });
      return `${r.status()} ${new URL(r.headers()['location'] ?? '/', 'http://x').pathname}`;
    }, { timeout: 90_000, intervals: [2_000, 5_000] })
    .toBe(`301 /tr/${slug}`);
  const followed = await request.get(oldPath);
  expect(followed.status()).toBe(200);
  // Paths without a rule are untouched; a trailing slash still goes to the plain path (one 308, as Next's default).
  expect((await request.get(`/olmayan-adres-${id}`, { maxRedirects: 0 })).status()).toBe(404);
  const slash = await request.get('/tr/terms/?a=1', { maxRedirects: 0 });
  const slashTo = new URL(slash.headers()['location'] ?? '/', 'http://x');
  expect(`${slash.status()} ${slashTo.pathname}${slashTo.search}`).toBe('308 /tr/terms?a=1');

  // sitemap.xml: the published page with its language alternate; robots.txt: development is not indexed.
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`/tr/${slug}</loc>`);
  expect(sitemap).toMatch(new RegExp(`hreflang="tr"[^>]*href="[^"]*/tr/${slug}"`));
  expect(sitemap).toContain('/tr/terms</loc>');
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toMatch(/Disallow: \/\s*$/m);
});
