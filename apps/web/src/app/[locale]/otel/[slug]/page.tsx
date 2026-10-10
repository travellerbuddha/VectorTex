import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HotelPage, hotelMetadata } from '../../../../components/hotels/HotelPage';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

/** Turkish hotel page (ADR-0014): /tr/otel/{name}-{hotel code}. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  return locale === 'tr' ? hotelMetadata('tr', slug) : {};
}

export default async function Page({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  if (locale !== 'tr') notFound();
  return <HotelPage locale="tr" slug={slug} searchParams={await searchParams} />;
}
