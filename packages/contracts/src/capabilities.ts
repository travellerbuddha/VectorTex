import { z } from 'zod';
import type { ProviderEnvironment } from './common';
import { unpinnedSources, type SourceLock } from './sources';

export const documentationStatus = z.enum(['DOCUMENTED', 'NOT_DOCUMENTED', 'CONFLICTING']);
export const accountStatus = z.enum(['UNVERIFIED', 'ENABLED', 'DISABLED']);
export const sandboxStatus = z.enum(['NOT_RUN', 'PASSED', 'FAILED', 'NOT_SUPPORTED']);
export const productionStatus = z.enum(['NOT_RUN', 'PASSED', 'FAILED']);
const verification = z.enum(['UNVERIFIED', 'VERIFIED', 'REFUSED']);

const evidenceSchema = z.object({
  source: z.string(),
  verifiedAt: z.string(),
  environment: z.enum(['documentation', 'mock', 'sandbox', 'production']),
  /** PII-free test reference (e.g. internal test id, provider request id). */
  reference: z.string(),
  summary: z.string(),
});

export const supplierCapabilitySchema = z.object({
  id: z.string(),
  providerId: z.string(),
  productType: z.enum(['HOTEL', 'FLIGHT', 'EXPERIENCE', 'TRANSFER']),
  kind: z.enum([
    'PROVIDER_MANAGED_CUSTOMER_PAYMENT',
    'OWN_GATEWAY_WITH_ACCOUNT_CARD',
    'OWN_GATEWAY_WITH_CREDIT_LINE',
    'OWN_GATEWAY_INDEPENDENT_FUNDING',
    'OWN_GATEWAY_WITH_CREDIT_ACCOUNT',
    'NUITEE_MANAGED_CUSTOMER_PAYMENT_FOR_WELCOME',
  ]),
  /** Funding methods proven for this capability. Empty means not yet known. */
  fundingMethods: z.array(z.enum(['ACCOUNT_CARD', 'CREDIT_LINE', 'PROVIDER_MANAGED'])),
  documentationStatus,
  accountStatus,
  sandboxStatus,
  productionStatus,
  enabledForProduction: z.boolean(),
  /** Per charge-currency verification for this capability (route + merchant). */
  chargeCurrencies: z.record(z.string(), verification),
  supportsApiMargin: z.boolean(),
  requiredSources: z.array(z.string()),
  activationConditions: z.array(z.string()),
  blocksGate: z.string().nullable(),
  forbiddenWorkarounds: z.array(z.string()).default([]),
  evidence: z.array(evidenceSchema),
});

export const gatewayOperationSchema = z.enum([
  'AUTHORIZE',
  'CAPTURE',
  'RETRIEVE',
  'VOID',
  'REFUND_FULL',
  'REFUND_PARTIAL',
  'VERIFIED_NOTIFICATION',
]);
export type GatewayOperation = z.infer<typeof gatewayOperationSchema>;

const gatewayOperationStatus = z.object({
  documentationStatus,
  sandboxStatus,
  productionStatus,
});

export const gatewayCapabilitySchema = z.object({
  gatewayId: z.string(),
  accountStatus,
  enabledForProduction: z.boolean(),
  merchantPreauthStatus: verification,
  webhookV3ActivationStatus: verification,
  operations: z.record(gatewayOperationSchema, gatewayOperationStatus),
  chargeCurrencies: z.record(z.string(), verification),
  requiredSources: z.array(z.string()),
  evidence: z.array(evidenceSchema),
});

export const launchGateSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['NOT_PASSED', 'PASSED']),
  requires: z.array(z.string()),
  evidence: z.array(evidenceSchema),
});

export const capabilityMatrixSchema = z.object({
  schemaVersion: z.literal(1),
  asOf: z.string(),
  verificationBoundary: z.string(),
  supplierCapabilities: z.array(supplierCapabilitySchema),
  gateways: z.array(gatewayCapabilitySchema),
  launchGates: z.array(launchGateSchema),
});

export type SupplierCapability = z.infer<typeof supplierCapabilitySchema>;
export type GatewayCapabilityRecord = z.infer<typeof gatewayCapabilitySchema>;
export type CapabilityMatrix = z.infer<typeof capabilityMatrixSchema>;
export type LaunchGate = z.infer<typeof launchGateSchema>;

