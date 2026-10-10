import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { addDays, istanbulDate, type HotelPageView } from '@texholiday/booking';
import { HOTEL_BOARD_TYPES } from '@texholiday/contracts';
import { countryOptions } from '../../i18n/countries';
import { dict, type Locale } from '../../i18n/dictionaries';
import { boardLabel, formatInstant } from '../../i18n/format';
import { booking } from '../../server/booking';
import { breadcrumbList, hotelPage as hotelMarkup, jsonLd } from '../../server/structured-data';
import { SearchForm } from '../SearchForm';
import { hotelPath, hubPath, listPath, PriceBlock } from './HotelListPage';

/**
 * Hotel page (ADR-0014): static content cached from the provider, the list price (when current) and the search form
 * set to this hotel. Never fetches from the provider on request (no call cost from crawlers).
 */
const origin = () => process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';

/** The link's board filter and check-in date (validated); they decide which list price the page shows. */
function linkParams(searchParams: Record<string, string | undefined>): { board: string | null; checkin: string | null } {
  const board = searchParams.board && (HOTEL_BOARD_TYPES as readonly string[]).includes(searchParams.board) ? searchParams.board : null;
  const checkin = searchParams.checkin && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.checkin) ? searchParams.checkin : null;
  return { board, checkin };
}

/** One read per request, shared by the metadata and the page (each read evaluates the published lists). */
const read = cache(async (locale: Locale, slug: string, board: string | null, checkin: string | null) => {
  const { app } = await booking();
  return app.hotelLists.hotel(locale, slug, { board, checkin });
});

async function load(locale: Locale, slug: string, searchParams: Record<string, string | undefined>): Promise<HotelPageView> {
  const p = linkParams(searchParams);
  const view = await read(locale, slug, p.board, p.checkin);
  if (view) return view;
  notFound();
}

export async function hotelMetadata(locale: Locale, slug: string, searchParams: Record<string, string | undefined> = {}): Promise<Metadata> {
  const p = linkParams(searchParams);
  const view = await read(locale, slug, p.board, p.checkin);
  if (!view) return {};
  const c = view.content;
  const languages: Record<string, string> = {};
  for (const [l, s] of Object.entries(view.slugs)) if (l === 'tr' || l === 'en') languages[l] = `${origin()}${hotelPath(l, s)}`;
  if (view.slugs.tr) languages['x-default'] = `${origin()}${hotelPath('tr', view.slugs.tr)}`;
  const noindex = !view.indexable || process.env.HOTEL_PAGES_NOINDEX === 'true';
  const place = [c.city, c.country && c.country.length > 2 ? c.country : null].filter(Boolean).join(', ');
  return {
    title: place ? `${c.name} – ${place}` : c.name,
    description: c.description?.split('\n')[0]?.slice(0, 160) ?? undefined,
    alternates: { canonical: `${origin()}${hotelPath(locale, view.slug)}`, languages },
    openGraph: { title: c.name, images: c.images.slice(0, 1).map((i) => ({ url: i.url })), locale },
    robots: noindex ? { index: false, follow: true } : undefined,
  };
}

