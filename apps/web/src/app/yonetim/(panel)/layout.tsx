import { visibleNav } from '../../../components/admin/AdminNav';
import { LanguageSwitch, PanelNav } from '../../../components/admin/PanelNav';
import { adminDict, adminLocale } from '../../../i18n/admin';
import { requireStaff } from '../../../server/admin';
import { signOutAction } from '../actions';

export const dynamic = 'force-dynamic';

/** Signed-in area: everything below needs a session that passed MFA. Menus follow the person's permissions. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const locale = await adminLocale();
  const t = adminDict(locale);
  return (
    <div className="panel">
      <header className="panel-head">
        <a className="admin-brand" href="/yonetim">
          {t.brand}
        </a>
        <a className="who" data-testid="staff-name" href="/yonetim/hesap" title={t.nav.account}>
          {staff.displayName}
        </a>
        <LanguageSwitch next={locale === 'tr' ? 'en' : 'tr'} text={t.lang} />
        <form action={signOutAction}>
          <button type="submit" className="secondary small">
            {t.nav.signOut}
          </button>
        </form>
      </header>
      <PanelNav label={t.nav.label} items={visibleNav(staff).map((n) => ({ key: n.key, href: n.href, text: t.nav[n.key] }))} />
      <main id="admin-main" className="panel-main">
        {children}
      </main>
    </div>
  );
}
