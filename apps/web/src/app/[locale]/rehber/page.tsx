import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuideHub, guideHubMetadata, pageNumber } from '../../../components/content/GuidePages';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ sayfa?: string }> };

/** Guide articles hub in this language (P06); /en uses /en/guides. */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  return locale === 'tr' ? guideHubMetadata('tr', pageNumber((await searchParams).sayfa)) : {};
}

export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  if (locale !== 'tr') notFound();
  return <GuideHub locale="tr" page={pageNumber((await searchParams).sayfa)} />;
}
