import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, desc, eq } from 'drizzle-orm';
import { describeConfig, type AppConfig } from '@texholiday/config';
import { DomainError, parseSourceLock, type RiskPolicyVersion, type SourceLock } from '@texholiday/contracts';
import { DrizzleOrderStore, OutboxRepository, createCoreDatabase, schema, type CoreDatabase } from '@texholiday/db';
import { PackageOrchestrator, type ItemBookingPort, type OrchestrationPolicy, type OrderItemState } from '@texholiday/domain';
import { GatewayRegistry, IYZICO_REQUIRED_SOURCES, IyzicoGateway } from '@texholiday/payments';
import type { EventHandler, Logger } from './relay';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function loadSourceLock(): SourceLock {
  return parseSourceLock(JSON.parse(readFileSync(join(repoRoot, 'contracts', 'sources.lock.json'), 'utf8')));
}

export class ConnectorUnavailableError extends DomainError {
  constructor(connectorId: string) {
    super('CAPABILITY_NOT_AVAILABLE', `No registered connector ${connectorId} in this environment`, { httpStatus: 503, retryable: true });
  }
}

/** Technical (non-business) orchestration settings. The authorization safety margin comes from the approved risk policy. */
export interface TechnicalSettings {
  intentLeaseSeconds: number;
  maxAutomaticLookups: number;
  reconcileBaseDelaySeconds: number;
  reconcileMaxDelaySeconds: number;
  serverEgressIp: string;
  iyzicoTimeoutMs: number;
  iyzicoForeignIdentityPolicy: 'REFUSE' | 'SEND_FOREIGN_ID';
}

export function technicalSettings(env: Record<string, string | undefined>): TechnicalSettings {
  const int = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
    return n;
  };
  return {
    // Must exceed the longest documented provider booking call; a shorter lease would turn slow calls into UNKNOWN.
    intentLeaseSeconds: int('INTENT_LEASE_SECONDS', 600),
    maxAutomaticLookups: int('MAX_AUTOMATIC_LOOKUPS', 6),
    reconcileBaseDelaySeconds: int('RECONCILE_BASE_DELAY_SECONDS', 30),
    reconcileMaxDelaySeconds: int('RECONCILE_MAX_DELAY_SECONDS', 900),
    serverEgressIp: env.SERVER_EGRESS_IP ?? '',
    iyzicoTimeoutMs: int('IYZICO_TIMEOUT_MS', 30_000),
    iyzicoForeignIdentityPolicy: env.IYZICO_FOREIGN_IDENTITY_POLICY === 'SEND_FOREIGN_ID' ? 'SEND_FOREIGN_ID' : 'REFUSE',
  };
}

/** Latest APPROVED risk policy (G06). No approved policy -> orders are not advanced automatically. */
export async function approvedRiskPolicy(core: CoreDatabase): Promise<RiskPolicyVersion | null> {
  const [row] = await core.db
    .select()
    .from(schema.riskPolicyVersions)
    .where(and(eq(schema.riskPolicyVersions.status, 'APPROVED')))
    .orderBy(desc(schema.riskPolicyVersions.approvedAt))
    .limit(1);
  if (!row) return null;
  return { ...(row.document as Omit<RiskPolicyVersion, 'id' | 'version' | 'status' | 'approvedBy' | 'approvedAt'>), id: row.id, version: row.version, status: row.status, approvedBy: row.approvedBy, approvedAt: row.approvedAt };
}

export interface Runtime {
  core: CoreDatabase;
  outbox: OutboxRepository;
  gateways: GatewayRegistry;
  handlers: Record<string, EventHandler>;
  close(): Promise<void>;
}

/**
 * Composition root. Supplier connectors are registered per connectorId; none is registered for real
 * providers until their contracts are pinned and account-verified (P10–P13), so such orders fail loudly
 * (event retried, then DEAD + alert) instead of being processed by a guess.
 */
export async function createRuntime(config: AppConfig, env: Record<string, string | undefined>, log: Logger, bookingPorts: ReadonlyMap<string, ItemBookingPort> = new Map()): Promise<Runtime> {
  const tech = technicalSettings(env);
  const core = createCoreDatabase(config.database.url, { applicationName: 'texholiday-worker' });
  const lock = loadSourceLock();
  const gateways = new GatewayRegistry(config.providerEnvironment, lock);
  if (config.iyzico && config.providerEnvironment !== 'mock') {
    if (!tech.serverEgressIp) throw new Error('SERVER_EGRESS_IP is required when the iyzico gateway is enabled');
    gateways.register(
      new IyzicoGateway({
        ...config.iyzico,
        environment: config.providerEnvironment,
        timeoutMs: tech.iyzicoTimeoutMs,
        foreignIdentityPolicy: tech.iyzicoForeignIdentityPolicy,
        enabledInstallments: [1],
      }),
      IYZICO_REQUIRED_SOURCES,
    );
  }
  log.info('worker runtime', { config: describeConfig(config), gateways: gateways.capabilities().map((g) => g.gatewayId), connectors: [...bookingPorts.keys()] });

  const store = new DrizzleOrderStore(core.db);
  const handlers: Record<string, EventHandler> = {
    'order.advance': async (payload) => {
      const orderId = String(payload.orderId);
      const risk = await approvedRiskPolicy(core);
      if (!risk) throw new Error('No approved risk policy: automatic order processing is disabled (G06)');
      const policy: OrchestrationPolicy = {
        authorizationSafetyMarginSeconds: risk.authorizationSafetyMarginSeconds,
        maxAutomaticLookups: tech.maxAutomaticLookups,
        intentLeaseSeconds: tech.intentLeaseSeconds,
        reconcileDelaySeconds: (attempt) => Math.min(tech.reconcileBaseDelaySeconds * 2 ** attempt, tech.reconcileMaxDelaySeconds),
      };
      const orchestrator = new PackageOrchestrator({
        store,
        gateway: (id) => gateways.get(id),
        bookings: (it: OrderItemState) => {
          const port = bookingPorts.get(it.connectorId);
          if (!port) throw new ConnectorUnavailableError(it.connectorId);
          return port;
        },
        clock: () => new Date(),
        workerId: env.WORKER_ID ?? `worker-${process.pid}`,
        serverIp: tech.serverEgressIp,
        policy,
      });
      // One step per event; the step persists its follow-up event in the outbox (same transaction).
      await orchestrator.step(orderId);
    },
  };

  return { core, outbox: new OutboxRepository(core.db), gateways, handlers, close: () => core.close() };
}
