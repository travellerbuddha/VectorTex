import type { CollectionBeforeChangeHook, CollectionConfig, Field } from 'payload';
import { contentStaff, editors, guardPublish, publishedOrStaff, publishers } from '../access';
import { PAGE_BLOCKS } from '../blocks';
import { guardSlug, seoField, slugField } from '../fields';

/** Site path of a published document, per collection (used for previews and links). */
export const SITE_PATHS: Record<string, (locale: string, slug: string) => string> = {
  pages: (locale, slug) => `/${locale}/${slug}`,
  destinations: (locale, slug) => `/${locale}/destinations/${slug}`,
  'hotel-lists': (locale, slug) => `/${locale}/${locale === 'tr' ? 'oteller' : 'hotels'}/${slug}`,
  posts: (locale, slug) => `/${locale}/${locale === 'tr' ? 'rehber' : 'guides'}/${slug}`,
};

const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';

/**
 * Shared settings of editorial collections: drafts with version history, publishing only with `content.publish`,
 * previews of drafts on the real site for content staff.
 */
function editorial(config: Omit<CollectionConfig, 'access' | 'versions'> & { previewable?: boolean }): CollectionConfig {
  const { previewable, ...rest } = config;
  return {
    ...rest,
    admin: {
      ...rest.admin,
      ...(previewable
        ? {
            preview: (doc: Record<string, unknown>, { locale }: { locale: string }) =>
              typeof doc.slug === 'string' ? `${base}/api/cms-preview?collection=${rest.slug}&slug=${encodeURIComponent(doc.slug)}&locale=${locale}` : null,
          }
        : {}),
    },
    versions: { drafts: true, maxPerDoc: 50 },
    access: { read: publishedOrStaff, readVersions: contentStaff, create: editors, update: editors, delete: publishers },
    hooks: { ...rest.hooks, beforeChange: [guardPublish, guardSlug, ...(rest.hooks?.beforeChange ?? [])] },
  };
}

const title = (label: { tr: string; en: string } = { tr: 'Başlık', en: 'Title' }): Field => ({ name: 'title', type: 'text', localized: true, required: true, maxLength: 120, label });

export const Pages = editorial({
  slug: 'pages',
  labels: { singular: { tr: 'Sayfa', en: 'Page' }, plural: { tr: 'Sayfalar', en: 'Pages' } },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status', 'updatedAt'] },
  previewable: true,
  fields: [
    title(),
    slugField(),
    { name: 'layout', type: 'blocks', localized: true, required: true, minRows: 1, blocks: PAGE_BLOCKS, label: { tr: 'İçerik blokları', en: 'Content blocks' } },
    seoField(),
  ],
});

export const Destinations = editorial({
  slug: 'destinations',
  labels: { singular: { tr: 'Destinasyon', en: 'Destination' }, plural: { tr: 'Destinasyonlar', en: 'Destinations' } },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'slug', '_status', 'updatedAt'] },
  previewable: true,
  fields: [
    { name: 'name', type: 'text', localized: true, required: true, maxLength: 80, label: { tr: 'Ad', en: 'Name' } },
    slugField(),
    { name: 'summary', type: 'textarea', localized: true, maxLength: 300, label: { tr: 'Kısa tanıtım', en: 'Summary' } },
    { name: 'heroImage', type: 'upload', relationTo: 'media', label: { tr: 'Kapak görseli', en: 'Cover image' } },
    { name: 'body', type: 'richText', localized: true, label: { tr: 'Metin', en: 'Text' } },
    {
      name: 'searchPlaceId',
      type: 'text',
      maxLength: 120,
      label: { tr: 'Otel arama yeri', en: 'Hotel search place' },
      admin: {
        description: {
          tr: 'Bu sayfadaki otel arama kutusu için yer kimliği (sitedeki arama önerisinden). Boşsa arama kutusu boş açılır.',
          en: 'Place id for the hotel search box on this page (from the site search suggestions). Empty: the box opens empty.',
        },
      },
    },
    seoField(),
  ],
});

/** A guide article published without a date gets the publishing moment (the guide list is newest first). */
export const stampPublishedAt: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if (data && data._status === 'published' && !data.publishedAt && !(originalDoc as { publishedAt?: string | null } | undefined)?.publishedAt) {
    data.publishedAt = new Date().toISOString();
  }
  return data;
};

