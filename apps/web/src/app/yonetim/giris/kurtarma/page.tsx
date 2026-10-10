import { redirect } from 'next/navigation';
import { AuthShell } from '../../../../components/admin/AuthShell';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { continueSignIn, currentSession } from '../../../../server/admin';
import { verifyRecoveryAction } from '../../actions';

export const dynamic = 'force-dynamic';

/** Second step with a one-time recovery code instead of the authenticator (ADR-0010). */
export default async function RecoverySignIn({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const locale = await adminLocale();
  const t = adminDict(locale);
  const s = await currentSession();
  if (s?.stage === 'ACTIVE') redirect('/yonetim');
  if (s?.stage !== 'MFA_REQUIRED') redirect(s ? continueSignIn(s.stage) : '/yonetim/giris?durum=sure');
  const { durum } = await searchParams;
  return (
    <AuthShell locale={locale} title={t.recovery.title} error={durum === 'hata' ? t.recovery.failed : null}>
      <p>{t.recovery.intro}</p>
      <form action={verifyRecoveryAction} className="stack">
        <div className="field">
          <label htmlFor="code">{t.recovery.label}</label>
          <input id="code" name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20} required autoFocus className="code-input" />
        </div>
        <button type="submit" className="primary">
          {t.recovery.submit}
        </button>
      </form>
      <p className="top-gap">
        <a href="/yonetim/giris/kod">{t.recovery.back}</a>
      </p>
    </AuthShell>
  );
}
