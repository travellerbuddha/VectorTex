import { isDomainError } from '@texholiday/contracts';
import { notFound } from 'next/navigation';
import { OrderStatus } from '../../../../../components/OrderStatus';
import { QuoteSummary } from '../../../../../components/QuoteSummary';
import { dict, type Locale } from '../../../../../i18n/dictionaries';
import { booking } from '../../../../../server/booking';
import { orderToken } from '../../../../../server/http';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

/** Return from the payment component. Query parameters added by the provider are ignored (§5.1). */
export default async function PaymentReturn({ params }: { params: Promise<{ locale: string; orderId: string }> }) {
  const { locale: l, orderId } = await params;
  const locale = l as Locale;
  const { app } = await booking();
  let order;
  try {
    order = await app.finalize(orderId, await orderToken(orderId));
  } catch (err) {
    if (isDomainError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  return (
    <div className="page order">
      <h1>{dict(locale).order.title}</h1>
      <div className="two-col">
        <OrderStatus locale={locale} initial={order} finalizeWhileOpen />
        <QuoteSummary quote={order.quote} locale={locale} />
      </div>
    </div>
  );
}
