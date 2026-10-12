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
import { SiteMotion } from '../../components/ui/SiteMotion';
import { ProductNav } from '../../components/ui/ProductNav';
import { LocaleCurrency } from '../../components/ui/LocaleCurrency';
import { UserRound } from 'lucide-react';
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
  // Menu and footer entered in the CMS (P06); the booking pages work the same without them.
  const chrome = await siteChrome(locale);
  const flightsOpen = await flightSalesOpen();
  const currencyNames = new Intl.DisplayNames([locale], { type: 'currency' });
  const currencies = (await saleCurrencies()).map((code) => ({ code, name: currencyNames.of(code) ?? code }));
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
              {/* eslint-disable-next-line @next/next/no-img-element -- the official wordmark (SVG), sized by CSS */}
              <img className="brand-wordmark" src="/brand/texholiday-wordmark.svg" alt={t.brand} width={134} height={26} />
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
              <LocaleCurrency
                locale={locale}
                label={t.nav.localeCurrency}
                languageLabel={t.nav.language}
                currencyLabel={t.search.currency}
                languages={[
                  { code: 'tr', name: 'Türkçe', href: '/tr' },
                  { code: 'en', name: 'English', href: '/en' },
                ]}
                currencies={currencies}
              />
            </div>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="footer-inner">
            <div className="footer-top">
              <a className="footer-brand" href={`/${locale}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the official wordmark (SVG) */}
                <img src="/brand/texholiday-wordmark.svg" alt={t.brand} width={144} height={28} />
              </a>
              <p className="footer-tagline">{t.footerTagline}</p>
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
            <div className="footer-mark" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- the wordmark again, as the closing graphic */}
              <img src="/brand/texholiday-wordmark.svg" alt="" width={1436} height={279} loading="lazy" data-reveal="stub" data-reveal-duration="900" />
            </div>
            <div className="footer-bottom">
              <p>{chrome.footer?.legal ?? t.footer}</p>
              <p className="footer-legal-links">
                <a href={`/${locale}/${COOKIE_POLICY_DIR[locale]}`}>{locale === 'tr' ? 'Çerez politikası' : 'Cookie policy'}</a>
                {tags && <ConsentReopen label={locale === 'tr' ? 'Çerez tercihleri' : 'Cookie preferences'} />}
              </p>
            </div>
          </div>
        </footer>
        <SiteMotion />
        {tags && <ConsentManager locale={locale} gtm={tags.gtm} ga4={tags.ga4} mode={tags.mode} bannerText={tags.bannerText} privacyUrl={`/${locale}/${COOKIE_POLICY_DIR[locale]}`} />}
      </body>
    </html>
  );
}

/** Flights appear in the menu once sales are open (approved FLIGHT rule, open route); never breaks other pages. */
async function saleCurrencies(): Promise<string[]> {
  try {
    return await (await booking()).app.availableCurrencies();
  } catch {
    return [];
  }
}

async function flightSalesOpen(): Promise<boolean> {
  try {
    return (await (await booking()).app.availableFlightCurrencies()).length > 0;
  } catch {
    return false;
  }
}
