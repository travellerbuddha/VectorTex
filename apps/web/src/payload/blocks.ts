import type { Block } from 'payload';

/**
 * The approved page blocks (spec §16): content only. There is no free HTML, script, embed or payment block; prices
 * and availability always come from the booking engine, never from CMS text.
 */
export const HeroBlock: Block = {
  slug: 'hero',
  labels: { singular: { tr: 'Giriş (görsel + başlık)', en: 'Hero' }, plural: { tr: 'Girişler', en: 'Heroes' } },
  fields: [
    { name: 'heading', type: 'text', localized: true, required: true, maxLength: 120, label: { tr: 'Başlık', en: 'Heading' } },
    { name: 'subheading', type: 'textarea', localized: true, maxLength: 300, label: { tr: 'Alt başlık', en: 'Subheading' } },
    { name: 'image', type: 'upload', relationTo: 'media', label: { tr: 'Görsel', en: 'Image' } },
    { name: 'showHotelSearch', type: 'checkbox', defaultValue: true, label: { tr: 'Otel arama kutusunu göster', en: 'Show the hotel search box' } },
  ],
};

export const RichTextBlock: Block = {
  slug: 'richText',
  labels: { singular: { tr: 'Metin', en: 'Text' }, plural: { tr: 'Metinler', en: 'Texts' } },
  fields: [{ name: 'content', type: 'richText', localized: true, required: true, label: { tr: 'Metin', en: 'Text' } }],
};

export const ImageTextBlock: Block = {
  slug: 'imageText',
  labels: { singular: { tr: 'Görsel + metin', en: 'Image + text' }, plural: { tr: 'Görsel + metinler', en: 'Image + texts' } },
  fields: [
    { name: 'image', type: 'upload', relationTo: 'media', required: true, label: { tr: 'Görsel', en: 'Image' } },
    { name: 'heading', type: 'text', localized: true, maxLength: 120, label: { tr: 'Başlık', en: 'Heading' } },
    { name: 'text', type: 'textarea', localized: true, maxLength: 1200, label: { tr: 'Metin', en: 'Text' } },
    {
      name: 'imagePosition',
      type: 'select',
      defaultValue: 'left',
      options: [
        { value: 'left', label: { tr: 'Görsel solda', en: 'Image left' } },
        { value: 'right', label: { tr: 'Görsel sağda', en: 'Image right' } },
      ],
      label: { tr: 'Yerleşim', en: 'Layout' },
    },
  ],
};

export const FaqListBlock: Block = {
  slug: 'faqList',
  labels: { singular: { tr: 'SSS listesi', en: 'FAQ list' }, plural: { tr: 'SSS listeleri', en: 'FAQ lists' } },
  fields: [
    { name: 'heading', type: 'text', localized: true, maxLength: 120, label: { tr: 'Başlık', en: 'Heading' } },
    { name: 'faqs', type: 'relationship', relationTo: 'faqs', hasMany: true, required: true, label: { tr: 'Sorular', en: 'Questions' } },
  ],
};

export const DestinationGridBlock: Block = {
  slug: 'destinationGrid',
  labels: { singular: { tr: 'Destinasyon listesi', en: 'Destination grid' }, plural: { tr: 'Destinasyon listeleri', en: 'Destination grids' } },
  fields: [
    { name: 'heading', type: 'text', localized: true, maxLength: 120, label: { tr: 'Başlık', en: 'Heading' } },
    { name: 'destinations', type: 'relationship', relationTo: 'destinations', hasMany: true, required: true, label: { tr: 'Destinasyonlar', en: 'Destinations' } },
  ],
};

export const CampaignBannerBlock: Block = {
  slug: 'campaignBanner',
  labels: { singular: { tr: 'Kampanya bandı', en: 'Campaign banner' }, plural: { tr: 'Kampanya bantları', en: 'Campaign banners' } },
  fields: [{ name: 'campaign', type: 'relationship', relationTo: 'campaigns', required: true, label: { tr: 'Kampanya', en: 'Campaign' } }],
};

export const PAGE_BLOCKS: Block[] = [HeroBlock, RichTextBlock, ImageTextBlock, FaqListBlock, DestinationGridBlock, CampaignBannerBlock];
