import { expect, test, type Page } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * Payload CMS (P06): content staff sign in through /yonetim (no CMS password), drafts stay private, publishing needs
 * content.publish, previews show drafts only to content staff, published pages render on the site with SEO.
 */
const richText = (text: string) => ({
  root: { type: 'root', format: '', indent: 0, version: 1, direction: 'ltr', children: [{ type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', textFormat: 0, children: [{ type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] }] },
});

/** A same-origin fetch from the page, as the CMS admin does (the SameSite=Strict staff cookie goes along). */
async function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    },
    { method, path, body },
  );
}

async function createDraft(page: Page, slug: string) {
  return call(page, 'POST', '/api/cms/pages?draft=true&locale=tr', {
      title: 'Antalya otelleri',
      slug,
      _status: 'draft',
      layout: [
        { blockType: 'hero', heading: 'Antalya’da otel', subheading: 'Deniz, güneş ve Kaleiçi', showHotelSearch: true },
        { blockType: 'richText', content: richText('Antalya rehberimiz. <script>alert(1)</script> yalnız metin olarak görünür.') },
      ],
      seo: { title: 'Antalya Otelleri | TexHoliday', description: 'Antalya otel fırsatları', noindex: false },
  });
}

test('content: editor drafts, cannot publish; owner previews and publishes; visitors see only published pages', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared content');
  const slug = `antalya-otelleri-${Date.now().toString(36)}`;

  // A staff member without content permissions is kept out of the CMS and its API.
  const financeCtx = await browser.newContext();
  const finance = await financeCtx.newPage();
  await signIn(finance, 'finance');
  await finance.goto('/yonetim/icerik');
  await expect(finance).toHaveURL(/\/yonetim$/);
  expect((await call(finance, 'POST', '/api/cms/pages?draft=true', { title: 'x', slug: 'x-y', layout: [] })).status).toBe(403);
  await financeCtx.close();

  // Editor (content.edit only): may draft, may not publish.
  const editorCtx = await browser.newContext();
  const editor = await editorCtx.newPage();
  await signIn(editor, 'editor');
  await editor.getByRole('navigation', { name: 'Yönetim menüsü' }).getByRole('link', { name: 'İçerik (site)' }).click();
  await expect(editor).toHaveURL(/\/yonetim\/icerik/);
  // Payload picks its language from the browser (here en-US); Turkish browsers get Turkish.
  await expect(editor.getByRole('link', { name: /^(Sayfalar|Pages)$/ }).first()).toBeVisible({ timeout: 30_000 });
  const created = await createDraft(editor, slug);
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const id = (created.json.doc as { id: number }).id;
  expect((await call(editor, 'PATCH', `/api/cms/pages/${id}?locale=tr`, { _status: 'published' })).status).toBe(403);
  await editorCtx.close();

  // Visitors: the draft does not exist yet (page 404, API hides it).
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  expect((await visitor.goto(`/tr/${slug}`))!.status()).toBe(404);
  const list = await visitor.request.get(`/api/cms/pages?where[slug][equals]=${slug}`);
  expect((await list.json()).docs).toEqual([]);

  // Owner: preview shows the draft on the real page, then publishes.
  page.on('dialog', (d) => void d.accept());
  await signIn(page, 'admin');
  await page.goto(`/api/cms-preview?collection=pages&slug=${slug}&locale=tr`);
  await expect(page).toHaveURL(new RegExp(`/tr/${slug}$`));
  await expect(page.getByRole('status')).toContainText('Önizleme');
  await expect(page.getByRole('heading', { level: 1, name: 'Antalya’da otel' })).toBeVisible();
  const published = await call(page, 'PATCH', `/api/cms/pages/${id}?locale=tr`, { _status: 'published' });
  expect(published.status, JSON.stringify(published.json)).toBe(200);
  await page.goto('/api/cms-preview/exit');

  // Published: visible to everyone, approved blocks only, SEO from the CMS, script text never executed.
  const response = await visitor.goto(`/tr/${slug}`);
  expect(response!.status()).toBe(200);
  await expect(visitor.getByRole('heading', { level: 1, name: 'Antalya’da otel' })).toBeVisible();
  await expect(visitor.getByText('<script>alert(1)</script> yalnız metin olarak görünür.', { exact: false })).toBeVisible();
  await expect(visitor.getByRole('combobox', { name: 'Nereye?' })).toBeVisible(); // hotel search block
  await expect(visitor).toHaveTitle('Antalya Otelleri | TexHoliday');
  await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/tr/${slug}$`));
  await expect(visitor.locator('meta[name="robots"]')).toHaveCount(0);
  await visitorCtx.close();
});
