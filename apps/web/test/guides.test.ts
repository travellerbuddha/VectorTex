import { describe, expect, it } from 'vitest';
import { slugProblem } from '../src/payload/fields';
import { sitemapEntries } from '../src/server/seo';
import { faqPage, guideArticle, lexicalText } from '../src/server/structured-data';

/** Guide articles and the FAQ page (P06): addresses, sitemap, structured data. */
const para = (...texts: string[]) => ({ type: 'paragraph', children: texts.map((text) => ({ type: 'text', text })) });

describe('guide and FAQ pages', () => {
  it('their directories cannot be taken by a CMS page address', () => {
    for (const s of ['rehber', 'guides', 'sss', 'faq']) expect(slugProblem(s)).not.toBeNull();
    expect(slugProblem('antalya-rehberi')).toBeNull();
  });

  it('sitemap: articles per language with hreflang; the hubs only once they have content', () => {
    const docs = [{ collection: 'posts' as const, slugs: { tr: 'kemer-gezi-rehberi', en: 'kemer-travel-guide' }, noindex: false, updatedAt: '2026-10-01T10:00:00Z' }];
    const urls = sitemapEntries('https://www.texholiday.com', docs).map((e) => e.url);
    expect(urls).toContain('https://www.texholiday.com/tr/rehber/kemer-gezi-rehberi');
    expect(urls).toContain('https://www.texholiday.com/en/guides/kemer-travel-guide');
    expect(urls).not.toContain('https://www.texholiday.com/tr/rehber');
    expect(urls).not.toContain('https://www.texholiday.com/tr/sss');
    const withHubs = sitemapEntries('https://www.texholiday.com', docs, { guides: true, faq: true });
    const sss = withHubs.find((e) => e.url === 'https://www.texholiday.com/tr/sss')!;
    expect(sss.alternates?.languages).toEqual({ tr: 'https://www.texholiday.com/tr/sss', en: 'https://www.texholiday.com/en/faq' });
    expect(withHubs.map((e) => e.url)).toContain('https://www.texholiday.com/en/guides');
    const article = withHubs.find((e) => e.url.endsWith('/tr/rehber/kemer-gezi-rehberi'))!;
    expect(article.alternates?.languages).toEqual({ tr: 'https://www.texholiday.com/tr/rehber/kemer-gezi-rehberi', en: 'https://www.texholiday.com/en/guides/kemer-travel-guide' });
  });

  it('rich text becomes plain text for markup: one line per block, links keep their words, long text is cut', () => {
    const data = {
      root: {
        type: 'root',
        children: [
          para('Ücretsiz iptal, ', 'giriş tarihinden önce'),
          { type: 'list', children: [{ type: 'listitem', children: [{ type: 'text', text: 'Kart' }] }, { type: 'listitem', children: [{ type: 'link', children: [{ type: 'text', text: 'Havale' }] }] }] },
          { type: 'heading', children: [{ type: 'text', text: '  Not  ' }] },
        ],
      },
    };
    expect(lexicalText(data)).toBe('Ücretsiz iptal, giriş tarihinden önce\nKart\nHavale\nNot');
    expect(lexicalText({ root: { type: 'root', children: [para('a'.repeat(50))] } }, 10)).toBe(`${'a'.repeat(9)}…`);
    expect(lexicalText(null)).toBe('');
  });

  it('FAQPage holds only questions with an answer; none means no markup', () => {
    expect(faqPage([{ question: ' ', answer: 'x' }])).toBeNull();
    expect(faqPage([{ question: 'İptal edebilir miyim?', answer: 'Evet, koşullara göre.' }])).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'İptal edebilir miyim?', acceptedAnswer: { '@type': 'Answer', text: 'Evet, koşullara göre.' } }],
    });
  });

  it('Article: absolute addresses, ISO dates, the site as author and publisher', () => {
    const a = guideArticle({
      origin: 'https://www.texholiday.com',
      url: '/tr/rehber/kemer',
      headline: 'Kemer gezi rehberi',
      description: null,
      images: ['/media/kemer.jpg', 'javascript:alert(1)'],
      datePublished: '2026-10-01',
      dateModified: 'not a date',
      language: 'tr',
      siteName: 'TexHoliday',
    });
    expect(a).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Kemer gezi rehberi',
      url: 'https://www.texholiday.com/tr/rehber/kemer',
      mainEntityOfPage: 'https://www.texholiday.com/tr/rehber/kemer',
      image: ['https://www.texholiday.com/media/kemer.jpg'],
      datePublished: '2026-10-01T00:00:00.000Z',
      inLanguage: 'tr',
      author: { '@type': 'Organization', name: 'TexHoliday', url: 'https://www.texholiday.com/' },
      publisher: { '@type': 'Organization', name: 'TexHoliday', url: 'https://www.texholiday.com/' },
    });
  });
});
