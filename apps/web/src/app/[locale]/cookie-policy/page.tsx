import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CookiePolicyPage, cookiePolicyMetadata } from '../../../components/tracking/CookiePolicyPage';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return (await params).locale === 'en' ? cookiePolicyMetadata('en') : {};
}

/** Cookie policy in this language (ADR-0018). */
export default async function Page({ params }: Props) {
  if ((await params).locale !== 'en') notFound();
  return <CookiePolicyPage locale="en" />;
}
