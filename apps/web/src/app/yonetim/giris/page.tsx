import { redirect } from 'next/navigation';
import { AuthShell } from '../../../components/admin/AuthShell';
import { adminDict, adminLocale } from '../../../i18n/admin';
import { currentSession } from '../../../server/admin';
import { signInAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function SignIn({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const locale = await adminLocale();
  const t = adminDict(locale);
  const { durum } = await searchParams;
  if ((await currentSession())?.stage === 'ACTIVE') redirect('/yonetim');
  const error = durum === 'hata' ? t.signIn.failed : durum === 'sinir' ? t.signIn.rate : null;
  const notice = durum === 'cikis' ? t.signIn.signedOut : durum === 'sure' ? t.signIn.expired : null;
  return (
    <AuthShell locale={locale} title={t.signIn.title} notice={notice} error={error}>
      <form action={signInAction} className="stack">
        <div className="field">
          <label htmlFor="email">{t.signIn.email}</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">{t.signIn.password}</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button type="submit" className="primary">
          {t.signIn.submit}
        </button>
      </form>
    </AuthShell>
  );
}
