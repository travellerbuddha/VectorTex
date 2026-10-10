import { isDomainError } from '@texholiday/contracts';
import { notFound } from 'next/navigation';
import { OfferButton } from '../../../../../components/OfferButton';
import { CancellationLine } from '../../../../../components/QuoteSummary';
import { SearchForm } from '../../../../../components/SearchForm';
import { countryOptions } from '../../../../../i18n/countries';
import { dict, type Locale } from '../../../../../i18n/dictionaries';
import { boardLabel, formatDate, formatMoney } from '../../../../../i18n/format';
import { booking } from '../../../../../server/booking';

export const dynamic = 'force-dynamic';

export default async function Results({ params, searchParams }: { params: Promise<{ locale: string; sessionId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { locale: l, sessionId } = await params;
  const sp = await searchParams;
  const locale = l as Locale;
  const t = dict(locale);
  const { app } = await booking();
  const criteria = await app.searchCriteria(sessionId);
  if (!criteria) notFound();
  const currencies = await app.availableCurrencies();
  const hotelTarget = 'hotelIds' in criteria.target ? criteria.target.hotelIds[0] : undefined;
  const place =
    hotelTarget && sp.hotel === hotelTarget
      ? { placeId: `hotel:${hotelTarget}`, hotelId: hotelTarget, name: sp.hotelName ?? hotelTarget, address: '' }
      : sp.place && sp.placeName
        ? { placeId: sp.place, name: sp.placeName, address: '' }
        : undefined;
  const form = (
    <SearchForm
      locale={locale}
      currencies={currencies}
      countries={countryOptions(locale)}
      today={new Date().toISOString().slice(0, 10)}
      initial={{ place, checkin: criteria.checkin, checkout: criteria.checkout, rooms: criteria.rooms, nationality: criteria.nationality, currency: criteria.currency, boardType: criteria.boardType ?? null }}
    />
  );

  let view;
  try {
    view = await app.searchSession(sessionId);
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

  return (
    <div className="page results">
      <details className="refine">
        <summary>
          {formatDate(criteria.checkin, locale)} → {formatDate(criteria.checkout, locale)} · {t.results.nights(view.nights)}
        </summary>
        {form}
      </details>
      <h1>{t.results.title}</h1>
      {view.hotels.length === 0 && <p className="notice">{t.results.none}</p>}
      <ul className="hotels">
        {view.hotels.map((h) => (
          <li key={h.hotelId} className="card hotel">
            {/* Provider images are https-only; no next/image so hosts need no allow-list. */}
            {h.photo && <img src={h.photo} alt="" loading="lazy" className="hotel-photo" />}
            <div className="hotel-body">
              <h2>{h.name}</h2>
              {h.address && <p className="muted">{h.address}</p>}
              {h.rating !== null && (
                <p className="muted">
                  {t.results.rating}: {h.rating}
                </p>
              )}
              <p className="from">
                {t.results.from} <strong>{formatMoney(h.from, locale)}</strong> <span className="muted">({t.results.total.toLowerCase()})</span>
              </p>
              <h3 className="visually-hidden">{t.results.rooms}</h3>
              <ul className="offers">
                {h.offers.map((o) => {
                  const board = boardLabel(o.boardType, o.boardName, locale);
                  return (
                    <li key={o.key} className="offer">
                      <div>
                        <p className="room-name">{o.roomName}</p>
                        {board && <p className="muted">{board}</p>}
                        <CancellationLine c={o.cancellation} locale={locale} />
                        {o.payAtProperty.length > 0 && (
                          <p className="muted">
                            {t.results.payAtProperty}: {o.payAtProperty.map((m) => formatMoney(m, locale)).join(' + ')}
                          </p>
                        )}
                      </div>
                      <div className="price">
                        <strong>{formatMoney(o.total, locale)}</strong>
                        <span className="muted">
                          {formatMoney(o.perNightAverage, locale)} {t.results.perNight}
                        </span>
                        <OfferButton locale={locale} sessionId={view.sessionId} offerKey={o.key} label={`${t.results.choose}: ${h.name} – ${o.roomName ?? ''}`} />
                      </div>
                    </li>
                  );
                })}
              </ul>
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
