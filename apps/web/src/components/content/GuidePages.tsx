import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { dict, type Locale } from '../../i18n/dictionaries';
import { formatInstant } from '../../i18n/format';
import { listFaqs, listPosts, loadBySlug } from '../../server/cms-content';
import { FAQ_DIR, GUIDE_DIR, PATHS } from '../../server/seo';
import { breadcrumbList, faqPage, guideArticle, jsonLd, lexicalText } from '../../server/structured-data';
import { cmsMetadata, PreviewBanner } from '../cms/CmsPage';
import { RichText } from '../cms/RichText';

/**
 * Guide articles and the FAQ page (P06): /tr/rehber, /en/guides (+ /{slug}), /tr/sss, /en/faq. Each language has its own
 * directory and only the documents written in it; everything marked up is visible on the page.
 */
const origin = () => process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
export const guideHubPath = (l: Locale) => `/${l}/${GUIDE_DIR[l]}`;
export const guidePath = (l: Locale, slug: string) => PATHS.posts(l, slug);
export const faqPath = (l: Locale) => `/${l}/${FAQ_DIR[l]}`;
const PER_PAGE = 24;

type Media = { url?: string | null; alt?: string | null; width?: number | null; height?: number | null } | null | undefined | number | string;
const day = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' }).format(new Date(iso));

/** Page number from `?sayfa=`; anything else is page 1. */
export function pageNumber(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
}

