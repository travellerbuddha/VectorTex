import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FaqPage, faqMetadata } from '../../../components/content/GuidePages';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ locale: string }> };

/** Frequently asked questions in this language (P06); /en uses /en/faq. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  return locale === 'tr' ? faqMetadata('tr') : {};
}

export default async function Page({ params }: Params) {
  const { locale } = await params;
  if (locale !== 'tr') notFound();
  return <FaqPage locale="tr" />;
}
