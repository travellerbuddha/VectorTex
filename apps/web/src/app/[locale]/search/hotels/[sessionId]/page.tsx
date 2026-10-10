import { isDomainError } from '@texholiday/contracts';
import { CalendarDays, ChevronDown, Coffee, MapPin, SlidersHorizontal, Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { OfferButton } from '../../../../../components/OfferButton';
import { CancellationLine } from '../../../../../components/QuoteSummary';
import { OpenOnWide } from '../../../../../components/results/OpenOnWide';
import { SearchForm } from '../../../../../components/SearchForm';
import { HotelMedia, RatingBadge, Stars } from '../../../../../components/ui/HotelBits';
import { countryOptions } from '../../../../../i18n/countries';
import { dict, type Locale } from '../../../../../i18n/dictionaries';
import { boardLabel, formatDate, formatMoney } from '../../../../../i18n/format';
import { booking } from '../../../../../server/booking';
import { activeFilters, applyFilters, boardCounts, readFilters, type ResultFilters } from '../../../../../server/result-filters';
import { TrackEvent } from '../../../../../components/tracking/TrackEvent';
import { searchEcommerce } from '../../../../../server/analytics';

export const dynamic = 'force-dynamic';

/** Query parameters that describe the search itself (kept by the filter form and its "clear" link). */
const SEARCH_KEYS = ['place', 'placeName', 'hotel', 'hotelName', 'board'] as const;

export default async function Results({ params, searchParams }: { params: Promise<{ locale: string; sessionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale: l, sessionId } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const locale = l as Locale;
  const t = dict(locale);
  const { app } = await booking();
  const criteria = await app.searchCriteria(sessionId);
  if (!criteria) notFound();
  const currencies = await app.availableCurrencies();
  const hotelTarget = 'hotelIds' in criteria.target ? criteria.target.hotelIds[0] : undefined;
  const place =
    hotelTarget && one('hotel') === hotelTarget
      ? { placeId: `hotel:${hotelTarget}`, hotelId: hotelTarget, name: one('hotelName') ?? hotelTarget, address: '' }
      : one('place') && one('placeName')
        ? { placeId: one('place')!, name: one('placeName')!, address: '' }
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
  const adults = criteria.rooms.reduce((n, r) => n + r.adults, 0);
  const children = criteria.rooms.reduce((n, r) => n + r.childAges.length, 0);

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

  const filters = readFilters(sp);
  const hotels = applyFilters(view.hotels, filters, new Date());
  const kept = Object.fromEntries(SEARCH_KEYS.flatMap((k) => (one(k) ? [[k, one(k)!]] : [])));
  const clearHref = `/${locale}/search/hotels/${sessionId}${Object.keys(kept).length ? `?${new URLSearchParams(kept).toString()}` : ''}`;
  const active = activeFilters(filters);

  return (
    <div className="page results">
      <TrackEvent event="search" params={{ search_term: place?.name ?? 'hotel search' }} />
      <TrackEvent event="view_item_list" params={searchEcommerce(hotels)} />
      <details className="refine">
        <summary>
          {place && (
            <span className="refine-fact">
              <MapPin />
              <strong>{place.name}</strong>
            </span>
          )}
          <span className="refine-fact">
            <CalendarDays />
            {formatDate(criteria.checkin, locale)} → {formatDate(criteria.checkout, locale)} · {t.results.nights(view.nights)}
          </span>
          <span className="refine-fact">
            <Users />
            {t.results.guests(adults, children, criteria.rooms.length)}
          </span>
          <span className="refine-change">
            {t.results.change}
            <ChevronDown />
          </span>
        </summary>
        {form}
      </details>

      <div className="results-head">
        <h1>{t.results.title}</h1>
        {view.hotels.length > 0 && <p className="muted">{t.results.count(hotels.length)}</p>}
      </div>
      {view.hotels.length === 0 ? (
        <p className="notice">{t.results.none}</p>
      ) : (
        <div className="results-layout">
          <OpenOnWide
            className="filters"
            summary={
              <>
                <SlidersHorizontal />
                {t.results.filters}
                {active > 0 && <span className="count">{active}</span>}
              </>
            }
          >
            <FilterForm locale={locale} filters={filters} kept={kept} boards={boardCounts(view.hotels)} clearHref={active > 0 || filters.sort !== 'recommended' ? clearHref : null} />
          </OpenOnWide>
          <div>
            {hotels.length === 0 && (
              <p className="notice" role="status">
                {t.results.noneFiltered} <a href={clearHref}>{t.results.clear}</a>
              </p>
            )}
            <ul className="hotels">
              {hotels.map((h, i) => (
                <li key={h.hotelId} className="card hotel">
                  {/* Provider images are https-only; no next/image so hosts need no allow-list. */}
                  <HotelMedia hotelId={h.hotelId} photo={h.photo} eager={i === 0} />
                  <div className="hotel-body">
                    <div className="hotel-head">
                      <div>
                        <h2>{h.name}</h2>
                        <Stars stars={h.stars} locale={locale} />
                        {h.address && (
                          <p className="hotel-where">
                            <MapPin />
                            {h.address}
                          </p>
                        )}
                      </div>
                      <RatingBadge rating={h.rating} locale={locale} />
                    </div>
                    <p className="from">
                      {t.results.forNights(view.nights)} {t.results.from} <strong>{formatMoney(h.from, locale)}</strong> <span className="muted">({t.results.total.toLowerCase()})</span>
                    </p>
                    <h3 className="visually-hidden">{t.results.rooms}</h3>
                    <ul className="offers">
                      {h.offers.map((o) => {
                        const board = boardLabel(o.boardType, o.boardName, locale);
                        return (
                          <li key={o.key} className="offer">
                            <div className="offer-info">
                              <p className="room-name">{o.roomName}</p>
                              {board && (
                                <p className="offer-board">
                                  <Coffee />
                                  {board}
                                </p>
                              )}
                              <CancellationLine c={o.cancellation} locale={locale} />
                              {o.payAtProperty.length > 0 && (
                                <p className="muted small">
                                  {t.results.payAtProperty}: {o.payAtProperty.map((m) => formatMoney(m, locale)).join(' + ')}
                                </p>
                              )}
                            </div>
                            <div className="price">
                              <strong>{formatMoney(o.total, locale)}</strong>
                              <span className="muted">{t.results.total}</span>
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
        </div>
      )}
    </div>
  );
}

/** Plain GET form: works without JavaScript; the search's own parameters ride along as hidden fields. */
function FilterForm({ locale, filters, kept, boards, clearHref }: { locale: Locale; filters: ResultFilters; kept: Record<string, string>; boards: Array<{ board: string; hotels: number }>; clearHref: string | null }) {
  const t = dict(locale).results;
  return (
    <form method="get">
      {Object.entries(kept).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="field">
        <label htmlFor="sort">{t.sort}</label>
        <select id="sort" name="sort" defaultValue={filters.sort}>
          {(['recommended', 'price', 'rating'] as const).map((s) => (
            <option key={s} value={s}>
              {t.sortBy[s]}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend>{t.cancelPolicy}</legend>
        <label className="check">
          <input type="checkbox" name="free" value="1" defaultChecked={filters.free} /> {t.freeCancel}
        </label>
      </fieldset>
      {boards.length > 0 && (
        <fieldset>
          <legend>{t.board}</legend>
          {boards.map((b) => (
            <label key={b.board} className="check">
              <input type="checkbox" name="boards" value={b.board} defaultChecked={filters.boards.includes(b.board)} /> {boardLabel(b.board, null, locale) ?? b.board}
              <span className="n">{b.hotels}</span>
            </label>
          ))}
        </fieldset>
      )}
      <fieldset>
        <legend>{t.stars}</legend>
        {[null, 3, 4, 5].map((n) => (
          <label key={n ?? 0} className="check">
            <input type="radio" name="stars" value={n ?? ''} defaultChecked={filters.stars === n} /> {n === 5 ? dict(locale).lists.stars(5) : n ? t.minStars(n) : t.anyStars}
          </label>
        ))}
      </fieldset>
      <div className="filter-actions">
        <button type="submit" className="primary">
          {t.apply}
        </button>
        {clearHref && <a href={clearHref}>{t.clear}</a>}
      </div>
    </form>
  );
}

export async function generateMetadata() {
  return { robots: { index: false } };
}
