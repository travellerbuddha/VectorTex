import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ListedHotel, ListedPrice } from '@texholiday/booking';
import { dict, type Locale } from '../../i18n/dictionaries';
import { boardLabel, formatDate, formatInstant, formatMoney } from '../../i18n/format';
import { booking } from '../../server/booking';
import { cms, cmsEnabled } from '../../server/cms';
import { loadBySlug } from '../../server/cms-content';
import { HOTEL_LIST_DIR, PATHS } from '../../server/seo';
import { breadcrumbList, hotelItemList, jsonLd } from '../../server/structured-data';
import { cmsMetadata, PreviewBanner } from '../cms/CmsPage';
import { TrackEvent } from '../tracking/TrackEvent';
import { listEcommerce } from '../../server/analytics';
import { RichText } from '../cms/RichText';

/**
 * Hotel list page (ADR-0014): editor text from the CMS, hotels and prices from the core copy of the published list.
 * Everything Google reads is in the server-rendered HTML; prices are shown with their conditions and time.
 */
type Media = { url?: string | null; alt?: string | null; width?: number | null; height?: number | null } | null | undefined | number | string;
const origin = () => process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
export const hotelPath = (l: Locale, slug: string) => PATHS.hotels(l, slug);
export const listPath = (l: Locale, slug: string) => PATHS.hotelLists(l, slug);
export const hubPath = (l: Locale) => `/${l}/${HOTEL_LIST_DIR[l]}`;

/** "See prices" link: the hotel page with the price's date (and the list's board filter). */
export function priceLink(l: Locale, h: Pick<ListedHotel, 'slug'>, price: ListedPrice | null, board: string | null): string {
  const q = new URLSearchParams();
  if (price) q.set('checkin', price.checkin);
  if (board) q.set('board', board);
  const qs = q.toString();
  return `${hotelPath(l, h.slug)}${qs ? `?${qs}` : ''}`;
}

export function PriceBlock({ price, locale }: { price: ListedPrice; locale: Locale }) {
  const t = dict(locale).lists;
  const board = boardLabel(price.boardType, null, locale);
  const extras = [price.payAtProperty ? t.payAtHotel(formatMoney(price.payAtProperty, locale)) : null, price.payAtPropertyOtherCurrency ? t.payAtHotelOther : null].filter(Boolean);
  return (
    <div className="list-price">
      <span className="muted">{t.lowest}</span> <strong data-testid="list-price">{formatMoney(price.amount, locale)}</strong>
      <span className="muted small">
        {' '}
        · {t.conditions(formatDate(price.checkin, locale))}
        {board ? ` · ${board}` : ''} · {extras.length > 0 ? extras.join(' · ') : t.taxesIncluded}
      </span>
    </div>
  );
}

export async function hotelListMetadata(locale: Locale, slug: string): Promise<Metadata> {
  const loaded = await loadBySlug('hotel-lists', slug, locale);
  if (!loaded) return {};
  const m = cmsMetadata(loaded, locale, (l, s) => listPath(l, s), { title: String(loaded.doc.title ?? ''), description: (loaded.doc.intro as string | null) ?? null });
  const tr = loaded.slugs.tr;
  return { ...m, alternates: { ...m.alternates, languages: { ...(m.alternates?.languages ?? {}), ...(tr ? { 'x-default': `${origin()}${listPath('tr', tr)}` } : {}) } } };
}

