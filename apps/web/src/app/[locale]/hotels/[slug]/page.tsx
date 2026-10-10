import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HotelListPage, hotelListMetadata } from '../../../../components/hotels/HotelListPage';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string; slug: string }> };

/** English hotel list page (ADR-0014): /en/hotels/{address}. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  return locale === 'en' ? hotelListMetadata('en', slug) : {};
}

export default async function Page({ params }: Params) {
  const { locale, slug } = await params;
  if (locale !== 'en') notFound();
  return <HotelListPage locale="en" slug={slug} />;
}
