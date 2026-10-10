import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCapabilityMatrix, parseSourceLock, type CapabilityMatrix, type GatewayAdapterCapabilities, type RiskPolicyVersion, type SourceLock } from '@texholiday/contracts';
import type { PricingPolicyVersion } from '@texholiday/pricing';
import { selectPaymentRoutes, type RoutingInput } from '../src/index';

const root = join(__dirname, '..', '..', '..');
const realMatrix = parseCapabilityMatrix(JSON.parse(readFileSync(join(root, 'contracts', 'capability-matrix.json'), 'utf8')));
const realLock = parseSourceLock(JSON.parse(readFileSync(join(root, 'contracts', 'sources.lock.json'), 'utf8')));

/** TEST-ONLY: a hypothetical world where every *documented* capability was verified in production. */
function verifiedWorld(): { matrix: CapabilityMatrix; lock: SourceLock } {
  const matrix: CapabilityMatrix = structuredClone(realMatrix);
  for (const c of matrix.supplierCapabilities) {
    if (c.documentationStatus !== 'DOCUMENTED') continue;
    c.accountStatus = 'ENABLED';
    c.sandboxStatus = c.sandboxStatus === 'NOT_SUPPORTED' ? 'NOT_SUPPORTED' : 'PASSED';
    c.productionStatus = 'PASSED';
    c.enabledForProduction = true;
    for (const k of Object.keys(c.chargeCurrencies)) c.chargeCurrencies[k] = 'VERIFIED';
    if (c.kind === 'OWN_GATEWAY_INDEPENDENT_FUNDING' && c.fundingMethods.length === 0) c.fundingMethods = ['ACCOUNT_CARD'];
  }
  for (const g of matrix.gateways) {
    g.accountStatus = 'ENABLED';
    g.enabledForProduction = true;
    g.merchantPreauthStatus = 'VERIFIED';
    g.webhookV3ActivationStatus = 'VERIFIED';
    for (const op of Object.values(g.operations)) {
      op.productionStatus = 'PASSED';
      op.sandboxStatus = 'PASSED';
    }
    for (const k of Object.keys(g.chargeCurrencies)) g.chargeCurrencies[k] = 'VERIFIED';
  }
  const lock: SourceLock = structuredClone(realLock);
  for (const s of lock.sources) s.status = 'PINNED';
  return { matrix, lock };
}

const pricing: PricingPolicyVersion = {
  id: 'pp-test',
  version: 1,
  status: 'APPROVED',
  approvedBy: 'test',
  approvedAt: '2026-10-01T00:00:00Z',
  rounding: 'HALF_EVEN',
  allowBelowSspInOpaquePackage: false,
  serviceFees: [],
  fx: null,
  rules: (['HOTEL', 'FLIGHT', 'EXPERIENCE', 'TRANSFER'] as const).flatMap((productType) => [
    { productType, paymentMode: 'OWN_GATEWAY' as const, application: 'LOCAL' as const, kind: 'PERCENT_OF_NET' as const, basisPoints: 0 },
    { productType, paymentMode: 'PROVIDER_MANAGED' as const, application: 'PROVIDER_API' as const, kind: 'PERCENT_OF_NET' as const, basisPoints: 0 },
  ]),
};

const risk: RiskPolicyVersion = {
  id: 'rp-test',
  version: 1,
  status: 'APPROVED',
  approvedBy: 'test',
  approvedAt: '2026-10-01T00:00:00Z',
  maxUncapturedSupplierExposure: { EUR: '10000000' },
  authorizationSafetyMarginSeconds: 3600,
  allowUnknownAsyncConfirmationBound: false,
  fundingPreference: ['ACCOUNT_CARD', 'CREDIT_LINE'],
};

const iyzicoAdapter = (overrides: Partial<GatewayAdapterCapabilities> = {}): GatewayAdapterCapabilities => ({
  gatewayId: 'iyzico',
  environment: 'production',
  isMock: false,
  operations: new Set(['AUTHORIZE', 'CAPTURE', 'RETRIEVE', 'VOID', 'REFUND_FULL', 'REFUND_PARTIAL', 'VERIFIED_NOTIFICATION']),
  currencies: ['TRY', 'EUR', 'USD', 'GBP'],
  idempotency: { createSession: 'NONE', capture: 'NONE', void: 'NONE', refund: 'NONE' },
  requiredBuyerFields: [],
  authorizationValiditySeconds: 25 * 86_400,
  ...overrides,
});

const HOTEL = { itemId: 'h', productType: 'HOTEL' as const, providerId: 'nuitee' };
const FLIGHT = { itemId: 'f', productType: 'FLIGHT' as const, providerId: 'nuitee' };
const EXP = { itemId: 'e', productType: 'EXPERIENCE' as const, providerId: 'nuitee' };
const TRANSFER = { itemId: 't', productType: 'TRANSFER' as const, providerId: 'welcome_pickups' };

function input(items: RoutingInput['items'], currency: string, world = verifiedWorld(), overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    items,
    chargeCurrency: currency,
    environment: 'production',
    matrix: world.matrix,
    sourceLock: world.lock,
    gateways: [iyzicoAdapter()],
    pricingPolicy: pricing,
    riskPolicy: risk,
    ...overrides,
  };
}

