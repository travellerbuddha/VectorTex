/**
 * The visitor's sale currency, chosen in the header next to the language and used by every hotel search. Kept in a
 * cookie (not personal data, no consent needed) so it survives the language switch and page loads.
 */
const COOKIE = 'th_currency';
const EVENT = 'th-currency';

/** The saved currency when it is still on sale, else null. */
export function savedCurrency(onSale: readonly string[]): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)th_currency=([A-Z]{3})(?:;|$)/);
  return m && onSale.includes(m[1]!) ? m[1]! : null;
}

export function saveCurrency(code: string) {
  document.cookie = `${COOKIE}=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  window.dispatchEvent(new Event(EVENT));
}

export function onCurrencyChange(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
