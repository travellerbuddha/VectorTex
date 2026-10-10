import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuidePage, guideMetadata } from '../../../../components/content/GuidePages';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  return locale === 'tr' ? guideMetadata('tr', slug) : {};
}

/** A guide article in this language (P06); /en uses /en/guides. */
export default async function Page({ params }: Params) {
  const { locale, slug } = await params;
  if (locale !== 'tr') notFound();
  return <GuidePage locale="tr" slug={slug} />;
}
