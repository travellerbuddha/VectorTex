import { expect, test, type Page } from '@playwright/test';
import { signIn } from './admin-support';

/**
 * Guide articles and the FAQ page (P06): a publisher writes an article in Turkish and English and two questions;
 * visitors find them under /tr/rehber, /en/guides, /tr/sss and /en/faq with Article/FAQPage markup and hreflang.
 */
const richText = (...paragraphs: string[]) => ({
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: paragraphs.map((text) => ({ type: 'paragraph', format: '', indent: 0, version: 1, direction: 'ltr', textFormat: 0, children: [{ type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] })),
  },
});

async function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    },
    { method, path, body },
  );
}

const ld = async (page: Page) => (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);

test('guides and FAQ: published articles and questions per language, with markup, hreflang and sitemap', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'shared content');
  const id = Date.now().toString(36);
  const trSlug = `kemer-gezi-rehberi-${id}`;
  const enSlug = `kemer-travel-guide-${id}`;
  await signIn(page, 'admin');
  await page.goto('/yonetim');

  // A page cannot take the guide directory's address.
  expect((await call(page, 'POST', '/api/cms/pages?locale=tr', { title: 'x', slug: 'rehber', layout: [{ blockType: 'richText', content: richText('x') }], _status: 'draft' })).status).toBe(400);

  const created = await call(page, 'POST', '/api/cms/posts?locale=tr', {
    title: `Kemer gezi rehberi ${id}`,
    slug: trSlug,
    excerpt: 'Kemer’de nerede kalınır, ne yapılır: kısa rehber.',
    body: richText('Kemer, Antalya’nın batısında; Olimpos ve Phaselis yakınında.', 'Her şey dahil oteller sahil boyunca sıralanır.'),
    publishedAt: '2026-10-01T09:00:00.000Z',
    _status: 'published',
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const postId = (created.json.doc as { id: number }).id;
  const en = await call(page, 'PATCH', `/api/cms/posts/${postId}?locale=en`, {
    title: `Kemer travel guide ${id}`,
    slug: enSlug,
    excerpt: 'Where to stay and what to do in Kemer.',
    body: richText('Kemer lies west of Antalya, near Olympos and Phaselis.'),
    _status: 'published',
  });
  expect(en.status, JSON.stringify(en.json)).toBe(200);
  // Turkish only: never shown under /en.
  const trOnly = await call(page, 'POST', '/api/cms/posts?locale=tr', { title: `Yalnız Türkçe ${id}`, slug: `yalniz-turkce-${id}`, body: richText('Metin'), _status: 'published' });
  expect(trOnly.status, JSON.stringify(trOnly.json)).toBe(201);

  for (const [category, question, answer] of [
    ['cancellation', `Rezervasyonumu iptal edebilir miyim? ${id}`, 'Evet; iptal koşulları fiyatın yanında yazar.'],
    ['payment', `Hangi kartlarla ödeyebilirim? ${id}`, 'Visa ve Mastercard ile ödeyebilirsiniz.'],
  ] as const) {
    const q = await call(page, 'POST', '/api/cms/faqs?locale=tr', { question, answer: richText(answer), category, _status: 'published' });
    expect(q.status, JSON.stringify(q.json)).toBe(201);
  }

  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();

  // Hub: the article card; the Turkish-only article too.
  await visitor.goto('/tr/rehber');
  await expect(visitor.getByRole('heading', { level: 1, name: 'Seyahat rehberi' })).toBeVisible();
  await expect(visitor.getByTestId('guide-cards').getByRole('link', { name: `Kemer gezi rehberi ${id}`, exact: true })).toBeVisible();
  await expect(visitor.getByTestId('guide-cards').getByRole('link', { name: `Yalnız Türkçe ${id}`, exact: true })).toBeVisible();
  // Newest first: published without a date, it got the publishing moment and comes before the 1 October article.
  const titles = await visitor.getByTestId('guide-cards').locator('h2').allInnerTexts();
  expect(titles.indexOf(`Yalnız Türkçe ${id}`)).toBeLessThan(titles.indexOf(`Kemer gezi rehberi ${id}`));

  // Article: text, Article + BreadcrumbList markup, hreflang to the English article, canonical.
  await visitor.getByTestId('guide-cards').getByRole('link', { name: `Kemer gezi rehberi ${id}`, exact: true }).click();
  await expect(visitor).toHaveURL(new RegExp(`/tr/rehber/${trSlug}$`));
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(`Kemer gezi rehberi ${id}`);
  await expect(visitor.getByText('Her şey dahil oteller sahil boyunca sıralanır.')).toBeVisible();
  const blocks = await ld(visitor);
  expect(blocks.find((b) => b['@type'] === 'Article')).toMatchObject({ headline: `Kemer gezi rehberi ${id}`, inLanguage: 'tr', datePublished: '2026-10-01T09:00:00.000Z', url: expect.stringMatching(new RegExp(`/tr/rehber/${trSlug}$`)) });
  expect(blocks.some((b) => b['@type'] === 'BreadcrumbList')).toBe(true);
  await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/tr/rehber/${trSlug}$`));
  await expect(visitor.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', new RegExp(`/en/guides/${enSlug}$`));

  // English: only the English article; each language keeps its own directory.
  await visitor.goto('/en/guides');
  await expect(visitor.getByTestId('guide-cards').getByRole('link', { name: `Kemer travel guide ${id}`, exact: true })).toBeVisible();
  await expect(visitor.getByText(`Yalnız Türkçe ${id}`)).toHaveCount(0);
  expect((await visitor.goto(`/en/guides/yalniz-turkce-${id}`))!.status()).toBe(404);
  expect((await visitor.goto('/en/rehber'))!.status()).toBe(404);
  expect((await visitor.goto(`/tr/guides/${enSlug}`))!.status()).toBe(404);

  // FAQ: by topic, answers on the page, FAQPage markup of what is shown.
  await visitor.goto('/tr/sss');
  await expect(visitor.getByRole('heading', { level: 1, name: 'Sık sorulan sorular' })).toBeVisible();
  const cancel = visitor.getByTestId('faq-cancellation');
  await expect(cancel.getByRole('heading', { level: 2 })).toHaveText('İptal ve iade');
  await cancel.getByText(`Rezervasyonumu iptal edebilir miyim? ${id}`).click();
  await expect(cancel.getByText('Evet; iptal koşulları fiyatın yanında yazar.')).toBeVisible();
  const faq = (await ld(visitor)).find((b) => b['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
  expect(faq.mainEntity).toContainEqual({ '@type': 'Question', name: `Hangi kartlarla ödeyebilirim? ${id}`, acceptedAnswer: { '@type': 'Answer', text: 'Visa ve Mastercard ile ödeyebilirsiniz.' } });
  // No English questions yet: the English page is not indexed.
  await visitor.goto('/en/faq');
  await expect(visitor.getByText('No question is published yet.')).toBeVisible();
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  const sitemap = await (await visitor.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(`/tr/rehber/${trSlug}`);
  expect(sitemap).toContain(`/en/guides/${enSlug}`);
  expect(sitemap).toMatch(/\/tr\/sss</);
  expect(sitemap).toMatch(/\/tr\/rehber</);
  await ctx.close();
});
