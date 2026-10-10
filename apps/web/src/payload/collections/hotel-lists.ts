import { ValidationError, type CollectionAfterChangeHook, type CollectionAfterDeleteHook, type CollectionBeforeChangeHook, type CollectionConfig, type Field, type GlobalAfterChangeHook, type GlobalConfig } from 'payload';
import { canEdit, canPublish, contentStaff, editors, guardPublish, publishedOrStaff, publishers } from '../access';
import { guardSlug, seoField, slugField } from '../fields';

/**
 * Hotel list pages (ADR-0014): editors choose places and/or hotel codes, filters and order; the site shows the hotels
 * with the lowest price of the next 30 days. After a publish commits, the list is copied to `core.hotel_lists`, which
 * the worker (price scans) and the pages read (ADR-0003: the CMS writes no core table itself, the copy goes through the
 * core repository). No amounts are stored here (the CMS holds no financial fields).
 */

const HOTEL_CODE = /^[\w-]{2,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const codesField = (name: string, label: { tr: string; en: string }, description: { tr: string; en: string }, maxRows: number): Field => ({
  name,
  type: 'text',
  hasMany: true,
  maxRows,
  label,
  admin: { description },
  validate: (value: unknown) => {
    const list = Array.isArray(value) ? value : [];
    const bad = list.find((v) => typeof v !== 'string' || !HOTEL_CODE.test(v));
    return bad === undefined ? true : `Geçersiz otel kodu: ${String(bad)} (harf, rakam, - ve _).`;
  },
});

/** Publishing needs a source: a place or hotel codes. Pure (no I/O): it runs before validation. */
export const guardHotelListSource: CollectionBeforeChangeHook = ({ data, req, collection }) => {
  if (data?._status !== 'published') return data;
  const places = Array.isArray(data.places) ? data.places : [];
  const codes = [...(Array.isArray(data.include) ? data.include : []), ...(Array.isArray(data.pinned) ? data.pinned : [])];
  if (places.length === 0 && codes.length === 0) {
    throw new ValidationError({ collection: collection.slug, errors: [{ path: 'places', message: 'En az bir bölge veya otel kodu girin.' }], req });
  }
  if (typeof data.slug === 'string' && UUID.test(data.slug)) {
    throw new ValidationError({ collection: collection.slug, errors: [{ path: 'slug', message: 'Bu adres biçimi kullanılamaz.' }], req });
  }
  return data;
};

interface PublishedList {
  id: string | number;
  _status?: string;
  updatedAt?: string;
  title?: Record<string, string | null>;
  slug?: Record<string, string | null>;
  places?: Array<{ placeId?: string; name?: string | null; address?: string | null }>;
  include?: string[] | null;
  exclude?: string[] | null;
  pinned?: string[] | null;
  stars?: string[] | null;
  boardType?: string | null;
  sort?: string | null;
  maxItems?: number | null;
}

async function listRepository() {
  // Imported on use: the CMS CLI (migrations) loads this config without a core database.
  const [{ HotelListRepository }, { coreDatabase }] = await Promise.all([import('@texholiday/db'), import('../../server/core')]);
  return new HotelListRepository(coreDatabase().db);
}

const byLocale = (v: Record<string, string | null> | undefined) => Object.fromEntries(Object.entries(v ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));

/** The core copy of the published list (shape: hotelListConfigSchema in @texholiday/booking). */
export function mirrorOf(doc: PublishedList) {
  return {
    cmsId: String(doc.id),
    slugs: byLocale(doc.slug),
    titles: byLocale(doc.title),
    published: doc._status === 'published',
    cmsUpdatedAt: doc.updatedAt ?? '',
    config: {
      places: (doc.places ?? []).filter((p) => typeof p.placeId === 'string').map((p) => ({ placeId: p.placeId!, name: p.name ?? '', address: p.address ?? '' })),
      include: doc.include ?? [],
      exclude: doc.exclude ?? [],
      pinned: doc.pinned ?? [],
      stars: (doc.stars ?? []).map(Number).filter((n) => Number.isInteger(n)),
      boardType: doc.boardType && doc.boardType !== 'ANY' ? doc.boardType : null,
      sort: doc.sort ?? 'TOP_PICKS',
      maxItems: doc.maxItems ?? 30,
    },
  };
}

/**
 * After every change the published version is read again (not the request data: it may hold one locale, or be a draft
 * or an unpublish) and copied to core. A failed copy fails the request, so the publish is rolled back.
 */
export const mirrorHotelList: CollectionAfterChangeHook = async ({ doc, req }) => {
  const published = (await req.payload
    .findByID({ collection: 'hotel-lists', id: doc.id, draft: false, locale: 'all', depth: 0, overrideAccess: true, req })
    .catch(() => null)) as PublishedList | null;
  const repo = await listRepository();
  const now = new Date();
  if (published && published._status === 'published') await repo.upsertList(mirrorOf(published), now);
  else await repo.setPublished(String(doc.id), false, now);
  return doc;
};

export const unmirrorHotelList: CollectionAfterDeleteHook = async ({ id }) => {
  await (await listRepository()).setPublished(String(id), false, new Date());
};

const BOARD_OPTIONS = [
  { value: 'ANY', label: { tr: 'Hepsi', en: 'Any' } },
  { value: 'AI', label: { tr: 'Her şey dahil', en: 'All inclusive' } },
  { value: 'FB', label: { tr: 'Tam pansiyon', en: 'Full board' } },
  { value: 'HB', label: { tr: 'Yarım pansiyon', en: 'Half board' } },
  { value: 'BI', label: { tr: 'Kahvaltı dahil', en: 'Breakfast included' } },
  { value: 'RO', label: { tr: 'Yalnız oda', en: 'Room only' } },
];

export const HotelLists: CollectionConfig = {
  slug: 'hotel-lists',
  labels: { singular: { tr: 'Otel listesi', en: 'Hotel list' }, plural: { tr: 'Otel listeleri', en: 'Hotel lists' } },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
    description: {
      tr: 'Ör. "Antalya Otelleri": bölge veya otel kodlarıyla liste kurun. Sitede /tr/oteller/{adres} adresinde, önümüzdeki 30 günün en düşük fiyatıyla (1 oda, 2 yetişkin, 1 gece) yayınlanır.',
      en: 'E.g. "Antalya hotels": build a list from places or hotel codes. Published at /en/hotels/{address} with the lowest price of the next 30 days (1 room, 2 adults, 1 night).',
    },
    preview: (doc: Record<string, unknown>, { locale }: { locale: string }) => {
      const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
      return typeof doc.slug === 'string' ? `${base}/api/cms-preview?collection=hotel-lists&slug=${encodeURIComponent(doc.slug)}&locale=${locale}` : null;
    },
  },
  versions: { drafts: true, maxPerDoc: 50 },
  access: { read: publishedOrStaff, readVersions: contentStaff, create: editors, update: editors, delete: publishers },
  hooks: { beforeChange: [guardPublish, guardSlug, guardHotelListSource], afterChange: [mirrorHotelList], afterDelete: [unmirrorHotelList] },
  fields: [
    { name: 'title', type: 'text', localized: true, required: true, maxLength: 120, label: { tr: 'Başlık (H1)', en: 'Title (H1)' } },
    slugField(),
    {
      name: 'intro',
      type: 'textarea',
      localized: true,
      maxLength: 600,
      label: { tr: 'Giriş metni (listenin üstünde)', en: 'Intro (above the list)' },
      admin: { description: { tr: 'Arama motorları ve yapay zekâ özetleri bu metni okur: bölgeyi ve listeyi 2-3 cümlede anlatın.', en: 'Search engines and AI summaries read this: describe the area and the list in 2-3 sentences.' } },
    },
    {
      type: 'collapsible',
      label: { tr: 'Oteller nereden gelsin?', en: 'Where do the hotels come from?' },
      fields: [
        {
          name: 'places',
          type: 'array',
          maxRows: 10,
          label: { tr: 'Bölgeler', en: 'Places' },
          admin: {
            description: {
              tr: 'Bölgenin tüm otelleri listeye girer. Aynı adlı yerlere dikkat: adres/ülke bilgisine bakın (ör. Roma, İtalya ↔ Rome, ABD). Antalya şehirdir; Belek, Kemer, Side gibi yerleri ayrıca ekleyin.',
              en: 'All hotels of the place join the list. Mind places with the same name: check the address/country (e.g. Rome, Italy vs Rome, USA).',
            },
          },
          fields: [
            { name: 'placeId', type: 'text', required: true, maxLength: 200, label: { tr: 'Yer', en: 'Place' }, admin: { components: { Field: '/payload/components/PlacePicker#PlacePicker' } } },
            { name: 'name', type: 'text', maxLength: 200, label: { tr: 'Yer adı', en: 'Place name' }, admin: { readOnly: true } },
            { name: 'address', type: 'text', maxLength: 300, label: { tr: 'Adres / ülke', en: 'Address / country' }, admin: { readOnly: true } },
          ],
        },
        codesField('include', { tr: 'Eklenecek otel kodları', en: 'Hotel codes to add' }, { tr: 'Otel kodu, otel sayfası adresinin sonundaki koddur (ör. …-lp1897 → lp1897).', en: 'The hotel code is the end of the hotel page address (e.g. …-lp1897 → lp1897).' }, 200),
        codesField('exclude', { tr: 'Çıkarılacak otel kodları', en: 'Hotel codes to remove' }, { tr: 'Bölgeden gelse bile gösterilmez.', en: 'Never shown, even when a place brings it.' }, 500),
        codesField('pinned', { tr: 'Başa sabitlenecek otel kodları', en: 'Hotel codes pinned to the top' }, { tr: 'Bu sırayla en üstte gösterilir.', en: 'Shown first, in this order.' }, 50),
      ],
    },
    {
      type: 'collapsible',
      label: { tr: 'Filtre ve sıralama', en: 'Filters and order' },
      fields: [
        {
          name: 'stars',
          type: 'select',
          hasMany: true,
          label: { tr: 'Yıldız (boş = hepsi)', en: 'Stars (empty = all)' },
          options: ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: `${v} ★` })),
        },
        { name: 'boardType', type: 'select', required: true, defaultValue: 'ANY', label: { tr: 'Pansiyon', en: 'Board' }, options: BOARD_OPTIONS },
        {
          name: 'sort',
          type: 'select',
          required: true,
          defaultValue: 'TOP_PICKS',
          label: { tr: 'Sıralama', en: 'Order' },
          options: [
            { value: 'TOP_PICKS', label: { tr: 'Öne çıkanlar (sağlayıcı sırası)', en: 'Top picks (provider order)' } },
            { value: 'PRICE', label: { tr: 'Fiyat: en düşük önce (bütçe dostu)', en: 'Price: lowest first (budget)' } },
            { value: 'MANUAL', label: { tr: 'Elle: eklenen kod sırası', en: 'Manual: order of the added codes' } },
          ],
        },
        { name: 'maxItems', type: 'number', required: true, defaultValue: 30, min: 3, max: 60, label: { tr: 'En çok kaç otel gösterilsin', en: 'Most hotels shown' } },
      ],
    },
    { name: 'heroImage', type: 'upload', relationTo: 'media', label: { tr: 'Kapak görseli', en: 'Cover image' } },
    { name: 'body', type: 'richText', localized: true, label: { tr: 'Listenin altındaki metin', en: 'Text below the list' } },
    {
      name: 'faq',
      type: 'array',
      localized: true,
      maxRows: 12,
      label: { tr: 'Sık sorulan sorular', en: 'FAQ' },
      fields: [
        { name: 'question', type: 'text', required: true, maxLength: 200, label: { tr: 'Soru', en: 'Question' } },
        { name: 'answer', type: 'textarea', required: true, maxLength: 1200, label: { tr: 'Cevap', en: 'Answer' } },
      ],
    },
    seoField(),
  ],
};

