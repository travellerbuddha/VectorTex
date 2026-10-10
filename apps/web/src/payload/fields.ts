import { ValidationError, type CollectionBeforeChangeHook, type Field } from 'payload';

/** Site paths that belong to the booking engine and panel; a page may not take them. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(['checkout', 'hotels', 'orders', 'terms', 'destinations', 'api', 'yonetim', 'tr', 'en']);

export function slugProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 80) return 'Küçük harf, rakam ve tire kullanın (en fazla 80 karakter).';
  return RESERVED_SLUGS.has(value) ? 'Bu adres sitede başka bir bölüme ait; başka bir adres seçin.' : null;
}

/** Payload skips field validation for drafts; the address rule applies to every save. */
export const guardSlug: CollectionBeforeChangeHook = ({ data, req, collection }) => {
  if (data && 'slug' in data && data.slug !== undefined && data.slug !== null) {
    const problem = slugProblem(data.slug);
    if (problem) throw new ValidationError({ collection: collection.slug, errors: [{ path: 'slug', message: problem }], req });
  }
  return data;
};

/** Lowercase words joined by dashes; the URL part of a page (per language). */
export const slugField = (): Field => ({
  name: 'slug',
  type: 'text',
  label: { tr: 'Adres (URL)', en: 'Address (URL)' },
  localized: true,
  required: true,
  unique: true,
  index: true,
  admin: { position: 'sidebar', description: { tr: 'Küçük harf, rakam ve tire. Ör. antalya-otelleri', en: 'Lowercase letters, digits and dashes, e.g. antalya-hotels' } },
  validate: (value: unknown) => slugProblem(value) ?? true,
});

/** Search engine and sharing fields; empty values fall back to the page title and summary. */
export const seoField = (): Field => ({
  name: 'seo',
  type: 'group',
  label: 'SEO',
  fields: [
    { name: 'title', type: 'text', localized: true, maxLength: 70, label: { tr: 'Başlık (arama sonuçları)', en: 'Title (search results)' } },
    { name: 'description', type: 'textarea', localized: true, maxLength: 170, label: { tr: 'Açıklama', en: 'Description' } },
    { name: 'image', type: 'upload', relationTo: 'media', label: { tr: 'Paylaşım görseli', en: 'Sharing image' } },
    {
      name: 'noindex',
      type: 'checkbox',
      defaultValue: false,
      label: { tr: 'Arama motorlarında gösterme', en: 'Hide from search engines' },
    },
  ],
});