export function parseCapabilityMatrix(json: unknown): CapabilityMatrix {
  const matrix = capabilityMatrixSchema.parse(json);
  for (const cap of matrix.supplierCapabilities) {
    if (cap.enabledForProduction && (cap.productionStatus !== 'PASSED' || cap.accountStatus !== 'ENABLED')) {
      throw new Error(`Capability ${cap.id} cannot be enabledForProduction without account ENABLED and production PASSED`);
    }
    if (cap.documentationStatus !== 'DOCUMENTED' && cap.enabledForProduction) {
      throw new Error(`Capability ${cap.id} is not documented and cannot be enabled`);
    }
  }
  for (const gate of matrix.launchGates) {
    if (gate.status === 'PASSED' && gate.evidence.length === 0) throw new Error(`Gate ${gate.id} PASSED without evidence`);
  }
  return matrix;
}

export interface Usability {
  usable: boolean;
  reasons: string[];
}

/**
 * Whether a supplier capability may be used to open a route in the given environment.
 * - Never usable when not DOCUMENTED (T22/T23), in any environment.
 * - mock: documentation is enough; only labelled mock adapters run.
 * - sandbox: account ENABLED and sandbox not NOT_SUPPORTED (sandbox runs produce the evidence).
 * - production: account ENABLED, production PASSED, enabledForProduction, required sources PINNED.
 */
export function supplierCapabilityUsable(cap: SupplierCapability, env: ProviderEnvironment, lock: SourceLock): Usability {
  const reasons: string[] = [];
  if (cap.documentationStatus !== 'DOCUMENTED') reasons.push(`${cap.id}: documentation ${cap.documentationStatus}`);
  if (cap.accountStatus === 'DISABLED') reasons.push(`${cap.id}: account DISABLED`);
  if (env === 'sandbox') {
    if (cap.accountStatus !== 'ENABLED') reasons.push(`${cap.id}: account ${cap.accountStatus}`);
    if (cap.sandboxStatus === 'NOT_SUPPORTED') reasons.push(`${cap.id}: not supported in sandbox`);
  }
  if (env === 'production') {
    if (cap.accountStatus !== 'ENABLED') reasons.push(`${cap.id}: account ${cap.accountStatus}`);
    if (cap.productionStatus !== 'PASSED') reasons.push(`${cap.id}: production ${cap.productionStatus}`);
    if (!cap.enabledForProduction) reasons.push(`${cap.id}: not enabled for production`);
    const missing = unpinnedSources(lock, cap.requiredSources);
    if (missing.length > 0) reasons.push(`${cap.id}: unpinned sources ${missing.join(',')}`);
  }
  return { usable: reasons.length === 0, reasons };
}

export function chargeCurrencyVerified(record: { chargeCurrencies: Record<string, string> }, currency: string, env: ProviderEnvironment): boolean {
  // In mock we only exercise flows; production and sandbox need an explicit VERIFIED entry.
  if (env === 'mock') return record.chargeCurrencies[currency] !== 'REFUSED' && currency in record.chargeCurrencies;
  return record.chargeCurrencies[currency] === 'VERIFIED';
}

export function gatewayOperationUsable(gw: GatewayCapabilityRecord, op: GatewayOperation, env: ProviderEnvironment, lock: SourceLock): Usability {
  const reasons: string[] = [];
  const status = gw.operations[op];
  if (!status) return { usable: false, reasons: [`${gw.gatewayId}.${op}: not declared`] };
  if (status.documentationStatus !== 'DOCUMENTED') reasons.push(`${gw.gatewayId}.${op}: documentation ${status.documentationStatus}`);
  if (op === 'AUTHORIZE' && env !== 'mock' && gw.merchantPreauthStatus !== 'VERIFIED') reasons.push(`${gw.gatewayId}: merchant pre-auth ${gw.merchantPreauthStatus}`);
  if (op === 'VERIFIED_NOTIFICATION' && env !== 'mock' && gw.webhookV3ActivationStatus !== 'VERIFIED') {
    reasons.push(`${gw.gatewayId}: webhook activation ${gw.webhookV3ActivationStatus}`);
  }
  if (env === 'sandbox' && gw.accountStatus !== 'ENABLED') reasons.push(`${gw.gatewayId}: account ${gw.accountStatus}`);
  if (env === 'production') {
    if (gw.accountStatus !== 'ENABLED') reasons.push(`${gw.gatewayId}: account ${gw.accountStatus}`);
    if (!gw.enabledForProduction) reasons.push(`${gw.gatewayId}: not enabled for production`);
    if (status.productionStatus !== 'PASSED') reasons.push(`${gw.gatewayId}.${op}: production ${status.productionStatus}`);
    const missing = unpinnedSources(lock, gw.requiredSources);
    if (missing.length > 0) reasons.push(`${gw.gatewayId}: unpinned sources ${missing.join(',')}`);
  }
  return { usable: reasons.length === 0, reasons };
}