function Breadcrumbs({ crumbs }: { crumbs: ReadonlyArray<{ name: string; path: string }> }) {
  return (
    <nav aria-label="breadcrumb" className="breadcrumbs">
      <ol>
        {crumbs.map((c, i) => (
          <li key={c.path}>{i < crumbs.length - 1 ? <a href={c.path}>{c.name}</a> : <span aria-current="page">{c.name}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

const hubPage = (l: Locale, page: number) => `${guideHubPath(l)}${page > 1 ? `?sayfa=${page}` : ''}`;

export async function guideHubMetadata(locale: Locale, page: number): Promise<Metadata> {
  const t = dict(locale).guides;
  const { posts, totalPages } = await listPosts(locale, page, PER_PAGE);
  const title = page > 1 ? `${t.hubTitle} · ${t.page(page)}` : t.hubTitle;
  return {
    title,
    description: t.hubIntro,
    alternates: {
      canonical: `${origin()}${hubPage(locale, page)}`,
      // Page 1 of each language links to the other; deeper pages hold different articles per language.
      ...(page === 1 ? { languages: { tr: `${origin()}${guideHubPath('tr')}`, en: `${origin()}${guideHubPath('en')}`, 'x-default': `${origin()}${guideHubPath('tr')}` } } : {}),
    },
    // An empty or out-of-range page is not worth indexing.
    ...(posts.length === 0 || page > totalPages ? { robots: { index: false, follow: true } } : {}),
  };
}

/** /tr/rehber and /en/guides: the articles written in the language, newest first, 24 per page. */
export async function GuideHub({ locale, page }: { locale: Locale; page: number }) {
  const t = dict(locale).guides;
  const { posts, totalPages } = await listPosts(locale, page, PER_PAGE);
  if (page > 1 && posts.length === 0) notFound();
  const crumbs = [
    { name: t.home, path: `/${locale}` },
    { name: t.hubTitle, path: guideHubPath(locale) },
  ];
  return (
    <div className="page guide-hub">
      <Breadcrumbs crumbs={crumbs} />
      <h1>{t.hubTitle}</h1>
      <p className="lead">{t.hubIntro}</p>
      {posts.length === 0 ? (
        <p className="card">{t.none}</p>
      ) : (
        <ul className="guide-cards" data-testid="guide-cards">
          {posts.map((p) => (
            <li key={p.slug} className="card">
              {p.image && (
                // eslint-disable-next-line @next/next/no-img-element -- CMS image with its stored size
                <img src={p.image.url} alt={p.image.alt ?? ''} width={p.image.width ?? undefined} height={p.image.height ?? undefined} loading="lazy" />
              )}
              <h2>
                <a href={guidePath(locale, p.slug)}>{p.title}</a>
              </h2>
              {p.publishedAt && (
                <p className="muted small">
                  <time dateTime={p.publishedAt}>{day(p.publishedAt, locale)}</time>
                </p>
              )}
              {p.excerpt && <p>{p.excerpt}</p>}
              <a href={guidePath(locale, p.slug)} aria-label={`${t.readMore}: ${p.title}`}>
                {t.readMore} →
              </a>
            </li>
          ))}
        </ul>
      )}
      {totalPages > 1 && (
        <nav className="pager" aria-label={t.hubTitle}>
          {page > 1 && (
            <a href={hubPage(locale, page - 1)} rel="prev">
              ← {t.previous}
            </a>
          )}
          <span>{t.page(page)}</span>
          {page < totalPages && (
            <a href={hubPage(locale, page + 1)} rel="next">
              {t.next} →
            </a>
          )}
        </nav>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList(origin(), crumbs)) }} />
    </div>
  );
}

export async function guideMetadata(locale: Locale, slug: string): Promise<Metadata> {
  const loaded = await loadBySlug('posts', slug, locale);
  if (!loaded) return {};
  const m = cmsMetadata(loaded, locale, guidePath, { title: String(loaded.doc.title ?? ''), description: (loaded.doc.excerpt as string | null) ?? null });
  const tr = loaded.slugs.tr;
  return {
    ...m,
    alternates: { ...m.alternates, languages: { ...(m.alternates?.languages ?? {}), ...(tr ? { 'x-default': `${origin()}${guidePath('tr', tr)}` } : {}) } },
    openGraph: { ...m.openGraph, type: 'article' },
  };
}

/** A guide article: text, cover, dates, the destination it is about; `Article` and breadcrumb markup. */
export async function GuidePage({ locale, slug }: { locale: Locale; slug: string }) {
  const loaded = await loadBySlug('posts', slug, locale);
  if (!loaded) notFound();
  const t = dict(locale).guides;
  const d = loaded.doc;
  const title = String(d.title ?? '');
  const image = d.coverImage as Media;
  const imageUrl = image && typeof image === 'object' && image.url ? image.url : null;
  const publishedAt = typeof d.publishedAt === 'string' ? d.publishedAt : null;
  const updatedAt = typeof d.updatedAt === 'string' ? d.updatedAt : null;
  const destination = d.destination && typeof d.destination === 'object' ? (d.destination as { name?: string | null; slug?: string | null; _status?: string }) : null;
  const destinationLink = destination?.slug && destination.name ? { name: destination.name, href: PATHS.destinations(locale, destination.slug) } : null;
  const excerpt = typeof d.excerpt === 'string' && d.excerpt ? d.excerpt : null;
  const crumbs = [
    { name: t.home, path: `/${locale}` },
    { name: t.hubTitle, path: guideHubPath(locale) },
    { name: title, path: guidePath(locale, slug) },
  ];
  const article = guideArticle({
    origin: origin(),
    url: guidePath(locale, slug),
    headline: title,
    description: excerpt,
    images: imageUrl ? [imageUrl] : [],
    datePublished: publishedAt,
    dateModified: updatedAt,
    language: locale,
    siteName: dict(locale).brand,
  });
  return (
    <article className="page cms-page guide">
      {loaded.preview && <PreviewBanner locale={locale} />}
      <Breadcrumbs crumbs={crumbs} />
      <h1>{title}</h1>
      <p className="muted small">
        {publishedAt && (
          <>
            {t.published}: <time dateTime={publishedAt}>{day(publishedAt, locale)}</time>
          </>
        )}
        {updatedAt && (
          <>
            {publishedAt ? ' · ' : ''}
            {t.updated}: <time dateTime={updatedAt}>{formatInstant(updatedAt, locale)}</time>
          </>
        )}
      </p>
      {excerpt && <p className="lead">{excerpt}</p>}
      {imageUrl && typeof image === 'object' && image && (
        // eslint-disable-next-line @next/next/no-img-element -- CMS image with its stored size
        <img className="cms-hero-image" src={imageUrl} alt={image.alt ?? ''} width={image.width ?? undefined} height={image.height ?? undefined} />
      )}
      <section className="cms-text">
        <RichText data={d.body} />
      </section>
      {destinationLink && (
        <p>
          {t.destination}: <a href={destinationLink.href}>{destinationLink.name}</a>
        </p>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(article) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList(origin(), crumbs)) }} />
    </article>
  );
}

export async function faqMetadata(locale: Locale): Promise<Metadata> {
  const t = dict(locale).faq;
  const items = await listFaqs(locale);
  return {
    title: t.title,
    description: t.intro,
    alternates: { canonical: `${origin()}${faqPath(locale)}`, languages: { tr: `${origin()}${faqPath('tr')}`, en: `${origin()}${faqPath('en')}`, 'x-default': `${origin()}${faqPath('tr')}` } },
    ...(items.length === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

const CATEGORY_ORDER = ['general', 'booking', 'payment', 'cancellation'];

/** /tr/sss and /en/faq: every published question in the language, by topic; `FAQPage` markup of what is shown. */
export async function FaqPage({ locale }: { locale: Locale }) {
  const t = dict(locale).faq;
  const items = await listFaqs(locale);
  const groups = [...new Set([...CATEGORY_ORDER, ...items.map((i) => i.category)])]
    .map((c) => ({ category: c, items: items.filter((i) => i.category === c) }))
    .filter((g) => g.items.length > 0);
  const markup = faqPage(items.map((i) => ({ question: i.question, answer: lexicalText(i.answer) })));
  const crumbs = [
    { name: t.home, path: `/${locale}` },
    { name: t.title, path: faqPath(locale) },
  ];
  return (
    <div className="page faq-page">
      <Breadcrumbs crumbs={crumbs} />
      <h1>{t.title}</h1>
      <p className="lead">{t.intro}</p>
      {groups.length === 0 ? (
        <p className="card">{t.none}</p>
      ) : (
        groups.map((g) => (
          <section key={g.category} className="faq" data-testid={`faq-${g.category}`}>
            <h2>{t.categories[g.category] ?? g.category}</h2>
            {g.items.map((q) => (
              <details key={q.id}>
                <summary>{q.question}</summary>
                <RichText data={q.answer} />
              </details>
            ))}
          </section>
        ))
      )}
      {markup && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(markup) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList(origin(), crumbs)) }} />
    </div>
  );
}
