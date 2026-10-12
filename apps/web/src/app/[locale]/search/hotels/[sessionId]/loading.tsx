'use client';

import { useParams } from 'next/navigation';
import { dict, isLocale } from '../../../../../i18n/dictionaries';

/**
 * Shown at once while the results load (the search runs on the server): the page's own frame, so nothing jumps when
 * the hotels arrive. Grey blocks only, no fake hotels or prices.
 */
export default function Loading() {
  // Loading UI receives no props; the locale comes from the route.
  const locale = useParams<{ locale?: string }>()?.locale;
  const t = dict(locale && isLocale(locale) ? locale : 'tr');
  return (
    <div className="page results is-loading" aria-busy="true">
      <div className="refine skeleton-bar" aria-hidden="true" />
      <div className="results-layout">
        <div className="filters skeleton-filters" aria-hidden="true" />
        <div className="results-main">
          <div className="results-head">
            <h1>{t.results.title}</h1>
            <p className="results-count" role="status">
              {t.results.loading}
            </p>
          </div>
          <ul className="hotels" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="hotel skeleton-hotel">
                <div className="hotel-media" />
                <div className="hotel-body">
                  <span className="sk sk-title" />
                  <span className="sk sk-line" />
                  <span className="sk sk-line short" />
                </div>
                <div className="offers">
                  <span className="sk sk-row" />
                  <span className="sk sk-row" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
