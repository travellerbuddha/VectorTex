import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { safeHref } from '../../components/cms/RichText';
import { dict, isLocale, LOCALES } from '../../i18n/dictionaries';
import { booking } from '../../server/booking';
import { siteChrome } from '../../server/cms-content';
import { ACCOUNT_DIR } from '../../server/seo';
import { CONSENT_BOOTSTRAP, trackingSettings } from '../../server/tracking';
import { ConsentManager, ConsentReopen } from '../../components/tracking/ConsentManager';
import './globals.css';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const tracking = isLocale(locale) ? await trackingSettings(locale) : null;
  return {
    title: 'TexHoliday',
    description: 'Otel, uçak, tur ve transfer rezervasyonu',
    // Search Console ownership (HTML tag method), entered in the CMS (ADR-0018).
    ...(tracking?.verification ? { verification: { google: tracking.verification } } : {}),
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
          <a className="brand" href={`/${locale}`}>
            {t.brand}
          </a>
          <nav aria-label={locale === 'tr' ? 'Ürünler' : 'Products'}>
            <a href={`/${locale}`}>{t.nav.hotels}</a>
            {flightsOpen && <a href={`/${locale}/flights`}>{t.nav.flights}</a>}
            {[...(flightsOpen ? [] : [t.nav.flights]), t.nav.tours, t.nav.transfers, t.nav.packages].map((label) => (
              <span key={label} className="nav-soon" aria-disabled="true" title={t.nav.soon}>
                {label}
              </span>
            ))}
            {chrome.nav.map((n) => (
              <a key={`${n.href}-${n.label}`} href={safeHref(n.href)}>
                {n.label}
              </a>
            ))}
          </nav>
          <a className="account-link" href={`/${locale}/${ACCOUNT_DIR[locale]}`}>
            {t.account.nav}
          </a>
          <a className="lang" href={`/${other}`} hrefLang={other} lang={other}>
            {other.toUpperCase()}
          </a>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
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
          <p>{chrome.footer?.legal ?? t.footer}</p>
          {tags && <ConsentReopen label={locale === 'tr' ? 'Çerez tercihleri' : 'Cookie preferences'} />}
        </footer>
        {tags && <ConsentManager locale={locale} gtm={tags.gtm} ga4={tags.ga4} mode={tags.mode} bannerText={tags.bannerText} privacyUrl={tags.privacyUrl} />}
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
