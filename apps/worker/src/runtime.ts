import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeConfig, type AppConfig } from '@texholiday/config';
import { NuiteeHotelProviderManagedPort } from '@texholiday/booking';
import { NuiteeHotelConnector } from '@texholiday/connectors';
import { DomainError, parseSourceLock, type HotelConnector, type SourceLock } from '@texholiday/contracts';
import { CheckoutRepository, DrizzleOrderStore, OutboxRepository, PolicyRepository, QuoteRepository, createCoreDatabase, type CoreDatabase } from '@texholiday/db';
import { PackageOrchestrator, ProviderManagedOrchestrator, type ItemBookingPort, type OrchestrationPolicy, type OrderItemState } from '@texholiday/domain';
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
  /** Which business-edited policy set (G06) this deployment uses, e.g. the B2C channel. */
  policyId: string;
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
    policyId: env.POLICY_ID ?? 'b2c',
  };
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
export async function createRuntime(
  config: AppConfig,
  env: Record<string, string | undefined>,
  log: Logger,
  bookingPorts: ReadonlyMap<string, ItemBookingPort> = new Map(),
  /** Hotel connector for provider-managed checkouts; tests pass the MOCK connector. */
  hotelConnector: HotelConnector | null = null,
): Promise<Runtime> {
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
  const policies = new PolicyRepository(core.db);
  const hotels =
    hotelConnector ??
    (config.nuitee
      ? new NuiteeHotelConnector({
          apiKey: config.nuitee.apiKey,
          environment: config.nuitee.keyEnvironment,
          searchBaseUrl: config.nuitee.searchBaseUrl,
          bookBaseUrl: config.nuitee.bookBaseUrl,
          searchTimeoutSeconds: 6,
          bookTimeoutSeconds: 120,
        })
      : null);
  // Provider-managed checkouts (ADR-0008): finalize while the customer may have paid, abandon at the deadline.
  const providerManaged = hotels
    ? new ProviderManagedOrchestrator({
        store,
        port: new NuiteeHotelProviderManagedPort(hotels, new QuoteRepository(core.db), new CheckoutRepository(core.db)),
        clock: () => new Date(),
        workerId: env.WORKER_ID ?? `worker-${process.pid}`,
        policy: {
          intentLeaseSeconds: tech.intentLeaseSeconds,
          finalizeRetrySeconds: (attempt) => Math.min(20 * 2 ** Math.max(0, attempt - 1), 300),
          maxAutomaticLookups: tech.maxAutomaticLookups,
        },
      })
    : null;
  const pm = () => {
    if (!providerManaged) throw new ConnectorUnavailableError('nuitee-hotel');
    return providerManaged;
  };
  const handlers: Record<string, EventHandler> = {
    'order.provider_managed.finalize': async (payload) => {
      await pm().finalize(String(payload.orderId), Number.isInteger(payload.attempt) ? Number(payload.attempt) : 1);
    },
    'order.provider_managed.lookup': async (payload) => {
      await pm().finalize(String(payload.orderId), 1);
    },
    'order.advance': async (payload) => {
      const orderId = String(payload.orderId);
      // Business-edited and approved in /yonetim (G06); read per event so an approved change applies at once.
      const risk = await policies.activeRisk(tech.policyId);
      if (!risk) throw new Error(`No approved risk policy '${tech.policyId}': automatic order processing is disabled (G06)`);
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
