import {
  chargeCurrencyVerified,
  gatewayOperationUsable,
  supplierCapabilityUsable,
  type CapabilityMatrix,
  type FundingMethod,
  type GatewayAdapterCapabilities,
  type GatewayOperation,
  type PaymentRoute,
  type ProductType,
  type ProviderEnvironment,
  type RiskPolicyVersion,
  type SourceLock,
  type SupplierCapability,
} from '@texholiday/contracts';
import type { PricingPolicyVersion } from '@texholiday/pricing';

export interface RoutingItem {
  itemId: string;
  productType: ProductType;
  providerId: string;
}

export interface RoutingInput {
  items: readonly RoutingItem[];
  chargeCurrency: string;
  environment: ProviderEnvironment;
  matrix: CapabilityMatrix;
  sourceLock: SourceLock;
  /** Registered gateway adapters, in the approved registry order (first = default). */
  gateways: readonly GatewayAdapterCapabilities[];
  pricingPolicy: PricingPolicyVersion | null;
  riskPolicy: RiskPolicyVersion | null;
}

export interface ItemFunding {
  itemId: string;
  capabilityId: string;
  method: FundingMethod;
}

export interface RouteOption {
  route: PaymentRoute;
  funding: readonly ItemFunding[];
}

export type RouteDecision =
  | { available: true; defaultOption: RouteOption; alternatives: readonly RouteOption[] }
  | { available: false; code: 'CAPABILITY_NOT_AVAILABLE'; reasons: readonly string[] };

/** Operations a gateway must support for packages (matrix owned_gateway_baseline). */
export const PACKAGE_GATEWAY_OPERATIONS: readonly GatewayOperation[] = ['AUTHORIZE', 'CAPTURE', 'RETRIEVE', 'VOID', 'REFUND_FULL', 'REFUND_PARTIAL', 'VERIFIED_NOTIFICATION'];
/** Single-item own-gateway orders still authorize first and capture after the booking succeeds. */
export const SINGLE_ITEM_GATEWAY_OPERATIONS: readonly GatewayOperation[] = ['AUTHORIZE', 'CAPTURE', 'RETRIEVE', 'VOID', 'REFUND_FULL'];

const OWN_GATEWAY_KINDS: ReadonlySet<SupplierCapability['kind']> = new Set([
  'OWN_GATEWAY_WITH_ACCOUNT_CARD',
  'OWN_GATEWAY_WITH_CREDIT_LINE',
  'OWN_GATEWAY_INDEPENDENT_FUNDING',
  'OWN_GATEWAY_WITH_CREDIT_ACCOUNT',
]);

function policyVersionTag(p: { id: string; version: number }): string {
  return `${p.id}@${p.version}`;
}

function approved(p: { status: string; approvedBy: string | null; approvedAt: string | null } | null): boolean {
  return !!p && p.status === 'APPROVED' && !!p.approvedBy && !!p.approvedAt;
}

function hasPricingRule(policy: PricingPolicyVersion, productType: ProductType, mode: PaymentRoute['mode']): boolean {
  return policy.rules.some((r) => r.productType === productType && r.paymentMode === mode);
}

