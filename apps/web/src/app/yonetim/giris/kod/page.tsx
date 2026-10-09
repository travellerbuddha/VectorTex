import { redirect } from 'next/navigation';
import { AuthShell } from '../../../../components/admin/AuthShell';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { continueSignIn, currentSession } from '../../../../server/admin';
import { verifyCodeAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function Code({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const locale = await adminLocale();
  const t = adminDict(locale);
  const s = await currentSession();
  if (s?.stage === 'ACTIVE') redirect('/yonetim');
  if (s?.stage !== 'MFA_REQUIRED') redirect(s ? continueSignIn(s.stage) : '/yonetim/giris?durum=sure');
  const { durum } = await searchParams;
  return (
    <AuthShell locale={locale} title={t.code.title} error={durum === 'hata' ? t.code.failed : null}>
      <p>{t.code.intro}</p>
      <form action={verifyCodeAction} className="stack">
        <div className="field">
          <label htmlFor="code">{t.code.label}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus className="code-input" />
        </div>
        <button type="submit" className="primary">
          {t.code.submit}
        </button>
      </form>
    </AuthShell>
  );
}
