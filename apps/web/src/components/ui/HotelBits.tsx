import { ArrowRight, Check, MapPin, Star, type LucideIcon } from 'lucide-react';
import { dict, type Locale } from '../../i18n/dictionaries';
import { HotelArt } from './Art';

const nf = (locale: Locale) => new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Official star category, read out as text ("4 yıldızlı"). */
export function Stars({ stars, locale }: { stars: number | null; locale: Locale }) {
  if (!stars || stars < 1) return null;
  const n = Math.min(5, Math.round(stars));
  return (
    <span className="stars" role="img" aria-label={dict(locale).lists.stars(n)}>
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} fill="currentColor" strokeWidth={0} />
      ))}
    </span>
  );
}

/** Guest rating out of 10 (provider data) with its word: 9+ exceptional, 8+ very good, 7+ good. */
export function RatingBadge({ rating, locale, reviews }: { rating: number | null; locale: Locale; reviews?: number | null }) {
  if (rating === null || rating <= 0) return null;
  const t = dict(locale).results;
  const word = t.ratingWord(rating);
  return (
    <p className="rating-badge">
      <span className="score">
        <span className="visually-hidden">{t.rating}: </span>
        {nf(locale).format(rating)}
        <span className="visually-hidden">/10</span>
      </span>
      <span className="rating-text">
        {word && <strong>{word}</strong>}
        <small>{reviews ? t.reviews(reviews.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB')) : t.guestRating}</small>
      </span>
    </p>
  );
}

/** The rating on one line for discovery cards: score, its word and the review count (provider data). */
export function RatingInline({ rating, reviews, locale }: { rating: number | null; reviews: number | null; locale: Locale }) {
  if (rating === null || rating <= 0) return null;
  const t = dict(locale).results;
  const word = t.ratingWord(rating);
  return (
    <p className="rating-inline">
      <span className="score-chip">
        <span className="visually-hidden">{t.rating}: </span>
        {nf(locale).format(rating)}
        <span className="visually-hidden">/10</span>
      </span>
      {word && <strong>{word}</strong>}
      {reviews ? <span>{t.reviews(reviews.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB'))}</span> : null}
    </p>
  );
}

/**
 * Shared-element name of a hotel's picture: the list card's photo becomes the hotel page's first gallery photo. The
 * class lets one rule crop every such picture to its frame while it moves (no stretched or overflowing snapshot).
 */
export const hotelTransition = (slug: string) =>
  ({ viewTransitionName: `hotel-${slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`, viewTransitionClass: 'hotel-photo' }) as React.CSSProperties;

/** A price, what it is and its terms on their own line: the same block on every card. */
export function PriceLine({ label, amount, terms, testId }: { label: string; amount: string; terms: string; testId?: string }) {
  return (
    <div className="list-price">
      <span className="muted">{label}</span> <strong data-testid={testId}>{amount}</strong>
      {/* Its own line under the price: the terms the price was found with. */}
      <span className="muted small list-price-terms">{terms}</span>
    </div>
  );
}

export interface CardTag {
  key: string;
  text: string;
  /** feature: what the hotel has (facilities, room choice); ok: a condition in the guest's favour, from the offer data. */
  kind: 'feature' | 'ok';
  icon?: LucideIcon;
}

/**
 * The hotel card, one design on every page (home shelf, list pages, search results): photo, name, stars and place,
 * the guest rating, up to three tags (facts from the data only), then the price with its terms and the action. The
 * name's link covers the card, so the card is one stop for keyboard and screen readers; the action reads as a button
 * and leads to the same hotel page. The card follows the room it gets (container query): stacked when narrow, a row
 * when wide, so the same card fits a shelf, a phone and the results column.
 */
export function HotelCard({
  href,
  hotel,
  locale,
  heading: H = 'h3',
  tags = [],
  tagsLabel,
  price,
  action,
  transition,
  eager = false,
}: {
  href: string;
  hotel: { hotelId: string; name: string; stars: number | null; place: string | null; image: string | null; rating: number | null; reviewCount: number | null };
  locale: Locale;
  heading?: 'h2' | 'h3';
  tags?: readonly CardTag[];
  tagsLabel?: string;
  price?: React.ReactNode;
  action: string;
  transition?: React.CSSProperties;
  eager?: boolean;
}) {
  return (
    <article className="hotel-card">
      <div className="hc">
        <HotelMedia hotelId={hotel.hotelId} photo={hotel.image} className="hc-media" style={transition} eager={eager} />
        <div className="hc-body">
          <H className="hc-title">
            <a href={href}>{hotel.name}</a>
          </H>
          <p className="hc-meta">
            <Stars stars={hotel.stars} locale={locale} />
            {hotel.place && (
              <span className="hotel-where">
                <MapPin />
                {hotel.place}
              </span>
            )}
          </p>
          <RatingInline rating={hotel.rating} reviews={hotel.reviewCount} locale={locale} />
          {tags.length > 0 && (
            <ul className="hc-tags" aria-label={tagsLabel}>
              {tags.slice(0, 3).map(({ key, text, kind, icon: Icon }) => (
                <li key={key} className={kind === 'ok' ? 'tag ok' : 'tag tag-feature'}>
                  {Icon && <Icon />}
                  {text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="hc-deal">
          {price}
          {/* The name's link already leads here; this only shows the action. */}
          <span className="hc-action" aria-hidden="true">
            {action}
            <ArrowRight />
          </span>
        </div>
      </div>
    </article>
  );
}

/** The hotel's photo, or its postcard when the provider has none. */
export function HotelMedia({ hotelId, photo, className, eager = false, style }: { hotelId: string; photo: string | null; className?: string; eager?: boolean; style?: React.CSSProperties }) {
  return (
    <div className={`hotel-media${className ? ` ${className}` : ''}`} style={style}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider images are https-only; no host allow-list
        <img src={photo} alt="" loading={eager ? 'eager' : 'lazy'} className="hotel-photo" />
      ) : (
        <HotelArt seed={hotelId} className="hotel-art" />
      )}
    </div>
  );
}

/** A list or guide picture: the CMS image when an editor uploaded one, else the postcard drawn from the seed, in the same box. */
export function MediaSlot({
  image,
  seed,
  className,
  ...rest
}: { image: { url: string } | null; seed: string; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`media-slot${className ? ` ${className}` : ''}`} {...rest}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- CMS image
        <img src={image.url} alt="" loading="lazy" decoding="async" />
      ) : (
        <HotelArt seed={seed} />
      )}
    </div>
  );
}

/** A list or guide teaser: CMS image or a postcard from the seed; the whole card is the link. */
export function Postcard({
  href,
  title,
  text,
  image,
  seed,
  heading: H = 'h3',
  children,
}: {
  href: string;
  title: string;
  text: string | null;
  image: { url: string } | null;
  seed: string;
  heading?: 'h2' | 'h3';
  children?: React.ReactNode;
}) {
  return (
    <article className="postcard">
      <MediaSlot image={image} seed={seed} className="postcard-media" />
      <div className="postcard-body">
        <H>
          <a href={href}>{title}</a>
        </H>
        {children}
        {text && <p>{text}</p>}
      </div>
    </article>
  );
}

export type BookingStep = 'room' | 'details' | 'payment' | 'done';
const STEPS: BookingStep[] = ['room', 'details', 'payment', 'done'];

/** Where the customer is in the booking: done steps are ticked, the current one is announced as the current step. */
export function BookingSteps({ current, locale, product = 'HOTEL' }: { current: BookingStep; locale: Locale; product?: 'HOTEL' | 'FLIGHT' }) {
  const t = dict(locale).steps;
  const at = STEPS.indexOf(current);
  return (
    <ol className="steps" aria-label={t.label}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'current' : undefined} aria-current={i === at ? 'step' : undefined}>
          <span className="step-dot" aria-hidden="true">
            {i < at ? <Check strokeWidth={2.5} /> : i + 1}
          </span>
          <span className="step-name">{s === 'room' && product === 'FLIGHT' ? t.flight : t[s]}</span>
        </li>
      ))}
    </ol>
  );
}
