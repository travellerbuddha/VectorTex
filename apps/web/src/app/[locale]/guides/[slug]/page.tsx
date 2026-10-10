import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuidePage, guideMetadata } from '../../../../components/content/GuidePages';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  return locale === 'en' ? guideMetadata('en', slug) : {};
}

/** A guide article in this language (P06); /tr uses /tr/rehber. */
export default async function Page({ params }: Params) {
  const { locale, slug } = await params;
  if (locale !== 'en') notFound();
  return <GuidePage locale="en" slug={slug} />;
}