const currencyField = (locale: 'tr' | 'en'): Field[] => [
  {
    name: `${locale}Currency`,
    type: 'text',
    maxLength: 3,
    label: { tr: `${locale.toUpperCase()} sayfaları: para birimi`, en: `${locale.toUpperCase()} pages: currency` },
    admin: { description: { tr: 'ISO kodu, ör. EUR veya TRY. Boşsa bu dilde fiyat gösterilmez.', en: 'ISO code, e.g. EUR or TRY. Empty: no prices in this language.' } },
    validate: (v: unknown) => (v === undefined || v === null || v === '' || (typeof v === 'string' && /^[A-Z]{3}$/.test(v)) ? true : 'Büyük harfli 3 harf, ör. EUR.'),
  },
  {
    name: `${locale}Nationality`,
    type: 'text',
    maxLength: 2,
    label: { tr: `${locale.toUpperCase()} sayfaları: misafir uyruğu`, en: `${locale.toUpperCase()} pages: guest nationality` },
    admin: { description: { tr: 'Fiyat bu uyruk için alınır ve "Fiyatları gör" araması da bununla açılır. ISO kodu, ör. TR.', en: 'Prices are taken for this nationality; "see prices" opens the search with it. ISO code, e.g. GB.' } },
    validate: (v: unknown) => (v === undefined || v === null || v === '' || (typeof v === 'string' && /^[A-Z]{2}$/.test(v)) ? true : 'Büyük harfli 2 harf, ör. TR.'),
  },
];

