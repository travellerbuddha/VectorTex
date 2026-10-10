import type { MailMessage, Mailer } from '@texholiday/contracts';
import type { CustomerMailKind, MailRecipient, NotificationRepository } from '@texholiday/db';
import { fromJson, toMajor, type MoneyJson } from '@texholiday/pricing';
import type { FlightJourneyView, FlightQuoteView, OrderView, QuoteView } from './views';

/**
 * Customer booking e-mails (P16). Transactional only (no marketing), in the language the customer booked in, sent by the
 * worker from order events. They say only what the order record says: no promised refund amounts or dates the
 * provider has not confirmed (provider question 10a), and the payment-hold wording of the site (ADR-0008).
 */
export interface CustomerMailContext {
  brand: string;
  /** Site origin for the order link (PUBLIC_BASE_URL). */
  publicBaseUrl: string;
}

type Locale = 'tr' | 'en';
const intlLocale = (l: Locale) => (l === 'tr' ? 'tr-TR' : 'en-GB');

/** Exact decimal from minor units, formatted without a float. */
export function mailMoney(m: MoneyJson, l: Locale): string {
  const major = toMajor(fromJson(m));
  const digits = major.includes('.') ? major.split('.')[1]!.length : 0;
  return new Intl.NumberFormat(intlLocale(l), { style: 'currency', currency: m.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(major as unknown as number);
}

const mailDate = (isoDate: string, l: Locale) =>
  new Intl.DateTimeFormat(intlLocale(l), { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${isoDate}T00:00:00Z`));
const mailInstant = (iso: string, l: Locale) =>
  new Intl.DateTimeFormat(intlLocale(l), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul', timeZoneName: 'short' }).format(new Date(iso));

/** Airport-local date-time as published ("2027-06-10T08:30:00"), formatted without converting time zones. */
const mailLocal = (local: string, l: Locale) => {
  const [date, time] = local.split('T');
  const day = new Intl.DateTimeFormat(intlLocale(l), { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  return time ? `${day} ${time.slice(0, 5)}` : day;
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const T = {
  tr: {
    hello: (name: string | null) => (name ? `Merhaba ${name},` : 'Merhaba,'),
    subject: {
      BOOKING_CONFIRMED: (hotel: string) => `Rezervasyonunuz onaylandı: ${hotel}`,
      BOOKING_CANCELLED: (hotel: string) => `Rezervasyonunuz iptal edildi: ${hotel}`,
      REFUND_RECORDED: (hotel: string) => `İadeniz işleme alındı: ${hotel}`,
      PAYMENT_NOT_BOOKED: (hotel: string) => `Rezervasyonunuz tamamlanamadı: ${hotel}`,
    },
    lead: {
      BOOKING_CONFIRMED: 'Rezervasyonunuz onaylandı. Bilgiler aşağıda.',
      BOOKING_CANCELLED: 'Rezervasyonunuz iptal edildi. Ödemenizin iadesi işleme alındığında size ayrıca e-posta göndereceğiz.',
      BOOKING_CANCELLED_NO_REFUND: 'Rezervasyonunuz iptal edildi. Tarife koşulları gereği bu iptalde iade yapılmıyor.',
      REFUND_RECORDED: (amount: string) => `${amount} tutarındaki iadeniz ödeme sağlayıcısı tarafından işleme alındı. Kartınıza yansıması bankanıza bağlı olarak zaman alabilir.`,
      PAYMENT_NOT_BOOKED: 'Rezervasyonunuzu tamamlayamadık. Kartınızda bir ödeme provizyonu görünürse, Nuitee bunu 1–2 iş günü içinde kaldırır. Sorunuz olursa bizimle iletişime geçin.',
    },
    flightLead: { BOOKING_CONFIRMED: 'Biletiniz düzenlendi. Uçuş bilgileri aşağıda.' },
    flightSupport:
      'Uçuşunuzdaki değişiklik ve iptal işlemlerini uçuş hizmet ortağımız Nuitée yürütür ve size bu e-posta adresinden doğrudan ulaşır. İsteğiniz üzerine yapılan bir değişiklik veya iptal için Nuitée, havayolu ücretlerine ek olarak 25 USD hizmet bedelini kartınızdan tahsil eder.',
    flight: 'Uçuş',
    outbound: 'Gidiş',
    inbound: 'Dönüş',
    direct: 'aktarmasız',
    connections: (n: number) => `${n} aktarma`,
    passengers: 'Yolcular',
    pax: { ADULT: (n: number) => `${n} yetişkin`, CHILD: (n: number) => `${n} çocuk`, INFANT: (n: number) => `${n} bebek` },
    pnr: 'Havayolu rezervasyon kodu (PNR)',
    tickets: 'Bilet numarası',
    refundableFlight: (fee: boolean) => (fee ? 'İade edilebilir bilet (iade ücreti uygulanır)' : 'İade edilebilir bilet'),
    nonRefundableFlight: 'İade edilemez bilet',
    hotel: 'Otel',
    dates: 'Tarihler',
    nights: (n: number) => `${n} gece`,
    room: 'Oda',
    total: 'Ödenen tutar',
    payAtProperty: 'Otelde ayrıca ödenecek',
    reference: 'Rezervasyon numarası',
    freeUntil: (at: string) => `Ücretsiz iptal: ${at} tarihine kadar`,
    nonRefundable: 'İade edilemez tarife',
    link: 'Rezervasyon sayfası (rezervasyonu yaptığınız tarayıcıda açılır)',
    footer: (brand: string) => `Bu e-posta ${brand} üzerinden yaptığınız rezervasyon için gönderildi.`,
  },
  en: {
    hello: (name: string | null) => (name ? `Hello ${name},` : 'Hello,'),
    subject: {
      BOOKING_CONFIRMED: (hotel: string) => `Your booking is confirmed: ${hotel}`,
      BOOKING_CANCELLED: (hotel: string) => `Your booking was cancelled: ${hotel}`,
      REFUND_RECORDED: (hotel: string) => `Your refund is being processed: ${hotel}`,
      PAYMENT_NOT_BOOKED: (hotel: string) => `We could not complete your booking: ${hotel}`,
    },
    lead: {
      BOOKING_CONFIRMED: 'Your booking is confirmed. The details are below.',
      BOOKING_CANCELLED: 'Your booking was cancelled. We will e-mail you again when the refund of your payment is processed.',
      BOOKING_CANCELLED_NO_REFUND: 'Your booking was cancelled. Under the rate conditions, this cancellation is not refunded.',
      REFUND_RECORDED: (amount: string) => `Your refund of ${amount} was processed by the payment provider. How long it takes to reach your card depends on your bank.`,
      PAYMENT_NOT_BOOKED: 'We could not complete your booking. If you see a pending charge on your card, Nuitee releases it within 1–2 business days. Contact us with any questions.',
    },
    flightLead: { BOOKING_CONFIRMED: 'Your ticket is issued. Your flight details are below.' },
    flightSupport:
      'Changes and cancellations of your flight are handled by our flight servicing partner Nuitée, who contacts you directly at this e-mail address. For a change or cancellation you ask for, Nuitée charges a USD 25 service fee to your card in addition to the airline fees.',
    flight: 'Flight',
    outbound: 'Outbound',
    inbound: 'Return',
    direct: 'non-stop',
    connections: (n: number) => `${n} connection${n === 1 ? '' : 's'}`,
    passengers: 'Passengers',
    pax: { ADULT: (n: number) => `${n} adult${n === 1 ? '' : 's'}`, CHILD: (n: number) => `${n} child${n === 1 ? '' : 'ren'}`, INFANT: (n: number) => `${n} infant${n === 1 ? '' : 's'}` },
    pnr: 'Airline booking code (PNR)',
    tickets: 'Ticket number',
    refundableFlight: (fee: boolean) => (fee ? 'Refundable ticket (a refund fee applies)' : 'Refundable ticket'),
    nonRefundableFlight: 'Non-refundable ticket',
    hotel: 'Hotel',
    dates: 'Dates',
    nights: (n: number) => `${n} night${n === 1 ? '' : 's'}`,
    room: 'Room',
    total: 'Amount paid',
    payAtProperty: 'To pay at the property',
    reference: 'Booking number',
    freeUntil: (at: string) => `Free cancellation until ${at}`,
    nonRefundable: 'Non-refundable rate',
    link: 'Booking page (opens in the browser you booked with)',
    footer: (brand: string) => `This e-mail was sent for a booking you made with ${brand}.`,
  },
} as const;

type Texts = (typeof T)[Locale];

function hotelFacts(kind: CustomerMailKind, view: OrderView, q: QuoteView, t: Texts, l: Locale): Array<[string, string]> {
  const rows: Array<[string, string]> = [[t.hotel, [q.hotel.name, q.hotel.address].filter(Boolean).join(', ')]];
  rows.push([t.dates, `${mailDate(q.checkin, l)} – ${mailDate(q.checkout, l)} (${t.nights(q.nights)})`]);
  if (q.room.name) rows.push([t.room, q.room.name]);
  if (kind === 'BOOKING_CONFIRMED') {
    if (view.bookingReference) rows.push([t.reference, view.bookingReference]);
    rows.push([t.total, mailMoney(q.total, l)]);
    if (q.payAtProperty.length > 0) rows.push([t.payAtProperty, q.payAtProperty.map((m) => mailMoney(m, l)).join(' + ')]);
    rows.push(['', q.cancellation.refundable && q.cancellation.freeUntil ? t.freeUntil(mailInstant(q.cancellation.freeUntil, l)) : q.cancellation.refundable ? '' : t.nonRefundable]);
  }
  return rows;
}

function journeyLine(j: FlightJourneyView, t: Texts, l: Locale): string {
  const first = j.segments[0];
  const flight = first ? [first.carrier.code, first.flightNumber].filter(Boolean).join(' ') : '';
  return `${mailLocal(j.departure.local, l)} ${j.departure.code} → ${j.arrival.code} ${j.arrival.local.split('T')[1]?.slice(0, 5) ?? ''} · ${flight} · ${j.connections === 0 ? t.direct : t.connections(j.connections)}`;
}

function flightFacts(kind: CustomerMailKind, view: OrderView, q: FlightQuoteView, t: Texts, l: Locale): Array<[string, string]> {
  const rows: Array<[string, string]> = [[t.flight, q.title]];
  for (const j of q.journeys) rows.push([j.direction === 'OUTBOUND' ? t.outbound : t.inbound, journeyLine(j, t, l)]);
  const pax = [t.pax.ADULT(q.passengers.adults), q.passengers.childAges.length ? t.pax.CHILD(q.passengers.childAges.length) : '', q.passengers.infantAges.length ? t.pax.INFANT(q.passengers.infantAges.length) : ''];
  rows.push([t.passengers, pax.filter(Boolean).join(', ')]);
  if (kind === 'BOOKING_CONFIRMED') {
    if (view.bookingReference) rows.push([t.pnr, view.bookingReference]);
    if (view.ticketNumbers.length > 0) rows.push([t.tickets, view.ticketNumbers.join(', ')]);
    rows.push([t.total, mailMoney(q.total, l)]);
    rows.push(['', q.terms.refundable ? t.refundableFlight(q.terms.refundFee) : t.nonRefundableFlight]);
  }
  return rows;
}

/** The message for one event; plain text and HTML carry the same facts. */
export function customerMail(kind: CustomerMailKind, view: OrderView, to: MailRecipient, ctx: CustomerMailContext, extra: { refund?: MoneyJson; refundExpected?: boolean } = {}): MailMessage {
  const l: Locale = to.locale;
  const t = T[l];
  const q = view.quote;
  const flight = q.product === 'FLIGHT';
  const lead =
    kind === 'REFUND_RECORDED'
      ? t.lead.REFUND_RECORDED(extra.refund ? mailMoney(extra.refund, l) : '')
      : kind === 'BOOKING_CANCELLED' && extra.refundExpected === false
        ? t.lead.BOOKING_CANCELLED_NO_REFUND
        : flight && kind === 'BOOKING_CONFIRMED'
          ? t.flightLead.BOOKING_CONFIRMED
          : t.lead[kind];
  const facts = (q.product === 'FLIGHT' ? flightFacts(kind, view, q, t, l) : hotelFacts(kind, view, q, t, l)).filter(([, v]) => v !== '');
  // First Line support (ADR-0012): the traveller deals with Nuitée directly after booking.
  const note = flight && kind === 'BOOKING_CONFIRMED' ? t.flightSupport : null;
  const url = `${ctx.publicBaseUrl.replace(/\/$/, '')}/${l}/orders/${view.orderId}`;
  const text = [t.hello(to.firstName), '', lead, '', ...facts.map(([k, v]) => (k ? `${k}: ${v}` : v)), ...(note ? ['', note] : []), '', `${t.link}: ${url}`, '', t.footer(ctx.brand)].join('\n');
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a"><p>${escapeHtml(t.hello(to.firstName))}</p><p>${escapeHtml(lead)}</p><table cellpadding="4" style="border-collapse:collapse">${facts
    .map(([k, v]) => `<tr>${k ? `<th align="left" style="font-weight:600">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td>` : `<td colspan="2">${escapeHtml(v)}</td>`}</tr>`)
    .join('')}</table>${note ? `<p>${escapeHtml(note)}</p>` : ''}<p><a href="${escapeHtml(url)}">${escapeHtml(t.link)}</a></p><p style="color:#555;font-size:13px">${escapeHtml(t.footer(ctx.brand))}</p></body></html>`;
  return { to: to.email, subject: `${ctx.brand} – ${t.subject[kind](q.product === 'FLIGHT' ? q.title : q.hotel.name)}`, text, html };
}

const KIND_BY_EVENT: Record<string, CustomerMailKind> = {
  'order.confirmed': 'BOOKING_CONFIRMED',
  'order.cancelled': 'BOOKING_CANCELLED',
  'order.refund_recorded': 'REFUND_RECORDED',
  'order.provider_managed.failed': 'PAYMENT_NOT_BOOKED',
};

export const CUSTOMER_MAIL_EVENTS: readonly string[] = Object.keys(KIND_BY_EVENT);

/**
 * Sends the mail of an order event at most once per event (P16). Without mail settings the event is recorded as not
 * sent (visible in the order's audit log) instead of failing; a refused or lost send fails the event so the outbox
 * retries it. A crash between sending and recording can send one duplicate (at-least-once, ADR-0004).
 */
export class CustomerNotifier {
  constructor(
    private readonly deps: {
      notifications: NotificationRepository;
      orderView: (orderId: string) => Promise<OrderView>;
      mailer: Mailer | null;
      context: CustomerMailContext | null;
    },
  ) {}

  async handle(eventType: string, eventId: string, payload: Record<string, unknown>): Promise<'SENT' | 'NOT_CONFIGURED' | 'ALREADY_DONE' | 'NOT_APPLICABLE'> {
    const kind = KIND_BY_EVENT[eventType];
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : null;
    if (!kind || !orderId) return 'NOT_APPLICABLE';
    // A failed checkout without a possible card hold (e.g. the customer never paid) needs no mail.
    if (kind === 'PAYMENT_NOT_BOOKED' && payload.mayHoldPayment !== true) return 'NOT_APPLICABLE';
    if ((await this.deps.notifications.claim(eventId, orderId, kind)) === 'DONE') return 'ALREADY_DONE';
    if (!this.deps.mailer || !this.deps.context) {
      await this.deps.notifications.finish(eventId, orderId, kind, 'NOT_CONFIGURED');
      return 'NOT_CONFIGURED';
    }
    const to = await this.deps.notifications.recipient(orderId);
    if (!to) throw new Error(`order ${orderId} has no customer`);
    const refund = payload.amount as MoneyJson | undefined;
    const extra = {
      ...(refund && typeof refund.currency === 'string' && typeof refund.minor === 'string' ? { refund } : {}),
      ...(typeof payload.refundExpected === 'boolean' ? { refundExpected: payload.refundExpected } : {}),
    };
    const message = customerMail(kind, await this.deps.orderView(orderId), to, this.deps.context, extra);
    const result = await this.deps.mailer.send(message);
    if (!result.delivered) {
      await this.deps.notifications.failed(orderId, kind, result.reason);
      throw new Error(`customer mail not delivered (${kind}): ${result.reason}`);
    }
    await this.deps.notifications.finish(eventId, orderId, kind, 'SENT');
    return 'SENT';
  }
}
