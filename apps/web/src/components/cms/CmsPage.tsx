import type { Metadata } from 'next';
import type { Locale } from '../../i18n/dictionaries';
import type { Loaded } from '../../server/cms-content';

type Media = { url?: string | null } | number | string | null | undefined;

/** SEO from the document: own title/description or its title and summary; hreflang for the languages it exists in. */
export function cmsMetadata(loaded: Loaded, locale: Locale, path: (l: Locale, slug: string) => string, fallback: { title: string; description?: string | null }): Metadata {
  const seo = (loaded.doc.seo ?? {}) as { title?: string | null; description?: string | null; image?: Media; noindex?: boolean | null };
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
  const languages: Record<string, string> = {};
  for (const [l, s] of Object.entries(loaded.slugs)) if (s) languages[l] = `${base}${path(l as Locale, s)}`;
  const own = loaded.slugs[locale];
  const image = seo.image && typeof seo.image === 'object' && seo.image.url ? [{ url: seo.image.url }] : undefined;
  return {
    title: seo.title || fallback.title,
    description: seo.description || fallback.description || undefined,
    alternates: { canonical: own ? `${base}${path(locale, own)}` : undefined, languages },
    openGraph: { title: seo.title || fallback.title, description: seo.description || fallback.description || undefined, images: image, locale },
    // Previews and pages marked by editors stay out of search engines.
    robots: loaded.preview || seo.noindex ? { index: false, follow: false } : undefined,
  };
}

/** Shown on drafts opened from the CMS preview button. */
export function PreviewBanner({ locale }: { locale: Locale }) {
  return (
    <p className="notice cms-preview" role="status">
      {locale === 'tr' ? 'Önizleme: yayınlanmamış değişiklikler görünüyor.' : 'Preview: unpublished changes are shown.'}{' '}
      <a href="/api/cms-preview/exit">{locale === 'tr' ? 'Önizlemeden çık' : 'Exit preview'}</a>
    </p>
  );
}
