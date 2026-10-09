import type { Locale } from '../../../i18n/dictionaries';
import { booking } from '../../../server/booking';

export const dynamic = 'force-dynamic';

/**
 * Sales terms are legal content (G06/G07) and will be managed in the CMS (P06). Until the approved text is published
 * this page says so instead of inventing terms.
 */
export default async function Terms({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const { settings } = await booking();
  return (
    <div className="page">
      <h1>{locale === 'tr' ? 'Satış koşulları' : 'Sales terms'}</h1>
      <p className="muted">
        {locale === 'tr' ? 'Sürüm' : 'Version'}: {settings.termsVersion}
      </p>
      <p className="notice">
        {locale === 'tr'
          ? 'Onaylı satış koşulları metni hukuk onayından sonra burada yayımlanacaktır. Otel rezervasyonlarında ödeme Nuitee tarafından tahsil edilir; iptal koşulları her teklifte ayrıca gösterilir.'
          : 'The approved sales terms will be published here after legal approval. For hotel bookings Nuitee collects the payment; cancellation terms are shown with every offer.'}
      </p>
    </div>
  );
}
