import { isDomainError } from '@texholiday/contracts';
import { notFound } from 'next/navigation';
import { FlightBaggage, FlightJourney, FlightTerms } from '../../../../components/FlightJourney';
import { FlightSearchForm, type Airport } from '../../../../components/FlightSearchForm';
import { OfferButton } from '../../../../components/OfferButton';
import { dict, type Locale } from '../../../../i18n/dictionaries';
import { formatDate, formatMoney } from '../../../../i18n/format';
import { booking } from '../../../../server/booking';

export const dynamic = 'force-dynamic';

/** Airport labels for re-filling the form come from the URL; only well-formed values are used (display only). */
function airportParam(raw: string | undefined, iata: string): Airport | undefined {
  try {
    const a = JSON.parse(raw ?? '') as Partial<Airport>;
    if (a.iata === iata && typeof a.name === 'string' && a.name.length <= 120) return { iata, name: a.name, city: typeof a.city === 'string' ? a.city.slice(0, 80) : null, country: typeof a.country === 'string' ? a.country.slice(0, 80) : null };
  } catch {
    // ignored: the form starts empty
  }
  return undefined;
}

export default async function FlightResults({ params, searchParams }: { params: Promise<{ locale: string; sessionId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { locale: l, sessionId } = await params;
  const sp = await searchParams;
  const locale = l as Locale;
  const t = dict(locale);
  const f = t.flight;
  const { app } = await booking();
  if (!app.flights) notFound();
  const criteria = await app.flights.searchCriteria(sessionId);
  if (!criteria) notFound();
  const currencies = await app.availableFlightCurrencies();
  const form = (
    <FlightSearchForm
      locale={locale}
      currencies={currencies}
      today={new Date().toISOString().slice(0, 10)}
      initial={{ ...criteria, origin: airportParam(sp.o, criteria.origin), destination: airportParam(sp.d, criteria.destination) }}
    />
  );

  let view;
  try {
    view = await app.flights.searchSession(sessionId);
  } catch (err) {
    if (isDomainError(err) && err.code === 'QUOTE_EXPIRED') {
      return (
        <div className="page">
          <p className="notice" role="status">
            {t.results.expired}
          </p>
          {form}
        </div>
      );
    }
    throw err;
  }
  const c = view.criteria;
  return (
    <div className="page results">
      <details className="refine">
        <summary>
          {c.origin} → {c.destination} · {formatDate(c.departDate, locale)}
          {c.returnDate ? ` – ${formatDate(c.returnDate, locale)}` : ''} · {f.pax(c.adults, c.childAges.length, c.infantAges.length)}
        </summary>
        {form}
      </details>
      <h1>{f.results}</h1>
      {view.offers.length === 0 && <p className="notice">{f.none}</p>}
      <ul className="flights">
        {view.offers.map((o) => (
          <li key={o.key} className="card flight-offer">
            <div className="flight-body">
              {o.journeys.map((j) => (
                <FlightJourney key={j.direction} j={j} locale={locale} />
              ))}
              <FlightTerms terms={o.terms} locale={locale} />
              <FlightBaggage baggage={o.baggage} locale={locale} />
            </div>
            <div className="price">
              <strong>{formatMoney(o.total, locale)}</strong>
              <span className="muted">{f.total}</span>
              {o.perPassenger.ADULT && (
                <span className="muted">
                  {formatMoney(o.perPassenger.ADULT, locale)} {f.perAdult}
                </span>
              )}
              {o.seatsRemaining !== null && o.seatsRemaining <= 5 && <span className="tag warn">{f.seatsLeft(o.seatsRemaining)}</span>}
              <OfferButton
                locale={locale}
                sessionId={view.sessionId}
                offerKey={o.key}
                product="FLIGHT"
                label={`${t.results.choose}: ${o.journeys.map((j) => `${j.departure.code} ${j.departure.local.slice(11, 16)}`).join(' / ')} – ${formatMoney(o.total, locale)}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function generateMetadata() {
  return { robots: { index: false } };
}
