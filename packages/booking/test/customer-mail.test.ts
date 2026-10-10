import { describe, expect, it } from 'vitest';
import { customerMail, mailMoney, type OrderView } from '../src/index';

/** Customer booking e-mails (P16): what each message says, in the customer's language, from the order view only. */
const view = (over: Partial<OrderView> = {}): OrderView => ({
  orderId: '3efbd73f-0000-4000-8000-000000000001',
  stage: 'CONFIRMED',
  paymentHoldMayExist: false,
  bookingReference: 'MOCK-BK-1',
  voucherReady: true,
  payBy: null,
  quote: {
    quoteVersionId: 'q',
    expiresAt: '2027-05-01T10:20:00Z',
    hotel: { hotelId: 'H1', name: 'Otel <Deniz> & Spa', address: 'Kemer, Antalya', photo: null },
    room: { name: 'Deluxe Oda', boardType: 'AI', boardName: 'All inclusive' },
    checkin: '2027-06-10',
    checkout: '2027-06-13',
    nights: 3,
    rooms: [{ occupancyNumber: 1, adults: 2, childAges: [] }],
    total: { currency: 'EUR', minor: '123456' },
    payAtProperty: [{ currency: 'EUR', minor: '1200' }],
    cancellation: { refundable: true, freeUntil: '2027-06-01T20:59:59.000Z', steps: [] },
    termsVersion: 't',
    paymentProvider: 'NUITEE',
  },
  ...over,
});
const ctx = { brand: 'TexHoliday', publicBaseUrl: 'https://www.example.test/' };
const tr = { email: 'ayse@example.test', locale: 'tr' as const, firstName: 'Ayşe' };
const en = { email: 'john@example.test', locale: 'en' as const, firstName: null };

describe('customer booking e-mails', () => {
  it('formats money exactly from minor units in the customer language', () => {
    expect(mailMoney({ currency: 'EUR', minor: '123456' }, 'tr')).toBe('€1.234,56');
    expect(mailMoney({ currency: 'EUR', minor: '123456' }, 'en')).toBe('€1,234.56');
    expect(mailMoney({ currency: 'JPY', minor: '1500' }, 'en')).toBe('JP¥1,500');
  });

  it('confirmation: hotel, dates, booking number, amount paid, pay-at-property, free cancellation, order link', () => {
    const m = customerMail('BOOKING_CONFIRMED', view(), tr, ctx);
    expect(m.to).toBe('ayse@example.test');
    expect(m.subject).toBe('TexHoliday – Rezervasyonunuz onaylandı: Otel <Deniz> & Spa');
    expect(m.text).toContain('Merhaba Ayşe,');
    expect(m.text).toContain('Rezervasyon numarası: MOCK-BK-1');
    expect(m.text).toContain('Ödenen tutar: €1.234,56');
    expect(m.text).toContain('Otelde ayrıca ödenecek: €12,00');
    expect(m.text).toContain('10 Haziran 2027');
    expect(m.text).toContain('(3 gece)');
    expect(m.text).toMatch(/Ücretsiz iptal: 1 Haziran 2027 23:59 GMT\+3 tarihine kadar/);
    expect(m.text).toContain('https://www.example.test/tr/orders/3efbd73f-0000-4000-8000-000000000001');
    // Provider content is escaped in HTML, never interpreted.
    expect(m.html).toContain('Otel &lt;Deniz&gt; &amp; Spa');
    expect(m.html).not.toContain('<Deniz>');
  });

  it('English, no name, non-refundable rate', () => {
    const m = customerMail('BOOKING_CONFIRMED', view({ quote: { ...view().quote, cancellation: { refundable: false, freeUntil: null, steps: [] }, payAtProperty: [] } }), en, ctx);
    expect(m.subject).toBe('TexHoliday – Your booking is confirmed: Otel <Deniz> & Spa');
    expect(m.text.startsWith('Hello,')).toBe(true);
    expect(m.text).toContain('Non-refundable rate');
    expect(m.text).not.toContain('To pay at the property');
    expect(m.text).toContain('https://www.example.test/en/orders/');
  });

  it('cancellation promises a refund mail only when a refund is expected; refund mail states the recorded amount', () => {
    expect(customerMail('BOOKING_CANCELLED', view({ stage: 'CANCELLED', bookingReference: null }), tr, ctx, { refundExpected: true }).text).toContain('iadesi işleme alındığında size ayrıca e-posta');
    const noRefund = customerMail('BOOKING_CANCELLED', view({ stage: 'CANCELLED', bookingReference: null }), tr, ctx, { refundExpected: false });
    expect(noRefund.text).toContain('bu iptalde iade yapılmıyor');
    expect(noRefund.text).not.toContain('Ödenen tutar');
    expect(customerMail('REFUND_RECORDED', view({ stage: 'CANCELLED' }), en, ctx, { refund: { currency: 'EUR', minor: '50000' } }).text).toContain('Your refund of €500.00 was processed');
  });

  it('paid but not booked: the same payment-hold wording as the site', () => {
    const m = customerMail('PAYMENT_NOT_BOOKED', view({ stage: 'FAILED', bookingReference: null }), tr, ctx);
    expect(m.subject).toContain('Rezervasyonunuz tamamlanamadı');
    expect(m.text).toContain('Nuitee bunu 1–2 iş günü içinde kaldırır');
  });
});
