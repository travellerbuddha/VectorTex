/**
 * Every cookie and browser storage entry the site can use, by consent category (ADR-0018). The cookie policy page is
 * rendered from this list, so it stays the same as the code: add an entry here when a new cookie or tag is added.
 * Third-party durations are the vendors' published defaults and can change on their side.
 */
export type CookieCategory = 'necessary' | 'analytics' | 'marketing';

export interface CookieEntry {
  name: string;
  provider: string;
  category: CookieCategory;
  purpose: { tr: string; en: string };
  duration: { tr: string; en: string };
  /** Storage other than a cookie (e.g. localStorage). */
  storage?: 'localStorage';
}

const d = (tr: string, en: string) => ({ tr, en });

export const COOKIES: readonly CookieEntry[] = [
  {
    name: 'th_consent',
    provider: 'TexHoliday',
    category: 'necessary',
    purpose: d('Çerez tercihinizi saklar; tercihinizi değiştirene kadar bant yeniden gösterilmez.', 'Keeps your cookie choice, so the banner is not shown again until you change it.'),
    duration: d('180 gün', '180 days'),
  },
  {
    name: 'th_order_…',
    provider: 'TexHoliday',
    category: 'necessary',
    purpose: d('Rezervasyon yaptığınız tarayıcıda sipariş ve ödeme sayfanızı açar; adreste gizli bilgi taşınmaz.', 'Opens your order and payment pages in the browser you booked with; no secret is carried in the address.'),
    duration: d('30 gün', '30 days'),
  },
  {
    name: 'th_customer',
    provider: 'TexHoliday',
    category: 'necessary',
    purpose: d('"Rezervasyonlarım" oturumunuz (e-posta koduyla giriş yaptığınızda).', 'Your "My bookings" session (after you sign in with an e-mailed code).'),
    duration: d('30 gün veya çıkış yapana kadar', '30 days or until you sign out'),
  },
  {
    name: 'th_customer_pending',
    provider: 'TexHoliday',
    category: 'necessary',
    purpose: d('Giriş sırasında kodun gönderildiği adresi hatırlar.', 'Remembers the address the code was sent to while you sign in.'),
    duration: d('15 dakika', '15 minutes'),
  },
  {
    name: '__stripe_mid, __stripe_sid',
    provider: 'Stripe (Nuitee ödeme formu)',
    category: 'necessary',
    purpose: d('Ödeme sayfasındaki kart formunun dolandırıcılık önlemesi; yalnız ödeme sayfasında.', 'Fraud prevention of the card form on the payment page; on the payment page only.'),
    duration: d('1 yıl / 30 dakika', '1 year / 30 minutes'),
  },
  {
    name: '_ga, _ga_…',
    provider: 'Google Analytics',
    category: 'analytics',
    purpose: d('Ziyaretleri ve rezervasyon adımlarını ölçer (kim olduğunuzu değil, tarayıcınızı ayırt eder).', 'Measures visits and booking steps (tells browsers apart, not who you are).'),
    duration: d('2 yıl', '2 years'),
  },
  {
    name: '_ym_uid, _ym_d, _ym_…',
    provider: 'Yandex Metrica',
    category: 'analytics',
    purpose: d('Ziyaret istatistikleri.', 'Visit statistics.'),
    duration: d('1 yıl', '1 year'),
  },
  {
    name: 'th_evt_…',
    provider: 'TexHoliday',
    category: 'analytics',
    purpose: d('Aynı satın alma veya ödeme adımının ölçümde iki kez sayılmasını önler.', 'Keeps the same purchase or payment step from being counted twice.'),
    duration: d('Siz silene kadar', 'Until you clear it'),
    storage: 'localStorage',
  },
  {
    name: '_gcl_au, _gcl_aw',
    provider: 'Google Ads',
    category: 'marketing',
    purpose: d('Reklam tıklamasından gelen rezervasyonları ölçer (dönüşüm).', 'Measures bookings that come from an ad click (conversions).'),
    duration: d('90 gün', '90 days'),
  },
  {
    name: '_fbp, _fbc',
    provider: 'Meta (Facebook, Instagram)',
    category: 'marketing',
    purpose: d('Meta reklamlarının ölçümü ve kişiselleştirilmesi.', 'Measuring and personalising Meta ads.'),
    duration: d('90 gün', '90 days'),
  },
];

/** Staff-only cookies of the management panel (/yonetim): never set for site visitors. */
export const STAFF_COOKIES = ['th_staff', 'th_admin_lang'] as const;

/** Address of the cookie policy page. */
export const COOKIE_POLICY_DIR = { tr: 'cerez-politikasi', en: 'cookie-policy' } as const;
export const COOKIE_POLICY_UPDATED = '2026-10-10';
