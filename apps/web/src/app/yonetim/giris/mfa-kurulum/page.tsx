import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { AuthShell } from '../../../../components/admin/AuthShell';
import { adminDict, adminLocale } from '../../../../i18n/admin';
import { admin, continueSignIn, currentSession, staffToken } from '../../../../server/admin';
import { completeEnrollmentAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function EnrollMfa({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const locale = await adminLocale();
  const t = adminDict(locale);
  const s = await currentSession();
  if (s?.stage === 'ACTIVE') redirect('/yonetim');
  if (s?.stage !== 'MFA_ENROLL') redirect(s ? continueSignIn(s.stage) : '/yonetim/giris?durum=sure');
  const { secret, uri } = await admin().auth.beginEnrollment((await staffToken()) ?? '');
  // SVG generated on the server from our own data (no third-party QR service sees the secret).
  const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  const { durum } = await searchParams;
  return (
    <AuthShell locale={locale} title={t.enroll.title} error={durum === 'hata' ? t.enroll.failed : null}>
      <p>{t.enroll.intro}</p>
      <ol className="steps">
        <li>{t.enroll.step1}</li>
        <li>{t.enroll.step2}</li>
      </ol>
      <div className="qr" role="img" aria-label={t.enroll.qrAlt} dangerouslySetInnerHTML={{ __html: qr }} />
      <p className="muted">{t.enroll.manual}</p>
      <p>
        <code className="secret" data-testid="mfa-secret">
          {secret.match(/.{1,4}/g)!.join(' ')}
        </code>
      </p>
      <ol className="steps" start={3}>
        <li>{t.enroll.step3}</li>
      </ol>
      <form action={completeEnrollmentAction} className="stack">
        <div className="field">
          <label htmlFor="code">{t.code.label}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="code-input" />
        </div>
        <button type="submit" className="primary">
          {t.enroll.submit}
        </button>
      </form>
    </AuthShell>
  );
}
