import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccountPage, accountMetadata } from '../../../components/account/AccountPage';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ durum?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return locale === 'en' ? accountMetadata('en') : {};
}

/** The customer's bookings in this language (ADR-0017). */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  if (locale !== 'en') notFound();
  return <AccountPage locale="en" state={(await searchParams).durum ?? null} />;
}