interface SettingsDoc {
  trCurrency?: string | null;
  trNationality?: string | null;
  enCurrency?: string | null;
  enNationality?: string | null;
  maxPriceAgeHours?: number | null;
}

/** The core copy of the settings (shape: hotelListSettingsSchema in @texholiday/booking). */
export function settingsMirrorOf(doc: SettingsDoc) {
  const locale = (c?: string | null, n?: string | null) => (c && n ? { currency: c, nationality: n } : null);
  return { locales: { tr: locale(doc.trCurrency, doc.trNationality), en: locale(doc.enCurrency, doc.enNationality) }, maxPriceAgeHours: doc.maxPriceAgeHours ?? null };
}

const mirrorSettings: GlobalAfterChangeHook = async ({ doc }) => {
  const [{ HotelListRepository }, { coreDatabase }] = await Promise.all([import('@texholiday/db'), import('../../server/core')]);
  await new HotelListRepository(coreDatabase().db).saveSettings(settingsMirrorOf(doc as SettingsDoc), new Date());
  return doc;
};

/** Prices change what visitors see at once: publishing permission is needed. */
export const HotelListSettings: GlobalConfig = {
  slug: 'hotel-list-settings',
  label: { tr: 'Otel listesi fiyat ayarları', en: 'Hotel list price settings' },
  admin: {
    description: {
      tr: 'Liste ve otel sayfalarında gösterilen fiyatın para birimi, misafir uyruğu ve en fazla kaç saatlik olabileceği. Girilmeyen dilde fiyat gösterilmez; varsayılan konmaz.',
      en: 'Currency, guest nationality and maximum age of the prices shown on list and hotel pages. No prices in a language without settings; nothing is defaulted.',
    },
  },
  access: { read: ({ req }) => canEdit(req) || canPublish(req), update: ({ req }) => canPublish(req) && canEdit(req) },
  hooks: { afterChange: [mirrorSettings] },
  fields: [
    ...currencyField('tr'),
    ...currencyField('en'),
    {
      name: 'maxPriceAgeHours',
      type: 'number',
      min: 1,
      max: 168,
      label: { tr: 'Fiyat en fazla kaç saatlik olabilir', en: 'Maximum price age (hours)' },
      admin: { description: { tr: 'Daha eski fiyat gösterilmez. Fiyatlar günde bir yenilenir; 26 saat gibi bir değer bir gecikmeyi tolere eder.', en: 'Older prices are hidden. Prices refresh daily; a value like 26 hours tolerates one delay.' } },
    },
  ],
};
