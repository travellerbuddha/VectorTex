import { adminDict, type AdminLocale } from '../../i18n/admin';
import { LanguageSwitch } from './PanelNav';
import { BrandMark } from '../ui/Art';

/** Frame of the sign-in pages: brand, language switch, one card. */
export function AuthShell({ locale, title, notice, error, children }: { locale: AdminLocale; title: string; notice?: string | null; error?: string | null; children: React.ReactNode }) {
  const t = adminDict(locale);
  return (
    <div className="auth">
      <header className="auth-head">
        <span className="admin-brand">
          <BrandMark size={28} />
          {t.brand}
        </span>
        <LanguageSwitch next={locale === 'tr' ? 'en' : 'tr'} text={t.lang} />
      </header>
      <main id="admin-main" className="auth-card">
        <h1>{title}</h1>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
