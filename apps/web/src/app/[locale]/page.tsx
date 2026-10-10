import { ArrowRight, BadgeCheck, CalendarX2, Plane, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { guidePath, guideHubPath } from '../../components/content/GuidePages';
import { featuredLists, hubPath, listPath } from '../../components/hotels/HotelListPage';
import { SearchForm } from '../../components/SearchForm';
import { CoastScene, HotelArt } from '../../components/ui/Art';
import { countryOptions } from '../../i18n/countries';
import { dict, isLocale } from '../../i18n/dictionaries';
import { booking } from '../../server/booking';
import { listPosts } from '../../server/cms-content';

export const dynamic = 'force-dynamic';

/**
 * Home (Persuade): the coast scene and the search docked under it, then what the site promises (each fact is how the
 * booking flow already works), the editors' hotel lists and guide articles when the CMS has them.
 */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Pages render alongside the layout, so they check the locale themselves (e.g. /favicon.ico is not a locale).
  if (!isLocale(locale)) notFound();
  const t = dict(locale);
  const { app } = await booking();
  const currencies = await app.availableCurrencies();
  const [lists, guides, flightsOpen] = await Promise.all([
    featuredLists(locale, 3),
    listPosts(locale, 1, 3).catch(() => ({ posts: [], totalPages: 0 })),
    app
      .availableFlightCurrencies()
      .then((c) => c.length > 0)
      .catch(() => false),
  ]);
  const icons = [<BadgeCheck key="a" />, <CalendarX2 key="b" />, <ShieldCheck key="c" />];
  return (
    <div className="home">
      <section className="hero on-dark" aria-labelledby="home-title">
        <CoastScene className="hero-art" />
        <div className="hero-inner">
          <h1 id="home-title">{t.search.title}</h1>
          <svg className="hero-swash" viewBox="0 0 220 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d="M3 8.5C40 3 80 2.5 118 5.5S190 10 217 4" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <p className="hero-sub">{t.home.sub}</p>
        </div>
      </section>
      <div className="hero-search">
        <SearchForm locale={locale} currencies={currencies} countries={countryOptions(locale)} today={new Date().toISOString().slice(0, 10)} />
      </div>

      <div className="wrap">
        <section className="promise" aria-label={t.home.promiseLabel}>
          <ul>
            {t.home.promise.map((p, i) => (
              <li key={p.title}>
                {icons[i]}
                <strong>{p.title}</strong>
                <p>{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {lists.length > 0 && (
          <section className="section" aria-labelledby="home-lists">
            <div className="section-head">
              <h2 id="home-lists">{t.home.lists}</h2>
              <a href={hubPath(locale)}>
                {t.home.allLists}
                <ArrowRight />
              </a>
            </div>
            <ul className="postcards">
              {lists.map((l) => (
                <li key={l.slug}>
                  <article className="postcard">
                    <div className="postcard-media">
                      {l.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- CMS image
                        <img src={l.image.url} alt="" loading="lazy" />
                      ) : (
                        <HotelArt seed={l.slug} />
                      )}
                    </div>
                    <div className="postcard-body">
                      <h3>
                        <a href={listPath(locale, l.slug)}>{l.title}</a>
                      </h3>
                      {l.intro && <p>{l.intro}</p>}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        )}

        {flightsOpen && (
          <section className="flights-band on-dark" aria-labelledby="home-flights">
            <div>
              <h2 id="home-flights">
                <Plane />
                {t.home.flightsTitle}
              </h2>
              <p>{t.home.flightsText}</p>
            </div>
            <a className="button primary" href={`/${locale}/flights`}>
              {t.home.flightsCta}
              <ArrowRight />
            </a>
          </section>
        )}

        {guides.posts.length > 0 && (
          <section className="section" aria-labelledby="home-guides">
            <div className="section-head">
              <h2 id="home-guides">{t.home.guides}</h2>
              <a href={guideHubPath(locale)}>
                {t.home.allGuides}
                <ArrowRight />
              </a>
            </div>
            <ul className="postcards">
              {guides.posts.map((p) => (
                <li key={p.slug}>
                  <article className="postcard">
                    <div className="postcard-media">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- CMS image
                        <img src={p.image.url} alt="" loading="lazy" />
                      ) : (
                        <HotelArt seed={`guide-${p.slug}`} />
                      )}
                    </div>
                    <div className="postcard-body">
                      <h3>
                        <a href={guidePath(locale, p.slug)}>{p.title}</a>
                      </h3>
                      {p.excerpt && <p>{p.excerpt}</p>}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
