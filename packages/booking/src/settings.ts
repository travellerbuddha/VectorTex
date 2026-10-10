import type { ProviderEnvironment } from '@texholiday/contracts';

/**
 * Technical settings of the booking application. Business values (margins, fees, risk limits) are never here: they
 * come from the approved, user-edited policies (G06).
 */
export interface BookingSettings {
  environment: ProviderEnvironment;
  /** Which business-edited policy set this deployment uses (e.g. the B2C channel). */
  policyId: string;
  /** How long a search result may be turned into a quote. */
  searchTtlSeconds: number;
  /** How long an offered price is held for checkout before it must be revalidated. */
  quoteTtlSeconds: number;
  /** Provider-managed checkout: after this many seconds an unpaid checkout is abandoned. */
  payBySeconds: number;
  /** Version of the sales terms the customer accepts (legal text published on the site). */
  termsVersion: string;
  /** Secret for order access tokens (HMAC); at least 32 characters. */
  accessTokenSecret: string;
  /** Currencies offered to the customer; provider-managed sales charge in the searched currency. */
  currencies: readonly string[];
  maxHotels: number;
  maxRatesPerHotel: number;
  intentLeaseSeconds: number;
  maxAutomaticLookups: number;
  /**
   * Public prices never undercut the hotel's suggested selling price (rate parity, revenue guide). Only a SANDBOX
   * deployment may switch this off: sandbox suggested prices are synthetic and always above the price (2026-10-09:
   * net x 1.163 up to a 16% margin, price x (1 + margin) from 20%), so nothing could be shown or tested there.
   */
  enforceRateParity: boolean;
  /** Flights: point of sale sent with searches (ISO 3166-1 alpha-2); null = the provider's default. */
  flightPointOfSale?: string | null;
  /** Flights: offers kept per search, cheapest first (default 50). */
  maxFlightOffers?: number;
}

export function bookingSettingsFromEnv(env: Record<string, string | undefined>, environment: ProviderEnvironment, policyId: string): BookingSettings {
  const int = (name: string, fallback: number, min = 1) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
    return n;
  };
  const secret = env.ORDER_ACCESS_SECRET ?? '';
  if (secret.length < 32) throw new Error('ORDER_ACCESS_SECRET must be set (at least 32 characters)');
  const terms = env.TERMS_VERSION ?? '';
  if (!/^[\w.-]{1,40}$/.test(terms)) throw new Error('TERMS_VERSION must name the published sales terms version');
  const skipParity = env.SANDBOX_SKIP_RATE_PARITY ?? '';
  if (skipParity !== '' && skipParity !== 'true' && skipParity !== 'false') throw new Error('SANDBOX_SKIP_RATE_PARITY must be true or false');
  if (skipParity === 'true' && environment !== 'sandbox') throw new Error('SANDBOX_SKIP_RATE_PARITY is only allowed with PROVIDER_ENV=sandbox');
  const pos = (env.FLIGHT_POINT_OF_SALE ?? '').trim().toUpperCase();
  if (pos !== '' && !/^[A-Z]{2}$/.test(pos)) throw new Error('FLIGHT_POINT_OF_SALE must be an ISO 3166-1 alpha-2 country code');
  const currencies = (env.SALE_CURRENCIES ?? 'EUR,USD,GBP,TRY').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  return {
    environment,
    policyId,
    searchTtlSeconds: int('SEARCH_TTL_SECONDS', 1800),
    quoteTtlSeconds: int('QUOTE_TTL_SECONDS', 1200),
    payBySeconds: int('PAY_BY_SECONDS', 1800),
    termsVersion: terms,
    accessTokenSecret: secret,
    currencies,
    maxHotels: int('SEARCH_MAX_HOTELS', 60),
    maxRatesPerHotel: int('SEARCH_MAX_RATES_PER_HOTEL', 8),
    // Must exceed the provider's longest documented booking call (~2 minutes) plus our HTTP margin.
    intentLeaseSeconds: int('INTENT_LEASE_SECONDS', 600),
    maxAutomaticLookups: int('MAX_AUTOMATIC_LOOKUPS', 6),
    enforceRateParity: skipParity !== 'true',
    flightPointOfSale: pos === '' ? null : pos,
    maxFlightOffers: int('SEARCH_MAX_FLIGHT_OFFERS', 50),
  };
}