export const Posts = editorial({
  slug: 'posts',
  previewable: true,
  hooks: { beforeChange: [stampPublishedAt] },
  labels: { singular: { tr: 'Rehber yazısı', en: 'Guide post' }, plural: { tr: 'Rehber yazıları', en: 'Guide posts' } },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status', 'publishedAt'] },
  fields: [
    title(),
    slugField(),
    { name: 'excerpt', type: 'textarea', localized: true, maxLength: 300, label: { tr: 'Özet', en: 'Excerpt' } },
    { name: 'coverImage', type: 'upload', relationTo: 'media', label: { tr: 'Kapak görseli', en: 'Cover image' } },
    { name: 'body', type: 'richText', localized: true, required: true, label: { tr: 'Metin', en: 'Text' } },
    { name: 'destination', type: 'relationship', relationTo: 'destinations', label: { tr: 'Destinasyon', en: 'Destination' } },
    { name: 'publishedAt', type: 'date', label: { tr: 'Yayın tarihi', en: 'Publication date' }, admin: { position: 'sidebar' } },
    seoField(),
  ],
});

export const Faqs = editorial({
  slug: 'faqs',
  labels: { singular: { tr: 'Soru (SSS)', en: 'Question (FAQ)' }, plural: { tr: 'Sık sorulan sorular', en: 'FAQs' } },
  admin: { useAsTitle: 'question', defaultColumns: ['question', 'category', '_status'] },
  fields: [
    { name: 'question', type: 'text', localized: true, required: true, maxLength: 200, label: { tr: 'Soru', en: 'Question' } },
    { name: 'answer', type: 'richText', localized: true, required: true, label: { tr: 'Cevap', en: 'Answer' } },
    {
      name: 'category',
      type: 'select',
      required: true,
      defaultValue: 'general',
      options: [
        { value: 'general', label: { tr: 'Genel', en: 'General' } },
        { value: 'booking', label: { tr: 'Rezervasyon', en: 'Booking' } },
        { value: 'payment', label: { tr: 'Ödeme', en: 'Payment' } },
        { value: 'cancellation', label: { tr: 'İptal ve iade', en: 'Cancellation and refund' } },
      ],
      label: { tr: 'Konu', en: 'Topic' },
    },
  ],
});

export const Campaigns = editorial({
  slug: 'campaigns',
  labels: { singular: { tr: 'Kampanya', en: 'Campaign' }, plural: { tr: 'Kampanyalar', en: 'Campaigns' } },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'validFrom', 'validTo', '_status'],
    description: {
      tr: 'Kampanya yalnız tanıtım metnidir. Fiyat indirimi yalnız onaylı fiyat politikasıyla uygulanır; buraya yazılan oran veya tutar fiyatı değiştirmez.',
      en: 'A campaign is promotional text only. Price discounts apply only through an approved pricing policy; rates or amounts written here do not change prices.',
    },
  },
  fields: [
    title(),
    { name: 'summary', type: 'textarea', localized: true, required: true, maxLength: 300, label: { tr: 'Kısa metin', en: 'Short text' } },
    { name: 'image', type: 'upload', relationTo: 'media', label: { tr: 'Görsel', en: 'Image' } },
    {
      name: 'linkPath',
      type: 'text',
      maxLength: 200,
      label: { tr: 'Bağlantı (site içi adres)', en: 'Link (site path)' },
      validate: (v: unknown) => (v === undefined || v === null || v === '' || (typeof v === 'string' && /^\/[a-z0-9/_-]*$/.test(v)) ? true : 'Site içi bir adres girin, ör. /tr/antalya'),
    },
    { name: 'validFrom', type: 'date', label: { tr: 'Başlangıç', en: 'Starts' } },
    { name: 'validTo', type: 'date', label: { tr: 'Bitiş', en: 'Ends' } },
  ],
});

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: { tr: 'Görsel', en: 'Image' }, plural: { tr: 'Görseller', en: 'Images' } },
  admin: { useAsTitle: 'alt' },
  upload: { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] },
  access: { read: () => true, create: editors, update: editors, delete: publishers },
  fields: [
    { name: 'alt', type: 'text', localized: true, required: true, maxLength: 200, label: { tr: 'Görsel açıklaması (erişilebilirlik)', en: 'Alt text (accessibility)' } },
    {
      name: 'rights',
      type: 'select',
      required: true,
      options: [
        { value: 'OWNED', label: { tr: 'Bize ait', en: 'Owned' } },
        { value: 'LICENSED', label: { tr: 'Lisanslı', en: 'Licensed' } },
        { value: 'PROVIDER', label: { tr: 'Tedarikçi içeriği (kullanım şartlarına bağlı)', en: 'Provider content (subject to its terms)' } },
      ],
      label: { tr: 'Kullanım hakkı', en: 'Usage rights' },
    },
    { name: 'source', type: 'text', maxLength: 200, label: { tr: 'Kaynak / lisans notu', en: 'Source / licence note' } },
  ],
};
