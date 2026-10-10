import type { Metadata, Viewport } from 'next';
import { adminLocale } from '../../i18n/admin';
import './admin.css';

export const metadata: Metadata = { title: 'TexHoliday Yönetim', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/** Root layout of the staff panel; the customer site has its own (app/[locale]). */
export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const locale = await adminLocale();
  return (
    <html lang={locale}>
      <body className="admin">
        <a className="skip" href="#admin-main">
          {locale === 'tr' ? 'İçeriğe geç' : 'Skip to content'}
        </a>
        {children}
      </body>
    </html>
  );
}