/** Usable independent funding for one item, ordered by the approved funding preference. */
function independentFunding(item: RoutingItem, input: RoutingInput, reasons: string[]): ItemFunding | null {
  const caps = input.matrix.supplierCapabilities.filter(
    (c) => c.providerId === item.providerId && c.productType === item.productType && OWN_GATEWAY_KINDS.has(c.kind),
  );
  if (caps.length === 0) {
    reasons.push(`${item.itemId}: no own-gateway funding capability for ${item.providerId}/${item.productType}`);
    return null;
  }
  const candidates: ItemFunding[] = [];
  for (const cap of caps) {
    const u = supplierCapabilityUsable(cap, input.environment, input.sourceLock);
    if (!u.usable) {
      reasons.push(...u.reasons.map((r) => `${item.itemId}: ${r}`));
      continue;
    }
    if (!chargeCurrencyVerified(cap, input.chargeCurrency, input.environment)) {
      reasons.push(`${item.itemId}: ${cap.id} charge currency ${input.chargeCurrency} not verified`);
      continue;
    }
    if (cap.fundingMethods.length === 0) {
      reasons.push(`${item.itemId}: ${cap.id} has no proven funding method`);
      continue;
    }
    for (const method of cap.fundingMethods) {
      if (method !== 'PROVIDER_MANAGED') candidates.push({ itemId: item.itemId, capabilityId: cap.id, method });
    }
  }
  if (candidates.length === 0) return null;
  const preference = input.riskPolicy?.fundingPreference ?? [];
  const ranked = candidates
    .filter((c) => preference.includes(c.method))
    .sort((a, b) => preference.indexOf(a.method) - preference.indexOf(b.method));
  if (ranked.length === 0) {
    reasons.push(`${item.itemId}: no funding method allowed by the approved risk policy`);
    return null;
  }
  return ranked[0] as ItemFunding;
}

function usableGateways(input: RoutingInput, ops: readonly GatewayOperation[], reasons: string[]): GatewayAdapterCapabilities[] {
  const result: GatewayAdapterCapabilities[] = [];
  for (const gw of input.gateways) {
    if (gw.environment !== input.environment) {
      reasons.push(`${gw.gatewayId}: adapter environment ${gw.environment} != ${input.environment}`);
      continue;
    }
    if (gw.isMock && input.environment !== 'mock') {
      reasons.push(`${gw.gatewayId}: mock adapter outside mock environment`);
      continue;
    }
    const record = input.matrix.gateways.find((g) => g.gatewayId === gw.gatewayId);
    if (!record) {
      reasons.push(`${gw.gatewayId}: no capability record`);
      continue;
    }
    const local: string[] = [];
    for (const op of ops) {
      if (!gw.operations.has(op)) local.push(`${gw.gatewayId}.${op}: not implemented by adapter`);
      else local.push(...gatewayOperationUsable(record, op, input.environment, input.sourceLock).reasons);
    }
    if (!gw.currencies.includes(input.chargeCurrency)) local.push(`${gw.gatewayId}: adapter cannot charge ${input.chargeCurrency}`);
    if (!chargeCurrencyVerified(record, input.chargeCurrency, input.environment)) local.push(`${gw.gatewayId}: merchant currency ${input.chargeCurrency} not verified`);
    if (local.length > 0) reasons.push(...local);
    else result.push(gw);
  }
  return result;
}

function ownGatewayOptions(input: RoutingInput, ops: readonly GatewayOperation[], reasons: string[]): RouteOption[] {
  if (!approved(input.pricingPolicy)) {
    reasons.push('pricing policy not approved');
    return [];
  }
  const pricing = input.pricingPolicy as PricingPolicyVersion;
  const funding: ItemFunding[] = [];
  for (const item of input.items) {
    if (!hasPricingRule(pricing, item.productType, 'OWN_GATEWAY')) {
      reasons.push(`${item.itemId}: no approved OWN_GATEWAY pricing rule for ${item.productType}`);
      return [];
    }
    const f = independentFunding(item, input, reasons);
    if (!f) return [];
    funding.push(f);
  }
  const gateways = usableGateways(input, ops, reasons);
  const planId = `plan:${funding.map((f) => `${f.itemId}=${f.method}`).join(',')}`;
  return gateways.map((gw) => ({
    route: { mode: 'OWN_GATEWAY', gatewayId: gw.gatewayId, currency: input.chargeCurrency, settlementPlanId: planId, policyVersion: policyVersionTag(pricing) },
    funding,
  }));
}

