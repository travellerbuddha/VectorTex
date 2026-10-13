'use client';

import { useParams } from 'next/navigation';
import { dict, isLocale } from '../../../../../../i18n/dictionaries';

/**
 * Shown at once while a hotel of the search opens: the page's own frame in grey (title, photos, rooms), so nothing
 * jumps when the rooms arrive. No fake names or prices.
 */
export default function Loading() {
  const locale = useParams<{ locale?: string }>()?.locale;
  const t = dict(locale && isLocale(locale) ? locale : 'tr');
  return (
    <div className="page hotel-page search-hotel is-loading" aria-busy="true">
      <div className="refine skeleton-bar" aria-hidden="true" />
      <div className="hotel-title" aria-hidden="true">
        <div>
          <span className="sk sk-heading" />
          <span className="sk sk-line" />
        </div>
      </div>
      <div className="hotel-art-hero sk" aria-hidden="true" />
      <section className="rooms">
        <p className="muted" role="status">
          {t.results.hotelLoading}
        </p>
        <div className="room-list" aria-hidden="true">
          <span className="sk sk-row" />
          <span className="sk sk-row" />
        </div>
      </section>
    </div>
  );
}
