import type { Field, GlobalConfig } from 'payload';
import { canEdit, canPublish } from '../access';

/** Internal paths or https links only (no javascript:, data: or other schemes). */
const hrefField = (): Field => ({
  name: 'href',
  type: 'text',
  // Per language: the English menu links to /en/... pages, the Turkish one to /tr/... pages.
  localized: true,
  required: true,
  maxLength: 300,
  label: { tr: 'Adres', en: 'Address' },
  validate: (v: unknown) => (typeof v === 'string' && (/^\/[a-z0-9/_?=&#-]*$/i.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v)) ? true : 'Site içi adres (/tr/...) veya https:// bağlantısı girin.'),
});

const link = (): Field[] => [{ name: 'label', type: 'text', localized: true, required: true, maxLength: 60, label: { tr: 'Metin', en: 'Label' } }, hrefField()];

/** Menus change the live site at once: publishing permission is needed. */
const access = { read: () => true, update: ({ req }: { req: Parameters<typeof canPublish>[0] }) => canPublish(req) && canEdit(req) };

export const Navigation: GlobalConfig = {
  slug: 'navigation',
  label: { tr: 'Üst menü', en: 'Main menu' },
  access,
  fields: [{ name: 'items', type: 'array', maxRows: 8, label: { tr: 'Menü bağlantıları', en: 'Menu links' }, fields: link() }],
};

export const Footer: GlobalConfig = {
  slug: 'footer',
  label: { tr: 'Alt bilgi', en: 'Footer' },
  access,
  fields: [
    {
      name: 'columns',
      type: 'array',
      maxRows: 4,
      label: { tr: 'Sütunlar', en: 'Columns' },
      fields: [
        { name: 'heading', type: 'text', localized: true, maxLength: 60, label: { tr: 'Başlık', en: 'Heading' } },
        { name: 'links', type: 'array', maxRows: 10, label: { tr: 'Bağlantılar', en: 'Links' }, fields: link() },
      ],
    },
    { name: 'legal', type: 'textarea', localized: true, maxLength: 600, label: { tr: 'Yasal metin', en: 'Legal text' } },
  ],
};
