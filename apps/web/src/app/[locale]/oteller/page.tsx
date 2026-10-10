import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HotelListHub, hubMetadata } from '../../../components/hotels/HotelListPage';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string }> };

/** Turkish hotel lists hub (ADR-0014); /en uses /en/hotels. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  return locale === 'tr' ? hubMetadata('tr') : {};
}

export default async function Page({ params }: Params) {
  const { locale } = await params;
  if (locale !== 'tr') notFound();
  return <HotelListHub locale="tr" />;
}
