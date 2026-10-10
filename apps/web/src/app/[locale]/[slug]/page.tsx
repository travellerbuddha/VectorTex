import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Blocks } from '../../../components/cms/Blocks';
import { cmsMetadata, PreviewBanner } from '../../../components/cms/CmsPage';
import { isLocale, type Locale } from '../../../i18n/dictionaries';
import { booking } from '../../../server/booking';
import { loadBySlug } from '../../../server/cms-content';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ locale: string; slug: string }> };
const path = (l: Locale, slug: string) => `/${l}/${slug}`;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const loaded = await loadBySlug('pages', slug, locale);
  return loaded ? cmsMetadata(loaded, locale, path, { title: String(loaded.doc.title ?? '') }) : {};
}

/** A CMS page (P06): approved blocks only; prices and availability come from the booking engine. */
export default async function CmsPageRoute({ params }: Params) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const loaded = await loadBySlug('pages', slug, locale);
  if (!loaded) notFound();
  const currencies = await (await booking()).app.availableCurrencies();
  return (
    <div className="page cms-page">
      {loaded.preview && <PreviewBanner locale={locale} />}
      {!(Array.isArray(loaded.doc.layout) && (loaded.doc.layout as Array<{ blockType?: string }>)[0]?.blockType === 'hero') && <h1>{String(loaded.doc.title ?? '')}</h1>}
      <Blocks blocks={loaded.doc.layout} ctx={{ locale, currencies, today: new Date().toISOString().slice(0, 10) }} />
    </div>
  );
}
