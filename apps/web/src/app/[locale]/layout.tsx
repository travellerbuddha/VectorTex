import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { safeHref } from '../../components/cms/RichText';
import { dict, isLocale, LOCALES } from '../../i18n/dictionaries';
import { booking } from '../../server/booking';
import { siteChrome } from '../../server/cms-content';
import { ACCOUNT_DIR } from '../../server/seo';
import { CONSENT_BOOTSTRAP, trackingSettings } from '../../server/tracking';
import { ConsentManager, ConsentReopen } from '../../components/tracking/ConsentManager';
import { COOKIE_POLICY_DIR } from '../../components/tracking/cookie-registry';
import { BrandMark } from '../../components/ui/Art';
import { ProductNav } from '../../components/ui/ProductNav';
import { Globe, UserRound } from 'lucide-react';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import './globals.css';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const tracking = isLocale(locale) ? await trackingSettings(locale) : null;
  return {
    title: 'TexHoliday',
    description: 'Otel, uçak, tur ve transfer rezervasyonu',
    // Search Console ownership (HTML tag method), entered in the CMS (ADR-0018).
    // Site ownership tags (Search Console, Yandex Webmaster, Meta domain verification), from the panel.
    ...(tracking && (tracking.verification || tracking.yandexVerification || tracking.metaDomainVerification)
      ? {
          verification: {
            ...(tracking.verification ? { google: tracking.verification } : {}),
            ...(tracking.yandexVerification ? { yandex: tracking.yandexVerification } : {}),
            ...(tracking.metaDomainVerification ? { other: { 'facebook-domain-verification': tracking.metaDomainVerification } } : {}),
          },
        }
      : {}),
  };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = dict(locale);
  const other = locale === 'tr' ? 'en' : 'tr';
  // Menu and footer entered in the CMS (P06); the booking pages work the same without them.
  const chrome = await siteChrome(locale);
  const flightsOpen = await flightSalesOpen();
  const tracking = await trackingSettings(locale);
  const tags = tracking && (tracking.gtm || tracking.ga4) ? tracking : null;
  return (
    <html lang={locale}>
      <body>
        {/* Consent Mode v2 defaults before any tag (ADR-0018). */}
        {tags && <script dangerouslySetInnerHTML={{ __html: CONSENT_BOOTSTRAP }} />}
        <a className="skip" href="#main">
          {locale === 'tr' ? 'İçeriğe geç' : 'Skip to content'}
        </a>
        <header className="site-header">
          <div className="header-bar">
            <a className="brand" href={`/${locale}`}>
              <BrandMark />
              <span className="brand-word">{t.brand}</span>
            </a>
            <ProductNav
              label={locale === 'tr' ? 'Ürünler' : 'Products'}
              locale={locale}
              soon={t.nav.soon}
              items={[
                { key: 'hotels', text: t.nav.hotels, href: `/${locale}` },
                { key: 'flights', text: t.nav.flights, href: flightsOpen ? `/${locale}/flights` : null },
                { key: 'tours', text: t.nav.tours, href: null },
                { key: 'transfers', text: t.nav.transfers, href: null },
                { key: 'packages', text: t.nav.packages, href: null },
              ]}
              extra={chrome.nav.map((n) => ({ href: safeHref(n.href), text: n.label }))}
            />
            <div className="header-actions">
              <a className="account-link" href={`/${locale}/${ACCOUNT_DIR[locale]}`}>
                <UserRound />
                <span className="account-label">{t.account.nav}</span>
              </a>
              <a className="lang" href={`/${other}`} hrefLang={other} lang={other}>
                <Globe />
                {other.toUpperCase()}
              </a>
            </div>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <svg className="footer-wave" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d="M0 40V22c120-14 240-14 360 0s240 14 360 0 240-14 360 0 240 14 360 0V40Z" />
          </svg>
          <div className="footer-inner">
            <div className="footer-brand">
              <a className="brand" href={`/${locale}`}>
                <BrandMark />
                <span className="brand-word">{t.brand}</span>
              </a>
              <p>{t.footerTagline}</p>
            </div>
            {chrome.footer && chrome.footer.columns.length > 0 && (
              <div className="footer-columns">
                {chrome.footer.columns.map((c, i) => (
                  <nav key={i} aria-label={c.heading ?? undefined}>
                    {c.heading && <strong>{c.heading}</strong>}
                    <ul>
                      {c.links.map((l) => (
                        <li key={`${l.href}-${l.label}`}>
                          <a href={safeHref(l.href)}>{l.label}</a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                ))}
              </div>
            )}
          </div>
          <div className="footer-bottom">
            <p>{chrome.footer?.legal ?? t.footer}</p>
            <p className="footer-legal-links">
              <a href={`/${locale}/${COOKIE_POLICY_DIR[locale]}`}>{locale === 'tr' ? 'Çerez politikası' : 'Cookie policy'}</a>
              {tags && <ConsentReopen label={locale === 'tr' ? 'Çerez tercihleri' : 'Cookie preferences'} />}
            </p>
          </div>
        </footer>
        {tags && <ConsentManager locale={locale} gtm={tags.gtm} ga4={tags.ga4} mode={tags.mode} bannerText={tags.bannerText} privacyUrl={`/${locale}/${COOKIE_POLICY_DIR[locale]}`} />}
      </body>
    </html>
  );
}

/** Flights appear in the menu once sales are open (approved FLIGHT rule, open route); never breaks other pages. */
async function flightSalesOpen(): Promise<boolean> {
  try {
    return (await (await booking()).app.availableFlightCurrencies()).length > 0;
  } catch {
    return false;
  }
}
