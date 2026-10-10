import type { Locale } from './dictionaries';

const intlLocale = (l: Locale) => (l === 'tr' ? 'tr-TR' : 'en-GB');
const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3 };

/** Formats minor units exactly (string decimal, no float). */
export function formatMoney(m: { currency: string; minor: string }, locale: Locale): string {
  const exp = EXPONENT[m.currency] ?? 2;
  const neg = m.minor.startsWith('-');
  const digits = (neg ? m.minor.slice(1) : m.minor).padStart(exp + 1, '0');
  const major = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  const nf = new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: m.currency, minimumFractionDigits: exp, maximumFractionDigits: exp });
  return nf.format(`${neg ? '-' : ''}${major}` as unknown as number);
}

/** Calendar dates (YYYY-MM-DD) are shown as dates, never shifted by time zones. */
export function formatDate(isoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** Instants (deadlines) in Turkey time with the zone shown. */
export function formatInstant(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul', timeZoneName: 'short' }).format(new Date(iso));
}

const BOARD: Record<string, { tr: string; en: string }> = {
  RO: { tr: 'Sadece oda', en: 'Room only' },
  BB: { tr: 'Oda + kahvaltı', en: 'Bed & breakfast' },
  BI: { tr: 'Kahvaltı dahil', en: 'Breakfast included' },
  HB: { tr: 'Yarım pansiyon', en: 'Half board' },
  FB: { tr: 'Tam pansiyon', en: 'Full board' },
  AI: { tr: 'Her şey dahil', en: 'All inclusive' },
};

export function boardLabel(boardType: string | null, boardName: string | null, locale: Locale): string | null {
  if (boardType && BOARD[boardType]) return BOARD[boardType]![locale];
  return boardName;
}

/** Airport-local date-time as the airline publishes it ("2027-06-10T08:30:00"): shown as is, never converted. */
export function formatLocalTime(local: string): string {
  return local.split('T')[1]?.slice(0, 5) ?? '';
}

export function formatLocalDate(local: string, locale: Locale): string {
  return formatDate(local.split('T')[0]!, locale);
}

export function formatDuration(minutes: number, locale: Locale): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return locale === 'tr' ? `${h} sa ${m} dk` : `${h}h ${m}m`;
}
