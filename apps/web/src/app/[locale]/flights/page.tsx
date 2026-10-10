import { notFound } from 'next/navigation';
import { FlightSearchForm } from '../../../components/FlightSearchForm';
import { dict, isLocale } from '../../../i18n/dictionaries';
import { booking } from '../../../server/booking';

export const dynamic = 'force-dynamic';

export default async function Flights({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { app } = await booking();
  // Open only with an approved FLIGHT pricing rule and a route the capability matrix allows (ADR-0012).
  const currencies = await app.availableFlightCurrencies();
  return (
    <div className="page">
      <h1>{dict(locale).flight.title}</h1>
      <FlightSearchForm locale={locale} currencies={currencies} today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
