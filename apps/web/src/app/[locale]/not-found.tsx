'use client';

import { useParams } from 'next/navigation';
import { dict, isLocale } from '../../i18n/dictionaries';
import { HotelArt } from '../../components/ui/Art';

/**
 * 404 inside the site layout (T33): the page keeps the site's language, header and footer instead of Next's bare error
 * document. Not-found pages get no props, so the language comes from the URL.
 */
export default function NotFound() {
  const params = useParams<{ locale?: string }>();
  const locale = params?.locale && isLocale(params.locale) ? params.locale : 'tr';
  const t = dict(locale).notFound;
  return (
    <div className="page not-found">
      <HotelArt seed="sayfa-bulunamadi" className="not-found-art" />
      <h1>{t.title}</h1>
      <p>{t.text}</p>
      <p>
        <a className="secondary" href={`/${locale}`}>
          {t.home}
        </a>
      </p>
    </div>
  );
}
