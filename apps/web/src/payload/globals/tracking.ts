import type { Field, GlobalConfig } from 'payload';
import { canPublish } from '../access';

/**
 * Tracking and cookie consent (ADR-0018). Nothing loads without an id here. Consent Mode v2: every Google purpose is
 * "denied" until the visitor chooses; BASIC loads the tags only after a choice that allows them, ADVANCED loads them at
 * once in the denied state (cookieless pings). Changes go live at once: publishing permission is needed.
 */
const pattern = (re: RegExp, message: string) => (v: unknown) => (v === null || v === undefined || v === '' || (typeof v === 'string' && re.test(v)) ? true : message);

const fields: Field[] = [
  {
    name: 'gtmContainerId',
    type: 'text',
    maxLength: 20,
    label: { tr: 'Google Tag Manager kapsayıcı kimliği', en: 'Google Tag Manager container id' },
    admin: {
      description: {
        tr: 'GTM-XXXXXXX. Önerilen yol: GA4, Google Ads, Meta ve Yandex etiketlerini GTM içinden yönetin. Boşsa GTM yüklenmez.',
        en: 'GTM-XXXXXXX. Recommended: manage GA4, Google Ads, Meta and Yandex tags inside GTM. Empty = no GTM.',
      },
    },
    validate: pattern(/^GTM-[A-Z0-9]{4,12}$/, 'GTM-XXXXXXX biçiminde girin.'),
  },
  {
    name: 'ga4MeasurementId',
    type: 'text',
    maxLength: 20,
    label: { tr: 'GA4 ölçüm kimliği (yalnız GTM kullanılmıyorsa)', en: 'GA4 measurement id (only without GTM)' },
    admin: { description: { tr: 'G-XXXXXXXXXX. GTM girildiyse bu alan kullanılmaz (GA4 GTM içinden yüklenir).', en: 'G-XXXXXXXXXX. Ignored when GTM is set.' } },
    validate: pattern(/^G-[A-Z0-9]{4,15}$/, 'G-XXXXXXXXXX biçiminde girin.'),
  },
  {
    name: 'consentMode',
    type: 'select',
    required: true,
    defaultValue: 'BASIC',
    label: { tr: 'İzin modu', en: 'Consent mode' },
    options: [
      { value: 'BASIC', label: { tr: 'Temel: etiketler yalnız izin verilince yüklenir (en temkinli)', en: 'Basic: tags load only after consent (most cautious)' } },
      { value: 'ADVANCED', label: { tr: 'Gelişmiş: etiketler "reddedildi" durumunda yüklenir, çerezsiz ölçüm (Google modelleme)', en: 'Advanced: tags load denied, cookieless pings (Google modelling)' } },
    ],
    admin: { description: { tr: 'Hangi modun kullanılacağına hukuk/KVKK danışmanınızla karar verin.', en: 'Decide with your legal/privacy adviser.' } },
  },
  {
    name: 'searchConsoleVerification',
    type: 'text',
    maxLength: 100,
    label: { tr: 'Search Console doğrulama kodu', en: 'Search Console verification code' },
    admin: { description: { tr: 'Search Console → HTML etiketi yöntemindeki content="…" değeri (yalnız kod).', en: 'The content="…" value of the HTML tag method (code only).' } },
    validate: pattern(/^[A-Za-z0-9_-]{10,100}$/, 'Yalnız etiketteki content değerini girin.'),
  },
  {
    name: 'bannerText',
    type: 'textarea',
    localized: true,
    maxLength: 600,
    label: { tr: 'Çerez bandı metni', en: 'Cookie banner text' },
    admin: { description: { tr: 'Boşsa varsayılan metin gösterilir. Metni hukuk/KVKK danışmanınıza onaylatın.', en: 'Empty = default text. Have it approved by your privacy adviser.' } },
  },
  {
    name: 'privacyUrl',
    type: 'text',
    localized: true,
    maxLength: 300,
    label: { tr: 'Çerez/gizlilik politikası adresi', en: 'Cookie/privacy policy address' },
    validate: pattern(/^\/[a-z0-9/_-]*$|^https:\/\/[^\s"'<>]+$/i, 'Site içi adres (/tr/...) veya https:// bağlantısı girin.'),
  },
];

export const TrackingSettings: GlobalConfig = {
  slug: 'tracking-settings',
  label: { tr: 'Ölçüm ve çerez ayarları', en: 'Tracking and cookies' },
  access: { read: () => true, update: ({ req }) => canPublish(req) },
  fields,
};
