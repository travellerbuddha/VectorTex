import { notFound } from 'next/navigation';
import { SearchForm } from '../../components/SearchForm';
import { countryOptions } from '../../i18n/countries';
import { dict, isLocale } from '../../i18n/dictionaries';
import { booking } from '../../server/booking';

export const dynamic = 'force-dynamic';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Pages render alongside the layout, so they check the locale themselves (e.g. /favicon.ico is not a locale).
  if (!isLocale(locale)) notFound();
  const { app } = await booking();
  const currencies = await app.availableCurrencies();
  return (
    <div className="page">
      <h1>{dict(locale).search.title}</h1>
      <SearchForm locale={locale} currencies={currencies} countries={countryOptions(locale)} today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