function providerManagedOption(input: RoutingInput, item: RoutingItem, reasons: string[]): RouteOption | null {
  if (!approved(input.pricingPolicy)) {
    reasons.push('pricing policy not approved');
    return null;
  }
  const pricing = input.pricingPolicy as PricingPolicyVersion;
  if (!hasPricingRule(pricing, item.productType, 'PROVIDER_MANAGED')) {
    reasons.push(`${item.itemId}: no approved PROVIDER_MANAGED pricing rule for ${item.productType}`);
    return null;
  }
  const cap = input.matrix.supplierCapabilities.find(
    (c) => c.providerId === item.providerId && c.productType === item.productType && c.kind === 'PROVIDER_MANAGED_CUSTOMER_PAYMENT',
  );
  if (!cap) {
    reasons.push(`${item.itemId}: no provider-managed payment capability`);
    return null;
  }
  const u = supplierCapabilityUsable(cap, input.environment, input.sourceLock);
  if (!u.usable) {
    reasons.push(...u.reasons);
    return null;
  }
  if (!chargeCurrencyVerified(cap, input.chargeCurrency, input.environment)) {
    reasons.push(`${cap.id}: charge currency ${input.chargeCurrency} not verified`);
    return null;
  }
  return {
    route: { mode: 'PROVIDER_MANAGED', providerId: item.providerId, productType: item.productType, currency: input.chargeCurrency, policyVersion: policyVersionTag(pricing) },
    funding: [{ itemId: item.itemId, capabilityId: cap.id, method: 'PROVIDER_MANAGED' }],
  };
}

const closed = (reasons: string[]): RouteDecision => ({ available: false, code: 'CAPABILITY_NOT_AVAILABLE', reasons: [...new Set(reasons)] });

/**
 * Server-side payment route selection (§5.4). Pure: same input, same decision. The selected option is
 * stored as a snapshot on the checkout; a different choice later needs a new quote and acceptance.
 */
export function selectPaymentRoutes(input: RoutingInput): RouteDecision {
  const reasons: string[] = [];
  if (input.items.length === 0) return closed(['empty basket']);

  // Rule 1: more than one provider booking / package -> own gateway, one customer charge.
  if (input.items.length > 1) {
    if (!approved(input.riskPolicy)) return closed(['risk policy not approved (required for packages)']);
    const options = ownGatewayOptions(input, PACKAGE_GATEWAY_OPERATIONS, reasons);
    if (options.length === 0) return closed(reasons);
    return { available: true, defaultOption: options[0] as RouteOption, alternatives: options.slice(1) };
  }

  const item = input.items[0] as RoutingItem;

  // Rule 2: a product without a documented provider-managed payment (Welcome transfer) -> own gateway.
  // Rule 3 / K13: any TRY charge -> own gateway.
  const providerManagedDocumented = input.matrix.supplierCapabilities.some(
    (c) =>
      c.providerId === item.providerId &&
      c.productType === item.productType &&
      c.kind === 'PROVIDER_MANAGED_CUSTOMER_PAYMENT' &&
      c.documentationStatus === 'DOCUMENTED',
  );
  if (!providerManagedDocumented || input.chargeCurrency === 'TRY') {
    if (!approved(input.riskPolicy)) return closed(['risk policy not approved']);
    const options = ownGatewayOptions(input, SINGLE_ITEM_GATEWAY_OPERATIONS, reasons);
    if (options.length === 0) return closed(reasons);
    return { available: true, defaultOption: options[0] as RouteOption, alternatives: options.slice(1) };
  }

  // Rule 4: single Nuitee product in a supported foreign currency -> provider-managed by default;
  // own gateway only as a fully verified alternative.
  const pm = providerManagedOption(input, item, reasons);
  const own = approved(input.riskPolicy) ? ownGatewayOptions(input, SINGLE_ITEM_GATEWAY_OPERATIONS, reasons) : [];
  if (pm) return { available: true, defaultOption: pm, alternatives: own };
  if (own.length > 0) return { available: true, defaultOption: own[0] as RouteOption, alternatives: own.slice(1) };

  // Rule 5: nothing eligible -> no payment starts.
  return closed(reasons);
}
