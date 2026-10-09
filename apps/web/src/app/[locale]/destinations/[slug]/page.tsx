import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SearchForm } from '../../../../components/SearchForm';
import { cmsMetadata, PreviewBanner } from '../../../../components/cms/CmsPage';
import { RichText } from '../../../../components/cms/RichText';
import { countryOptions } from '../../../../i18n/countries';
import { isLocale, type Locale } from '../../../../i18n/dictionaries';
import { booking } from '../../../../server/booking';
import { loadBySlug } from '../../../../server/cms-content';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ locale: string; slug: string }> };
const path = (l: Locale, slug: string) => `/${l}/destinations/${slug}`;
type Media = { url?: string | null; alt?: string | null; width?: number | null; height?: number | null } | null | undefined | number | string;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const loaded = await loadBySlug('destinations', slug, locale);
  return loaded ? cmsMetadata(loaded, locale, path, { title: String(loaded.doc.name ?? ''), description: (loaded.doc.summary as string | null) ?? null }) : {};
}

/** A destination page (P06) with the hotel search prefilled when the editor set a search place. */
export default async function DestinationPage({ params }: Params) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const loaded = await loadBySlug('destinations', slug, locale);
  if (!loaded) notFound();
  const d = loaded.doc;
  const name = String(d.name ?? '');
  const image = d.heroImage as Media;
  const currencies = await (await booking()).app.availableCurrencies();
  const placeId = typeof d.searchPlaceId === 'string' && d.searchPlaceId ? d.searchPlaceId : null;
  return (
    <div className="page cms-page">
      {loaded.preview && <PreviewBanner locale={locale} />}
      <section className="cms-hero">
        {image && typeof image === 'object' && image.url && (
          // eslint-disable-next-line @next/next/no-img-element -- CMS image with its stored size
          <img src={image.url} alt={image.alt ?? ''} width={image.width ?? undefined} height={image.height ?? undefined} className="cms-hero-image" />
        )}
        <div className="cms-hero-text">
          <h1>{name}</h1>
          {typeof d.summary === 'string' && d.summary && <p>{d.summary}</p>}
        </div>
        <SearchForm
          locale={locale}
          currencies={currencies}
          countries={countryOptions(locale)}
          today={new Date().toISOString().slice(0, 10)}
          initial={placeId ? { place: { placeId, name, address: '' } } : undefined}
        />
      </section>
      <section className="cms-text">
        <RichText data={d.body} />
      </section>
    </div>
  );
}
