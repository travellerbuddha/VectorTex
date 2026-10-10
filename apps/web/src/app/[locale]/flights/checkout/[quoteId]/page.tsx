import { isDomainError } from '@texholiday/contracts';
import { Clock } from 'lucide-react';
import { notFound } from 'next/navigation';
import { FlightCheckoutForm } from '../../../../../components/FlightCheckoutForm';
import { FlightQuoteSummary } from '../../../../../components/FlightQuoteSummary';
import { BookingSteps } from '../../../../../components/ui/HotelBits';
import { countryOptions } from '../../../../../i18n/countries';
import { dict, type Locale } from '../../../../../i18n/dictionaries';
import { formatInstant } from '../../../../../i18n/format';
import { booking } from '../../../../../server/booking';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function FlightCheckout({ params }: { params: Promise<{ locale: string; quoteId: string }> }) {
  const { locale: l, quoteId } = await params;
  const locale = l as Locale;
  const t = dict(locale);
  const { app } = await booking();
  if (!app.flights) notFound();
  let quote;
  try {
    quote = await app.flights.quote(quoteId);
  } catch (err) {
    if (isDomainError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  const expired = new Date(quote.expiresAt).getTime() <= Date.now();
  return (
    <div className="page checkout">
      <BookingSteps current="details" locale={locale} product="FLIGHT" />
      <h1>{t.flight.checkoutTitle}</h1>
      <div className="two-col">
        <FlightQuoteSummary quote={quote} locale={locale} />
        <div>
          {expired ? (
            <p className="notice" role="status">
              {t.checkout.quoteExpired} <a href={`/${locale}/flights`}>{t.results.searchAgain}</a>
            </p>
          ) : (
            <>
              <p className="hold-note">
                <Clock />
                {t.checkout.expiresAt(formatInstant(quote.expiresAt, locale))}
              </p>
              <FlightCheckoutForm
                locale={locale}
                quoteVersionId={quote.quoteVersionId}
                termsVersion={quote.termsVersion}
                passengers={{ adults: quote.passengers.adults, children: quote.passengers.childAges.length, infants: quote.passengers.infantAges.length }}
                countries={countryOptions(locale)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
