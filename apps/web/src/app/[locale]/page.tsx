import { SearchForm } from '../../components/SearchForm';
import { dict, type Locale } from '../../i18n/dictionaries';
import { booking } from '../../server/booking';

export const dynamic = 'force-dynamic';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const { app } = await booking();
  const currencies = await app.availableCurrencies();
  return (
    <div className="page">
      <h1>{dict(locale).search.title}</h1>
      <SearchForm locale={locale} currencies={currencies} />
    </div>
  );
}
