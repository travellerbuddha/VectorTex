import type { Metadata } from 'next';
import type { Locale } from '../../i18n/dictionaries';
import { formatDate } from '../../i18n/format';
import { trackingSettings } from '../../server/tracking';
import { ConsentReopen } from './ConsentManager';
import { COOKIE_POLICY_DIR, COOKIE_POLICY_UPDATED, COOKIES, STAFF_COOKIES, type CookieCategory } from './cookie-registry';

/**
 * Cookie policy (ADR-0018, KVKK cookie guidance): what the site stores, why, for how long and with whose consent,
 * rendered from the cookie registry so it matches the code. Analytics and marketing cookies are used only after the
 * visitor's consent, and only when the business has entered a tag id.
 */
const TEXT = {
  tr: {
    title: 'Çerez politikası',
    description: 'TexHoliday sitesinde kullanılan çerezler, amaçları, süreleri ve tercihlerinizi nasıl değiştireceğiniz.',
    intro: [
      'Çerezler, ziyaret ettiğiniz sitenin tarayıcınıza kaydettiği küçük dosyalardır. TexHoliday sitesi yalnız aşağıdaki çerezleri ve tarayıcı kayıtlarını kullanır.',
      'Zorunlu çerezler sitenin çalışması için gereklidir ve izin gerektirmez. Analiz ve pazarlama çerezleri yalnız siz izin verirseniz kullanılır. İzin vermemeniz rezervasyon yapmanızı etkilemez.',
    ],
    categories: {
      necessary: { title: 'Zorunlu çerezler', text: 'Rezervasyon, ödeme ve oturum gibi istediğiniz hizmetleri sunmak için gereklidir; kapatılamaz.' },
      analytics: { title: 'Analiz çerezleri (izninizle)', text: 'Sitenin nasıl kullanıldığını ölçerek hizmeti geliştirmemize yardım eder.' },
      marketing: { title: 'Pazarlama çerezleri (izninizle)', text: 'Reklamlarımızın sonuçlarını ölçer ve size uygun reklam gösterilmesine yardım eder.' },
    } as Record<CookieCategory, { title: string; text: string }>,
    cols: { name: 'Ad', provider: 'Sağlayıcı', purpose: 'Amaç', duration: 'Süre' },
    local: 'tarayıcı kaydı (localStorage)',
    transfer:
      'Analiz ve pazarlama çerezleriyle toplanan veriler, izin verdiğinizde Google, Meta ve Yandex’e (yurt dışındaki sunuculara) aktarılabilir. İzin vermezseniz bu çerezler kurulmaz ve bu aktarım yapılmaz.',
    change: 'Tercihinizi istediğiniz zaman değiştirebilirsiniz:',
    reopen: 'Çerez tercihlerini aç',
    noTags: 'Şu anda sitede analiz veya pazarlama etiketi etkin değil; yalnız zorunlu çerezler kullanılır.',
    browser: 'Çerezleri tarayıcınızın ayarlarından da silebilir veya engelleyebilirsiniz; zorunlu çerezleri engellerseniz rezervasyon ve ödeme çalışmayabilir.',
    staff: (names: string) => `Yönetim paneli personel için ayrı çerezler kullanır (${names}); site ziyaretçilerinde kullanılmaz.`,
    privacy: 'Kişisel verilerinizin işlenmesi hakkında ayrıntılı bilgi:',
    privacyLink: 'Gizlilik ve KVKK aydınlatma metni',
    updated: 'Son güncelleme',
  },
  en: {
    title: 'Cookie policy',
    description: 'The cookies used on the TexHoliday site, their purposes and durations, and how to change your choice.',
    intro: [
      'Cookies are small files a website stores in your browser. The TexHoliday site uses only the cookies and browser storage listed below.',
      'Necessary cookies are required for the site to work and need no consent. Analytics and marketing cookies are used only if you allow them. Not allowing them does not affect booking.',
    ],
    categories: {
      necessary: { title: 'Necessary cookies', text: 'Needed for the services you ask for, such as booking, payment and sign-in; they cannot be switched off.' },
      analytics: { title: 'Analytics cookies (with your consent)', text: 'Help us improve the service by measuring how the site is used.' },
      marketing: { title: 'Marketing cookies (with your consent)', text: 'Measure the results of our ads and help show you relevant ads.' },
    } as Record<CookieCategory, { title: string; text: string }>,
    cols: { name: 'Name', provider: 'Provider', purpose: 'Purpose', duration: 'Duration' },
    local: 'browser storage (localStorage)',
    transfer:
      'With your consent, data collected by analytics and marketing cookies can be transferred to Google, Meta and Yandex (servers abroad). Without your consent these cookies are not set and no such transfer happens.',
    change: 'You can change your choice at any time:',
    reopen: 'Open cookie preferences',
    noTags: 'No analytics or marketing tag is active on the site at the moment; only necessary cookies are used.',
    browser: 'You can also delete or block cookies in your browser settings; if you block necessary cookies, booking and payment may not work.',
    staff: (names: string) => `The management panel uses separate cookies for staff (${names}); they are never set for site visitors.`,
    privacy: 'More about how your personal data is processed:',
    privacyLink: 'Privacy notice',
    updated: 'Last updated',
  },
} as const;

export function cookiePolicyMetadata(locale: Locale): Metadata {
  const t = TEXT[locale];
  return {
    title: t.title,
    description: t.description,
    alternates: { canonical: `/${locale}/${COOKIE_POLICY_DIR[locale]}`, languages: { tr: `/tr/${COOKIE_POLICY_DIR.tr}`, en: `/en/${COOKIE_POLICY_DIR.en}` } },
  };
}

export async function CookiePolicyPage({ locale }: { locale: Locale }) {
  const t = TEXT[locale];
  const tracking = await trackingSettings(locale);
  const tagsOn = Boolean(tracking && (tracking.gtm || tracking.ga4));
  const categories: CookieCategory[] = ['necessary', 'analytics', 'marketing'];
  return (
    <div className="page legal cookie-policy">
      <h1>{t.title}</h1>
      {t.intro.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {categories.map((cat) => (
        <section key={cat} aria-labelledby={`cookies-${cat}`}>
          <h2 id={`cookies-${cat}`}>{t.categories[cat].title}</h2>
          <p className="muted">{t.categories[cat].text}</p>
          <div className="table-wrap">
            <table data-testid={`cookies-${cat}`}>
              <thead>
                <tr>
                  <th>{t.cols.name}</th>
                  <th>{t.cols.provider}</th>
                  <th>{t.cols.purpose}</th>
                  <th>{t.cols.duration}</th>
                </tr>
              </thead>
              <tbody>
                {COOKIES.filter((c) => c.category === cat).map((c) => (
                  <tr key={c.name}>
                    <td>
                      <code>{c.name}</code>
                      {c.storage && <small className="muted"> ({t.local})</small>}
                    </td>
                    <td>{c.provider}</td>
                    <td>{c.purpose[locale]}</td>
                    <td>{c.duration[locale]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p>{t.transfer}</p>
      {tagsOn ? (
        <p>
          {t.change} <ConsentReopen label={t.reopen} />
        </p>
      ) : (
        <p className="muted">{t.noTags}</p>
      )}
      <p>{t.browser}</p>
      <p className="muted">{t.staff(STAFF_COOKIES.join(', '))}</p>
      {tracking?.privacyUrl && (
        <p>
          {t.privacy} <a href={tracking.privacyUrl}>{t.privacyLink}</a>
        </p>
      )}
      <p className="muted">
        {t.updated}: {formatDate(COOKIE_POLICY_UPDATED, locale)}
      </p>
    </div>
  );
}
