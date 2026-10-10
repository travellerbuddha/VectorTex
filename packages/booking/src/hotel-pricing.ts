import { createHash } from 'node:crypto';
import { NUITEE_HOTEL_TIMEOUTS } from '@texholiday/connectors';
import { CapabilityNotAvailableError, type CapabilityMatrix, type HotelOffer, type ProductType, type ProviderEnvironment, type SourceLock } from '@texholiday/contracts';
import type { PolicyRepository } from '@texholiday/db';
import { selectPaymentRoutes, type RouteOption } from '@texholiday/domain';
import { providerMarginForSearch, type PricingPolicyVersion } from '@texholiday/pricing';
import { priceHotelOffer, type HiddenOffers, type StoredOffer } from './hotel-offer-pricing';

const PROVIDER = 'nuitee';

/** The settings that decide a hotel customer price (shared by the search and the hotel list scanner, ADR-0014). */
export interface HotelPricingSettings {
  environment: ProviderEnvironment;
  policyId: string;
  currencies: readonly string[];
  maxRatesPerHotel: number;
  enforceRateParity: boolean;
}

export function hotelPricingSettingsFromEnv(env: Record<string, string | undefined>, environment: ProviderEnvironment, policyId: string): HotelPricingSettings {
  const raw = env.SEARCH_MAX_RATES_PER_HOTEL;
  const maxRatesPerHotel = raw === undefined || raw === '' ? 8 : Number(raw);
  if (!Number.isInteger(maxRatesPerHotel) || maxRatesPerHotel < 1) throw new Error('SEARCH_MAX_RATES_PER_HOTEL must be an integer >= 1');
  const skipParity = env.SANDBOX_SKIP_RATE_PARITY ?? '';
  if (skipParity !== '' && skipParity !== 'true' && skipParity !== 'false') throw new Error('SANDBOX_SKIP_RATE_PARITY must be true or false');
  if (skipParity === 'true' && environment !== 'sandbox') throw new Error('SANDBOX_SKIP_RATE_PARITY is only allowed with PROVIDER_ENV=sandbox');
  const currencies = (env.SALE_CURRENCIES ?? 'EUR,USD,GBP,TRY')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  return { environment, policyId, currencies, maxRatesPerHotel, enforceRateParity: skipParity !== 'true' };
}

/** The route is chosen on the server (§4.1). Only the provider-managed route exists until the own gateway is integrated. */
export async function providerManagedRoute(
  deps: { matrix: CapabilityMatrix; sourceLock: SourceLock; policies: PolicyRepository; settings: Pick<HotelPricingSettings, 'currencies' | 'environment' | 'policyId'> },
  currency: string,
  policy: PricingPolicyVersion,
  productType: ProductType,
): Promise<RouteOption> {
  const s = deps.settings;
  if (!s.currencies.includes(currency)) throw new CapabilityNotAvailableError(`Currency ${currency} is not offered`, [`currency ${currency} not offered`]);
  const decision = selectPaymentRoutes({
    items: [{ itemId: productType.toLowerCase(), productType, providerId: PROVIDER }],
    chargeCurrency: currency,
    environment: s.environment,
    matrix: deps.matrix,
    sourceLock: deps.sourceLock,
    gateways: [],
    pricingPolicy: policy,
    riskPolicy: await deps.policies.activeRisk(s.policyId),
  });
  if (!decision.available) throw new CapabilityNotAvailableError('No payment route for this currency', decision.reasons);
  const pm = [decision.defaultOption, ...decision.alternatives].find((o) => o.route.mode === 'PROVIDER_MANAGED');
  if (!pm) throw new CapabilityNotAvailableError('Only provider-managed payment is available', ['own gateway not integrated (ADR-0008)']);
  return pm;
}

/** Everything a hotel price in one currency depends on, resolved now. */
export interface ResolvedHotelPricing {
  currency: string;
  policy: PricingPolicyVersion;
  route: RouteOption;
  capabilityId: string;
  margin: { basisPoints: number } | null;
  /**
   * Digest of every input of the price (environment, policy version, route capability, margin, rate count, rate parity,
   * provider timeout, currency). A stored list price is shown only while the current digest is the same.
   */
  fingerprint: string;
}

export class HotelPricing {
  constructor(private readonly deps: { matrix: CapabilityMatrix; sourceLock: SourceLock; policies: PolicyRepository; settings: HotelPricingSettings }) {}

  get settings(): HotelPricingSettings {
    return this.deps.settings;
  }

  async policy(): Promise<PricingPolicyVersion> {
    const p = await this.deps.policies.activePricing(this.deps.settings.policyId);
    if (!p) throw new CapabilityNotAvailableError('Sales are closed: no approved pricing policy', ['pricing policy not approved']);
    return p;
  }

  /** Throws CapabilityNotAvailableError when hotel sales are closed in this currency. */
  async resolve(currency: string, policy?: PricingPolicyVersion): Promise<ResolvedHotelPricing> {
    const p = policy ?? (await this.policy());
    const route = await providerManagedRoute(this.deps, currency, p, 'HOTEL');
    const capabilityId = route.funding[0]!.capabilityId;
    const margin = providerMarginForSearch(p, 'HOTEL', 'PROVIDER_MANAGED');
    const s = this.deps.settings;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          v: 1,
          environment: s.environment,
          policy: [p.id, p.version],
          capabilityId,
          supportsApiMargin: this.supportsApiMargin(capabilityId),
          margin: margin?.basisPoints ?? null,
          maxRatesPerHotel: s.maxRatesPerHotel,
          enforceRateParity: s.enforceRateParity,
          timeout: NUITEE_HOTEL_TIMEOUTS.searchTimeoutSeconds,
          currency,
        }),
      )
      .digest('hex')
      .slice(0, 32);
    return { currency, policy: p, route, capabilityId, margin, fingerprint };
  }

  supportsApiMargin(capabilityId: string): boolean {
    return this.deps.matrix.supplierCapabilities.find((c) => c.id === capabilityId)?.supportsApiMargin === true;
  }

  /** The customer price of one offer (null = not shown), exactly as the search prices it. */
  price(offer: HotelOffer, r: ResolvedHotelPricing, hidden: HiddenOffers): Omit<StoredOffer, 'key'> | null {
    return priceHotelOffer(offer, r.policy, { supportsApiMargin: this.supportsApiMargin(r.capabilityId), enforceRateParity: this.deps.settings.enforceRateParity }, hidden);
  }
}
