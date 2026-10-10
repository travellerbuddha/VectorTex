import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HotelPage, hotelMetadata } from '../../../../components/hotels/HotelPage';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

/** English hotel page (ADR-0014): /en/hotel/{name}-{hotel code}. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  return locale === 'en' ? hotelMetadata('en', slug) : {};
}

export default async function Page({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  if (locale !== 'en') notFound();
  return <HotelPage locale="en" slug={slug} searchParams={await searchParams} />;
}