export async function HotelListPage({ locale, slug }: { locale: Locale; slug: string }) {
  const loaded = await loadBySlug('hotel-lists', slug, locale);
  if (!loaded) notFound();
  const t = dict(locale);
  const d = loaded.doc;
  const title = String(d.title ?? '');
  const { app } = await booking();
  // In a preview the page shows the draft text but the hotels of the published version.
  const view = await app.hotelLists.list(String(d.id), locale, loaded.preview ? null : typeof d.updatedAt === 'string' ? d.updatedAt : null);
  const hotels = view?.hotels ?? [];
  const board = typeof d.boardType === 'string' && d.boardType !== 'ANY' ? d.boardType : null;
  const image = d.heroImage as Media;
  const faq = (Array.isArray(d.faq) ? d.faq : []) as Array<{ question?: string; answer?: string }>;
  const markup = hotelItemList({
    name: title,
    url: listPath(locale, slug),
    origin: origin(),
    hotels: hotels.map((h) => ({
      name: h.name,
      url: hotelPath(locale, h.slug),
      images: h.image ? [h.image] : [],
      address: h.address,
      city: h.city,
      country: null,
      stars: h.stars,
      facilities: h.facilities,
      fromPrice: h.price ? formatMoney(h.price.amount, locale) : null,
    })),
  });
  const crumbs = [
    { name: t.lists.home, path: `/${locale}` },
    { name: t.lists.hubTitle, path: hubPath(locale) },
    { name: title, path: listPath(locale, slug) },
  ];
  return (
    <div className="page hotel-list">
      {loaded.preview && <PreviewBanner locale={locale} />}
      <TrackEvent event="view_item_list" params={listEcommerce(slug, title, hotels)} />
      <nav aria-label="breadcrumb" className="breadcrumbs">
        <ol>
          {crumbs.map((c, i) => (
            <li key={c.path}>{i < crumbs.length - 1 ? <a href={c.path}>{c.name}</a> : <span aria-current="page">{c.name}</span>}</li>
          ))}
        </ol>
      </nav>
      <header className="list-hero">
        {image && typeof image === 'object' && image.url && (
          // eslint-disable-next-line @next/next/no-img-element -- CMS image with its stored size
          <img src={image.url} alt={image.alt ?? ''} width={image.width ?? undefined} height={image.height ?? undefined} className="cms-hero-image" />
        )}
        <h1>{title}</h1>
        {typeof d.intro === 'string' && d.intro && <p className="lead">{d.intro}</p>}
        {hotels.length > 0 && (
          <p className="muted" data-testid="list-summary">
            {t.lists.summary(hotels.length)}
            {view?.priceRange ? ` · ${t.lists.range(formatMoney(view.priceRange.min, locale), formatMoney(view.priceRange.max, locale))}` : ''}
            {board ? ` · ${boardLabel(board, null, locale) ?? board}` : ''}
          </p>
        )}
      </header>
      {hotels.length === 0 ? (
        <p className="notice">{t.lists.empty}</p>
      ) : (
        <ol className="hotel-cards" data-testid="hotel-cards">
          {hotels.map((h) => (
            <li key={h.hotelId} className="card hotel-card">
              {h.image && (
                // eslint-disable-next-line @next/next/no-img-element -- provider images are https-only; no host allow-list
                <img src={h.image} alt={h.name} loading="lazy" className="hotel-photo" />
              )}
              <div className="hotel-body">
                <h2>
                  <a href={hotelPath(locale, h.slug)}>{h.name}</a>
                </h2>
                <p className="muted">
                  {h.stars ? `${'★'.repeat(Math.round(h.stars))} ${t.lists.stars(Math.round(h.stars))}` : ''}
                  {h.city ? `${h.stars ? ' · ' : ''}${h.city}` : ''}
                </p>
                {h.rating !== null && h.reviewCount !== null && h.reviewCount > 0 && <p className="muted small">{t.lists.rating(h.rating.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB'), h.reviewCount.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB'))}</p>}
                {h.facilities.length > 0 && (
                  <ul className="chips" aria-label={t.lists.facilities}>
                    {h.facilities.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                {h.price && <PriceBlock price={h.price} locale={locale} />}
                <a className="button primary" href={priceLink(locale, h, h.price, board)}>
                  {h.price ? t.lists.seePrices : t.lists.choose}
                </a>
              </div>
            </li>
          ))}
        </ol>
      )}
      {view?.pricesAsOf ? <p className="muted small">{t.lists.asOf(formatInstant(view.pricesAsOf, locale))}</p> : hotels.length > 0 && <p className="muted small">{t.lists.noPrices}</p>}
      <section className="cms-text">
        <RichText data={d.body} />
      </section>
      {faq.length > 0 && (
        <section className="faq">
          <h2>{t.lists.faq}</h2>
          {faq.map((q, i) => (
            <details key={i}>
              <summary>{q.question}</summary>
              <p>{q.answer}</p>
            </details>
          ))}
        </section>
      )}
      {typeof d.updatedAt === 'string' && (
        <p className="muted small">
          {t.lists.updated}: {formatInstant(d.updatedAt, locale)}
        </p>
      )}
      {markup && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(markup) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList(origin(), crumbs)) }} />
    </div>
  );
}

/** /tr/oteller and /en/hotels: every published list in the language. */
export async function HotelListHub({ locale }: { locale: Locale }) {
  const t = dict(locale).lists;
  const lists: Array<{ title: string; slug: string; intro: string | null }> = [];
  if (cmsEnabled()) {
    const payload = await cms();
    const res = await payload.find({ collection: 'hotel-lists', locale, fallbackLocale: false, depth: 0, limit: 200, overrideAccess: false, select: { title: true, slug: true, intro: true } });
    for (const d of res.docs as Array<{ title?: string; slug?: string; intro?: string | null }>) if (d.title && d.slug) lists.push({ title: d.title, slug: d.slug, intro: d.intro ?? null });
  }
  return (
    <div className="page hotel-list-hub">
      <h1>{t.hubTitle}</h1>
      <p className="lead">{t.hubIntro}</p>
      <ul className="list-links">
        {lists.map((l) => (
          <li key={l.slug} className="card">
            <h2>
              <a href={listPath(locale, l.slug)}>{l.title}</a>
            </h2>
            {l.intro && <p className="muted">{l.intro}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function hubMetadata(locale: Locale): Metadata {
  const t = dict(locale).lists;
  const languages = { tr: `${origin()}${hubPath('tr')}`, en: `${origin()}${hubPath('en')}`, 'x-default': `${origin()}${hubPath('tr')}` };
  return { title: t.hubTitle, description: t.hubIntro, alternates: { canonical: `${origin()}${hubPath(locale)}`, languages } };
}