describe('payment routing with today\'s real evidence (R0 state)', () => {
  it('opens no production route: every account is UNVERIFIED and contracts are not pinned', () => {
    for (const [items, cur] of [
      [[HOTEL], 'TRY'],
      [[HOTEL], 'EUR'],
      [[TRANSFER], 'EUR'],
      [[HOTEL, TRANSFER, FLIGHT], 'EUR'],
    ] as const) {
      const d = selectPaymentRoutes(input(items, cur, { matrix: realMatrix, lock: realLock }));
      expect(d.available).toBe(false);
      if (!d.available) expect(d.reasons.join(' ')).toMatch(/UNVERIFIED|not enabled|unpinned/);
    }
  });
});

describe('§5.4 routing rules (hypothetical fully verified world)', () => {
  it('rule 1: a package uses the own gateway with independent funding per item', () => {
    const d = selectPaymentRoutes(input([HOTEL, TRANSFER, FLIGHT], 'EUR'));
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(d.defaultOption.route.mode).toBe('OWN_GATEWAY');
    expect(d.defaultOption.funding.map((f) => f.method)).toEqual(['ACCOUNT_CARD', 'CREDIT_LINE', 'ACCOUNT_CARD']);
  });

  it('T23: any package containing an Experience stays closed while independent funding is NOT_DOCUMENTED', () => {
    const d = selectPaymentRoutes(input([HOTEL, EXP], 'EUR'));
    expect(d.available).toBe(false);
    if (!d.available) expect(d.reasons.join(' ')).toContain('nuitee.experience.own_gateway.independent_funding: documentation NOT_DOCUMENTED');
  });

  it('T23: a single Experience in TRY (own gateway) is closed; in EUR only provider-managed is offered', () => {
    expect(selectPaymentRoutes(input([EXP], 'TRY')).available).toBe(false);
    const eur = selectPaymentRoutes(input([EXP], 'EUR'));
    expect(eur.available).toBe(true);
    if (eur.available) {
      expect(eur.defaultOption.route.mode).toBe('PROVIDER_MANAGED');
      expect(eur.alternatives).toHaveLength(0);
    }
  });

  it('rule 2: a single Welcome transfer always uses the own gateway', () => {
    const d = selectPaymentRoutes(input([TRANSFER], 'EUR'));
    expect(d.available && d.defaultOption.route.mode).toBe('OWN_GATEWAY');
  });

  it('rule 3: a single Nuitee product in TRY uses the own gateway', () => {
    const d = selectPaymentRoutes(input([HOTEL], 'TRY'));
    expect(d.available && d.defaultOption.route.mode).toBe('OWN_GATEWAY');
  });

  it('rule 4: a single hotel in EUR defaults to provider-managed with the verified own gateway as alternative', () => {
    const d = selectPaymentRoutes(input([HOTEL], 'EUR'));
    expect(d.available).toBe(true);
    if (!d.available) return;
    expect(d.defaultOption.route.mode).toBe('PROVIDER_MANAGED');
    expect(d.alternatives.map((a) => a.route.mode)).toEqual(['OWN_GATEWAY']);
  });

  it('rule 5: an unverified charge currency closes the route before payment starts (no silent FX)', () => {
    const world = verifiedWorld();
    world.matrix.gateways[0]!.chargeCurrencies.GBP = 'UNVERIFIED';
    const d = selectPaymentRoutes(input([HOTEL, TRANSFER], 'GBP', world));
    expect(d.available).toBe(false);
  });

  it('T22: a gateway without verified notifications cannot carry a package but can carry a single item', () => {
    const gw = iyzicoAdapter({ operations: new Set(['AUTHORIZE', 'CAPTURE', 'RETRIEVE', 'VOID', 'REFUND_FULL', 'REFUND_PARTIAL']) });
    expect(selectPaymentRoutes(input([HOTEL, TRANSFER], 'EUR', verifiedWorld(), { gateways: [gw] })).available).toBe(false);
    expect(selectPaymentRoutes(input([TRANSFER], 'EUR', verifiedWorld(), { gateways: [gw] })).available).toBe(true);
  });

  it('refuses mock adapters outside the mock environment', () => {
    const d = selectPaymentRoutes(input([TRANSFER], 'EUR', verifiedWorld(), { gateways: [iyzicoAdapter({ isMock: true })] }));
    expect(d.available).toBe(false);
  });

  it('no approved pricing or risk policy -> closed (no invented margins or limits)', () => {
    expect(selectPaymentRoutes(input([HOTEL, TRANSFER], 'EUR', verifiedWorld(), { pricingPolicy: null })).available).toBe(false);
    expect(selectPaymentRoutes(input([HOTEL, TRANSFER], 'EUR', verifiedWorld(), { riskPolicy: { ...risk, status: 'DRAFT' } })).available).toBe(false);
    expect(selectPaymentRoutes(input([HOTEL], 'EUR', verifiedWorld(), { pricingPolicy: { ...pricing, status: 'DRAFT' } })).available).toBe(false);
  });

  it('hotel CREDIT line is not usable in sandbox (NOT_SUPPORTED) so sandbox picks the account card', () => {
    const world = verifiedWorld();
    const d = selectPaymentRoutes(
      input([HOTEL], 'TRY', world, { environment: 'sandbox', gateways: [iyzicoAdapter({ environment: 'sandbox' })], riskPolicy: { ...risk, fundingPreference: ['CREDIT_LINE', 'ACCOUNT_CARD'] } }),
    );
    expect(d.available && d.defaultOption.funding[0]!.method).toBe('ACCOUNT_CARD');
  });

  it('is deterministic', () => {
    const a = selectPaymentRoutes(input([HOTEL, TRANSFER, FLIGHT], 'EUR'));
    const b = selectPaymentRoutes(input([HOTEL, TRANSFER, FLIGHT], 'EUR'));
    expect(a).toEqual(b);
  });
});
