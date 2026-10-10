import { Check, Star } from 'lucide-react';
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

/** The hotel's photo, or its postcard when the provider has none. */
export function HotelMedia({ hotelId, photo, className, eager = false }: { hotelId: string; photo: string | null; className?: string; eager?: boolean }) {
  return (
    <div className={`hotel-media${className ? ` ${className}` : ''}`}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider images are https-only; no host allow-list
        <img src={photo} alt="" loading={eager ? 'eager' : 'lazy'} className="hotel-photo" />
      ) : (
        <HotelArt seed={hotelId} className="hotel-art" />
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
      <div className="postcard-media">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- CMS image
          <img src={image.url} alt="" loading="lazy" />
        ) : (
          <HotelArt seed={seed} />
        )}
      </div>
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
