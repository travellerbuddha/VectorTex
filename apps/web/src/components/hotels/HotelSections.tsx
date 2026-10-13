import type { HotelContent } from '@texholiday/contracts';
import { Check, Clock, MapPin } from 'lucide-react';
import { dict, type Locale } from '../../i18n/dictionaries';
import { HotelArt } from '../ui/Art';
import { RatingBadge, Stars } from '../ui/HotelBits';

/**
 * The parts of a hotel page shared by the public hotel page (/otel/…) and the hotel page of a search: the title with
 * stars, address and guest rating, the photo mosaic, and the hotel's own text (description, facilities, times,
 * important information, nearby places). Content is the provider's; nothing here is ours or invented.
 */
const nf = (locale: Locale, n: number) => n.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB');

export function HotelTitle({
  name,
  stars,
  address,
  rating,
  reviews,
  locale,
  children,
}: {
  name: string;
  stars: number | null;
  address: string | null;
  rating: number | null;
  reviews: number | null;
  locale: Locale;
  children?: React.ReactNode;
}) {
  const t = dict(locale);
  return (
    <header className="hotel-title">
      <div>
        <h1>{name}</h1>
        <p className="hotel-meta">
          <Stars stars={stars} locale={locale} />
          {address && (
            <span className="hotel-where">
              <MapPin />
              {address}
            </span>
          )}
        </p>
        {children}
      </div>
      {rating !== null && rating > 0 && (
        <div className="hotel-rating">
          <RatingBadge rating={rating} reviews={reviews} locale={locale} />
          <p className="muted small">{reviews !== null && reviews > 0 ? t.lists.rating(nf(locale, rating), nf(locale, reviews)) : t.results.ratingSource}</p>
        </div>
      )}
    </header>
  );
}

/** Photos shown in the mosaic: 1, 2, 3 or 5 (a layout without holes). */
const galleryCount = (n: number) => (n >= 5 ? 5 : n >= 3 ? 3 : n);

/** The photo mosaic; the hotel's postcard in the same frame when there is no photo. The first photo carries the card's. */
export function HotelGallery({ images, name, seed, transition }: { images: ReadonlyArray<{ url: string; caption: string | null }>; name: string; seed: string; transition: React.CSSProperties }) {
  if (images.length === 0) {
    return (
      <div className="hotel-art-hero" style={transition}>
        <HotelArt seed={seed} />
      </div>
    );
  }
  const n = galleryCount(images.length);
  return (
    <ul className={`gallery gallery-${n}`} aria-label={name}>
      {images.slice(0, n).map((img, i) => (
        <li key={img.url} style={i === 0 ? transition : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- provider images are https-only; no host allow-list */}
          <img src={img.url} alt={img.caption ?? name} loading={i === 0 ? 'eager' : 'lazy'} />
        </li>
      ))}
    </ul>
  );
}

/** The hotel's own text, each part only when the provider has it. */
export function HotelDetails({ content: c, locale }: { content: HotelContent; locale: Locale }) {
  const t = dict(locale).lists;
  return (
    <>
      {c.description && (
        <section className="hotel-text hotel-section">
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
        <section className="hotel-section">
          <h2>{t.facilities}</h2>
          <ul className="amenities">
            {c.facilities.map((f) => (
              <li key={f}>
                <Check aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
        </section>
      )}
      {(c.checkinTime || c.checkoutTime) && (
        <section className="hotel-section">
          <h2>{t.times}</h2>
          <p className="voucher-line">
            <Clock />
            {c.checkinTime && `${t.checkin}: ${c.checkinTime}`}
            {c.checkinTime && c.checkoutTime && ' · '}
            {c.checkoutTime && `${t.checkout}: ${c.checkoutTime}`}
          </p>
        </section>
      )}
      {c.importantInformation && (
        <section className="hotel-section">
          <h2>{t.important}</h2>
          {c.importantInformation.split('\n\n').map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}
      {c.nearby.length > 0 && (
        <section className="hotel-section">
          <h2>{t.nearby}</h2>
          <ul className="nearby">
            {c.nearby.map((n) => (
              <li key={n.name}>
                {n.name}
                {n.distanceKm !== null ? ` · ${t.km(nf(locale, n.distanceKm))}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
