import { ArrowRight, BadgeCheck, CalendarX2, ChevronRight, Plane, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Fragment, type CSSProperties } from 'react';
import { faqPath, guidePath, guideHubPath } from '../../components/content/GuidePages';
import { featuredLists, hubPath, listPath } from '../../components/hotels/HotelListPage';
import { SearchForm } from '../../components/SearchForm';
import { CoastScene } from '../../components/ui/Art';
import { Postcard } from '../../components/ui/HotelBits';
import { dict, isLocale } from '../../i18n/dictionaries';
import { booking } from '../../server/booking';
import { listFaqs, listPosts } from '../../server/cms-content';

export const dynamic = 'force-dynamic';

/** Words as spans numbered from `from`, so a heading can fill with ink word by word as it scrolls into view. */
const inkWords = (text: string, from: number) =>
  text.split(' ').map((w, k) => (
    <Fragment key={k}>
      {k > 0 && ' '}
      <span className="ink" style={{ '--w': from + k } as CSSProperties}>
        {w}
      </span>
    </Fragment>
  ));

/** "Öne çıkan otel listeleri" → ["Öne", "çıkan otel listeleri"]: the first word in ink, the rest in the second tone. */
const twoTone = (s: string) => {
  const at = s.indexOf(' ');
  return at > 0 ? [s.slice(0, at), s.slice(at + 1)] : [s, ''];
};

/**
 * Home (Persuade): the search over the coast, how the site sells, the editors' hotel lists, the flights tile (when
 * flight sales are open) and the latest guides. Every fact is how the booking flow already works.
 */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Pages render alongside the layout, so they check the locale themselves (e.g. /favicon.ico is not a locale).
  if (!isLocale(locale)) notFound();
  const t = dict(locale);
  const { app } = await booking();
  const currencies = await app.availableCurrencies();
  const [lists, guides, flightsOpen, faqs] = await Promise.all([
    featuredLists(locale, 3),
    listPosts(locale, 1, 3).catch(() => ({ posts: [], totalPages: 0 })),
    app
      .availableFlightCurrencies()
      .then((c) => c.length > 0)
      .catch(() => false),
    listFaqs(locale).catch(() => []),
  ]);
  const icons = [<BadgeCheck key="a" />, <CalendarX2 key="b" />, <ShieldCheck key="c" />];
  const comma = t.footerTagline.indexOf(',');
  const [listsLead, listsRest] = twoTone(t.home.lists);
  const [guidesLead, guidesRest] = twoTone(t.home.guides);
  return (
    <div className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-stage" aria-hidden="true">
          <CoastScene className="hero-art" />
        </div>
        <div className="hero-copy">
          <h1 id="home-title">
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
      </section>

      <section className="promise" aria-labelledby="home-promise">
        <div className="promise-head" data-reveal="rise">
          <p className="eyebrow">{t.home.promiseLabel}</p>
          <h2 id="home-promise" className="ink-fill">
            {comma > 0 ? (
              <>
                {inkWords(t.footerTagline.slice(0, comma + 1), 0)}{' '}
                <span className="tone-accent">{inkWords(t.footerTagline.slice(comma + 1).trim(), t.footerTagline.slice(0, comma + 1).split(' ').length)}</span>
              </>
            ) : (
              inkWords(t.footerTagline, 0)
            )}
          </h2>
        </div>
        <ul className="promise-list">
          {t.home.promise.map((p, i) => (
            <li key={p.title} data-reveal="rise" data-reveal-delay={80 * i}>
              <span className="promise-icon" aria-hidden="true">
                {icons[i]}
              </span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </li>
          ))}
        </ul>
        {faqs.length > 0 && (
          <p className="promise-more" data-reveal="fade">
            <span>{t.faq.intro}</span>{' '}
            <a className="text-link" href={faqPath(locale)}>
              {t.faq.title}
              <ChevronRight />
            </a>
          </p>
        )}
      </section>

      {lists.length > 0 && (
        <section className="home-section lists-section" aria-labelledby="home-lists">
          <div className="section-head" data-reveal="rise">
            <h2 id="home-lists" className="two-tone">
              <span>{listsLead}</span> <span className="tone">{listsRest}</span>
            </h2>
            <p>{t.lists.hubIntro}</p>
            <a className="text-link" href={hubPath(locale)}>
              {t.home.allLists}
              <ArrowRight />
            </a>
          </div>
          <ul className={`discover discover-${lists.length}`}>
            {lists.map((l, i) => (
              <li key={l.slug} data-reveal="rise" data-reveal-duration="640" data-reveal-delay={i * 90}>
                <Postcard href={listPath(locale, l.slug)} title={l.title} text={l.intro} image={l.image} seed={l.slug} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {flightsOpen && (
        <section className="flights-tile on-dark" aria-labelledby="home-flights">
          <div className="flights-copy" data-reveal="rise">
            <Plane className="flights-icon" aria-hidden="true" />
            <h2 id="home-flights">{t.home.flightsTitle}</h2>
            <p>{t.home.flightsText}</p>
            <a className="button sun" href={`/${locale}/flights`}>
              {t.home.flightsCta}
              <ArrowRight />
            </a>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- the site's own coast artwork, decorative */}
          <img className="flights-art" src="/art/coast-scene.png" alt="" width={4000} height={1400} loading="lazy" decoding="async" />
        </section>
      )}

      {guides.posts.length > 0 && (
        <section className="home-section guides-section" aria-labelledby="home-guides">
          <div className="section-head" data-reveal="rise">
            <h2 id="home-guides" className="two-tone">
              <span>{guidesLead}</span> <span className="tone">{guidesRest}</span>
            </h2>
            <p>{t.guides.hubIntro}</p>
            <a className="text-link" href={guideHubPath(locale)}>
              {t.home.allGuides}
              <ArrowRight />
            </a>
          </div>
          <ul className="guide-rows">
            {guides.posts.map((p, i) => (
              <li key={p.slug} data-reveal="lift" data-reveal-duration="640" data-reveal-delay={i * 80}>
                <Postcard href={guidePath(locale, p.slug)} title={p.title} text={p.excerpt} image={p.image} seed={`guide-${p.slug}`} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