export async function HotelPage({ locale, slug, searchParams }: { locale: Locale; slug: string; searchParams: Record<string, string | undefined> }) {
  if (slug !== slug.toLowerCase()) permanentRedirect(hotelPath(locale, slug.toLowerCase()));
  const view = await load(locale, slug, searchParams);
  const t = dict(locale);
  const c = view.content;
  const { app } = await booking();
  const currencies = await app.availableCurrencies();
  const today = istanbulDate(new Date());
  const tomorrow = addDays(today, 1);
  const asked = searchParams.checkin && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.checkin) && searchParams.checkin >= tomorrow ? searchParams.checkin : null;
  const checkin = asked ?? view.price?.checkin ?? addDays(today, 14);
  const { board } = linkParams(searchParams);
  const list = view.lists[0];
  const crumbs = [
    { name: t.lists.home, path: `/${locale}` },
    { name: t.lists.hubTitle, path: hubPath(locale) },
    ...(list ? [{ name: list.title, path: listPath(locale, list.slug) }] : []),
    { name: c.name, path: hotelPath(locale, view.slug) },
  ];
  const markup = hotelMarkup(
    {
      name: c.name,
      url: hotelPath(locale, view.slug),
      images: c.images.map((i) => i.url),
      address: c.address,
      city: c.city,
      country: c.country,
      stars: c.stars,
      facilities: c.facilities,
      fromPrice: null,
      description: c.description,
      location: c.location,
      checkinTime: c.checkinTime,
      checkoutTime: c.checkoutTime,
    },
    origin(),
  );
  const nf = (n: number) => n.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB');
  return (
    <div className="page hotel-page">
      <nav aria-label="breadcrumb" className="breadcrumbs">
        <ol>
          {crumbs.map((cr, i) => (
            <li key={cr.path}>{i < crumbs.length - 1 ? <a href={cr.path}>{cr.name}</a> : <span aria-current="page">{cr.name}</span>}</li>
          ))}
        </ol>
      </nav>
      <header>
        <h1>{c.name}</h1>
        <p className="muted">
          {c.stars ? `${'★'.repeat(Math.round(c.stars))} ${t.lists.stars(Math.round(c.stars))} · ` : ''}
          {c.address}
        </p>
        {c.rating !== null && c.reviewCount !== null && c.reviewCount > 0 && <p className="muted small">{t.lists.rating(nf(c.rating), nf(c.reviewCount))}</p>}
      </header>
      {c.images.length > 0 && (
        <ul className="gallery" aria-label={c.name}>
          {c.images.slice(0, 8).map((img, i) => (
            <li key={img.url}>
              {/* eslint-disable-next-line @next/next/no-img-element -- provider images are https-only; no host allow-list */}
              <img src={img.url} alt={img.caption ?? c.name} loading={i === 0 ? 'eager' : 'lazy'} />
            </li>
          ))}
        </ul>
      )}
      <section className="card book-box" aria-labelledby="book-title">
        <h2 id="book-title">{t.lists.bookTitle}</h2>
        {view.price && (
          <>
            <PriceBlock price={view.price} locale={locale} />
            <p className="muted small">{t.lists.asOf(formatInstant(view.price.asOf, locale))}</p>
          </>
        )}
        <SearchForm
          locale={locale}
          currencies={currencies}
          countries={countryOptions(locale)}
          today={today}
          initial={{
            place: { placeId: `hotel:${view.hotelId}`, hotelId: view.hotelId, name: c.name, address: c.address ?? '' },
            checkin,
            checkout: addDays(checkin, 1),
            rooms: [{ adults: 2, childAges: [] }],
            ...(view.nationality ? { nationality: view.nationality } : {}),
            ...(view.currency ? { currency: view.currency } : {}),
            boardType: board,
          }}
        />
        {board && <p className="muted small">{boardLabel(board, null, locale)}</p>}
      </section>
      {c.description && (
        <section className="hotel-text">
          {c.description.split('\n\n').map((p, i) => (
            <p key={i}>
              {p.split('\n').map((line, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {line}
                </span>
              ))}
            </p>
          ))}
        </section>
      )}
      {c.facilities.length > 0 && (
        <section>
          <h2>{t.lists.facilities}</h2>
          <ul className="chips">
            {c.facilities.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}
      {(c.checkinTime || c.checkoutTime) && (
        <section>
          <h2>{t.lists.times}</h2>
          <p>
            {c.checkinTime && `${t.lists.checkin}: ${c.checkinTime}`}
            {c.checkinTime && c.checkoutTime && ' · '}
            {c.checkoutTime && `${t.lists.checkout}: ${c.checkoutTime}`}
          </p>
        </section>
      )}
      {c.importantInformation && (
        <section>
          <h2>{t.lists.important}</h2>
          {c.importantInformation.split('\n\n').map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}
      {c.nearby.length > 0 && (
        <section>
          <h2>{t.lists.nearby}</h2>
          <ul>
            {c.nearby.map((n) => (
              <li key={n.name}>
                {n.name}
                {n.distanceKm !== null ? ` · ${t.lists.km(nf(n.distanceKm))}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.lists.length > 0 && (
        <section>
          <h2>{t.lists.inLists}</h2>
          <ul>
            {view.lists.map((l) => (
              <li key={l.cmsId}>
                <a href={listPath(locale, l.slug)}>{l.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small">
        {t.lists.code}: <code>{view.hotelId}</code>
      </p>
      {markup && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(markup) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList(origin(), crumbs)) }} />
    </div>
  );
}
