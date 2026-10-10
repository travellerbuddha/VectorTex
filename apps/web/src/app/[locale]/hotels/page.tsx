import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HotelListHub, hubMetadata } from '../../../components/hotels/HotelListPage';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string }> };

/** English hotel lists hub (ADR-0014); /tr uses /tr/oteller. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  return locale === 'en' ? hubMetadata('en') : {};
}

export default async function Page({ params }: Params) {
  const { locale } = await params;
  if (locale !== 'en') notFound();
  return <HotelListHub locale="en" />;
}
