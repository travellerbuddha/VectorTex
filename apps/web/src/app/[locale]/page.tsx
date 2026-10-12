import { ArrowRight, BadgeCheck, CalendarX2, Plane, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Fragment, type CSSProperties } from 'react';
import { RichText } from '../../components/cms/RichText';
import { faqPath, guidePath, guideHubPath } from '../../components/content/GuidePages';
import { featuredLists, hubPath, listPath, listShelf, PriceBlock, priceLink } from '../../components/hotels/HotelListPage';
import { SearchForm } from '../../components/SearchForm';
import { CoastScene } from '../../components/ui/Art';
import { HotelTile, Postcard } from '../../components/ui/HotelBits';
import { Shelf } from '../../components/ui/Shelf';
import { dict, isLocale } from '../../i18n/dictionaries';
import { formatInstant } from '../../i18n/format';
import { booking } from '../../server/booking';
import { listFaqs, listPosts } from '../../server/cms-content';

export const dynamic = 'force-dynamic';

/**
 * Home (Persuade): the search next to the coast; the hotels of the newest editors' list with their list prices; the
 * lists themselves; how the site sells; flights (when on sale); the latest guides and the most asked questions.
 * Every price shows its terms and time; every fact is how the booking flow already works.
 */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Pages render alongside the layout, so they check the locale themselves (e.g. /favicon.ico is not a locale).
  if (!isLocale(locale)) notFound();
  const t = dict(locale);
  const { app } = await booking();
  const currencies = await app.availableCurrencies();
  const [lists, guides, flightsOpen, faqs] = await Promise.all([
    featuredLists(locale, 4),
    listPosts(locale, 1, 3).catch(() => ({ posts: [], totalPages: 0 })),
    app
      .availableFlightCurrencies()
      .then((c) => c.length > 0)
      .catch(() => false),
    listFaqs(locale).catch(() => []),
  ]);
  // The shelf shows the newest list that has hotels to show.
  let shelf: { list: (typeof lists)[number]; hotels: NonNullable<Awaited<ReturnType<typeof listShelf>>> } | null = null;
  for (const list of lists) {
    const hotels = await listShelf(locale, list, 10);
    if (hotels) {
      shelf = { list, hotels };
      break;
    }
  }
  const icons = [<BadgeCheck key="a" />, <CalendarX2 key="b" />, <ShieldCheck key="c" />];
  const comma = t.footerTagline.indexOf(',');
  return (
    <div className="home">
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-text">
          <h1 id="home-title" className="hero-title">
            {t.search.title.split(' ').map((w, i) => (
              <Fragment key={i}>
                {i > 0 && ' '}
                <span className="w">
                  <span style={{ '--i': i } as CSSProperties}>{w}</span>
                </span>
              </Fragment>
            ))}
          </h1>
          <p className="hero-sub">{t.home.sub}</p>
        </div>
        <div className="hero-search">
          <SearchForm locale={locale} currencies={currencies} today={new Date().toISOString().slice(0, 10)} />
        </div>
        <div className="hero-visual" aria-hidden="true">
          <CoastScene className="hero-art" />
        </div>
      </section>

      {shelf && (
        <section className="band shelf-band" aria-labelledby="home-shelf">
          <div className="band-head" data-reveal="rise">
            <h2 id="home-shelf">{shelf.list.title}</h2>
            {shelf.list.intro && <p>{shelf.list.intro}</p>}
            <a className="text-link" href={listPath(locale, shelf.list.slug)}>
              {t.home.seeList}
              <ArrowRight />
            </a>
          </div>
          <Shelf label={shelf.list.title} prev={t.home.shelfPrev} next={t.home.shelfNext}>
            <ul>
              {shelf.hotels.hotels.map((h) => (
                <li key={h.hotelId}>
                  <HotelTile href={priceLink(locale, h, h.price, shelf.list.board)} hotel={h} locale={locale}>
                    {h.price && <PriceBlock price={h.price} locale={locale} />}
                  </HotelTile>
                </li>
              ))}
            </ul>
          </Shelf>
          <p className="fine-print">{shelf.hotels.pricesAsOf ? t.lists.asOf(formatInstant(shelf.hotels.pricesAsOf, locale)) : t.lists.noPrices}</p>
        </section>
      )}

      {lists.length > 0 && (
        <section className="band lists-band" aria-labelledby="home-lists">
          <div className="band-head" data-reveal="rise">
            <h2 id="home-lists">{t.home.lists}</h2>
            <p>{t.lists.hubIntro}</p>
            <a className="text-link" href={hubPath(locale)}>
              {t.home.allLists}
              <ArrowRight />
            </a>
          </div>
          <ul className={`mosaic mosaic-${Math.min(lists.length, 4)}`}>
            {lists.map((l, i) => (
              <li key={l.slug} data-reveal="rise" data-reveal-delay={i * 70}>
                <Postcard href={listPath(locale, l.slug)} title={l.title} text={l.intro} image={l.image} seed={l.slug} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="promise" aria-labelledby="home-promise">
        <div className="promise-head" data-reveal="rise">
          <p className="eyebrow">{t.home.promiseLabel}</p>
          <h2 id="home-promise">
            {comma > 0 ? (
              <>
                {t.footerTagline.slice(0, comma + 1)} <span className="tone-accent">{t.footerTagline.slice(comma + 1).trim()}</span>
              </>
            ) : (
              t.footerTagline
            )}
          </h2>
        </div>
        <ul className="promise-list">
          {t.home.promise.map((p, i) => (
            <li key={p.title} data-reveal="rise" data-reveal-delay={70 * i}>
              <span className="promise-icon" aria-hidden="true">
                {icons[i]}
              </span>
              <div>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {flightsOpen && (
        <section className="flights-tile" aria-labelledby="home-flights">
          <div className="flights-copy" data-reveal="rise">
            <span className="flights-icon" aria-hidden="true">
              <Plane />
            </span>
            <div>
              <h2 id="home-flights">{t.home.flightsTitle}</h2>
              <p>{t.home.flightsText}</p>
            </div>
          </div>
          <a className="button" href={`/${locale}/flights`}>
            {t.home.flightsCta}
            <ArrowRight />
          </a>
        </section>
      )}

      {guides.posts.length > 0 && (
        <section className="band guides-band" aria-labelledby="home-guides">
          <div className="band-head" data-reveal="rise">
            <h2 id="home-guides">{t.home.guides}</h2>
            <p>{t.guides.hubIntro}</p>
            <a className="text-link" href={guideHubPath(locale)}>
              {t.home.allGuides}
              <ArrowRight />
            </a>
          </div>
          <ul className={`articles articles-${guides.posts.length}`}>
            {guides.posts.map((p, i) => (
              <li key={p.slug} data-reveal="rise" data-reveal-delay={i * 70}>
                <Postcard href={guidePath(locale, p.slug)} title={p.title} text={p.excerpt} image={p.image} seed={`guide-${p.slug}`} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {faqs.length > 0 && (
        <section className="band faq-band" aria-labelledby="home-faq">
          <div className="band-head" data-reveal="rise">
            <h2 id="home-faq">{t.faq.title}</h2>
            <p>{t.faq.intro}</p>
            <a className="text-link" href={faqPath(locale)}>
              {t.home.allFaqs}
              <ArrowRight />
            </a>
          </div>
          <div className="faq faq-short">
            {faqs.slice(0, 5).map((q) => (
              <details key={q.id}>
                <summary>{q.question}</summary>
                <RichText data={q.answer} />
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
