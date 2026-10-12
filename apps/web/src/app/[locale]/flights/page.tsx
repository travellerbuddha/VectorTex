import { notFound } from 'next/navigation';
import { FlightSearchForm } from '../../../components/FlightSearchForm';
import { CoastScene } from '../../../components/ui/Art';
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
    <div className="home">
      <section className="hero hero-compact" aria-labelledby="flights-title">
        <div className="hero-text">
          <h1 id="flights-title" className="hero-title">
            {dict(locale).flight.title}
          </h1>
        </div>
        <div className="hero-search">
          <FlightSearchForm locale={locale} currencies={currencies} today={new Date().toISOString().slice(0, 10)} />
        </div>
        <div className="hero-visual" aria-hidden="true">
          <CoastScene className="hero-art" />
        </div>
      </section>
    </div>
  );
}
