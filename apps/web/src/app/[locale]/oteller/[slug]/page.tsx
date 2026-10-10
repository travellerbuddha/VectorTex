import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HotelListPage, hotelListMetadata } from '../../../../components/hotels/HotelListPage';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string; slug: string }> };

/** Turkish hotel list page (ADR-0014): /tr/oteller/{address}. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  return locale === 'tr' ? hotelListMetadata('tr', slug) : {};
}

export default async function Page({ params }: Params) {
  const { locale, slug } = await params;
  if (locale !== 'tr') notFound();
  return <HotelListPage locale="tr" slug={slug} />;
}
