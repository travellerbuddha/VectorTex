import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { safeHref } from '../../components/cms/RichText';
import { dict, isLocale, LOCALES } from '../../i18n/dictionaries';
import { siteChrome } from '../../server/cms-content';
import './globals.css';

export const metadata: Metadata = { title: 'TexHoliday', description: 'Otel, uçak, tur ve transfer rezervasyonu' };
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
  return (
    <html lang={locale}>
      <body>
        <a className="skip" href="#main">
          {locale === 'tr' ? 'İçeriğe geç' : 'Skip to content'}
        </a>
        <header className="site-header">
          <a className="brand" href={`/${locale}`}>
            {t.brand}
          </a>
          <nav aria-label={locale === 'tr' ? 'Ürünler' : 'Products'}>
            <a href={`/${locale}`} aria-current="page">
              {t.nav.hotels}
            </a>
            {[t.nav.flights, t.nav.tours, t.nav.transfers, t.nav.packages].map((label) => (
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
        </footer>
      </body>
    </html>
  );
}
