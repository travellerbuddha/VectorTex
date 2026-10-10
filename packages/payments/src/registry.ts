import { ContractNotPinnedError, unpinnedSources, type GatewayAdapterCapabilities, type OwnedPaymentGateway, type ProviderEnvironment, type SourceLock } from '@texholiday/contracts';

export class GatewayRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayRegistryError';
  }
}

/**
 * Approved, ordered set of owned gateways for one environment. Business code resolves gateways by id from
 * here; a client-provided gateway id is only accepted if it is registered (§4.1).
 */
export class GatewayRegistry {
  private readonly gateways = new Map<string, OwnedPaymentGateway>();

  constructor(
    private readonly environment: ProviderEnvironment,
    private readonly sourceLock: SourceLock,
  ) {}

  register(gateway: OwnedPaymentGateway, requiredSources: readonly string[]): this {
    const caps = gateway.capabilities();
    if (caps.environment !== this.environment) {
      throw new GatewayRegistryError(`${caps.gatewayId} is a ${caps.environment} adapter; registry is ${this.environment}`);
    }
    if (caps.isMock && this.environment !== 'mock') throw new GatewayRegistryError(`Mock gateway ${caps.gatewayId} refused outside the mock environment`);
    if (this.environment === 'production') {
      const missing = unpinnedSources(this.sourceLock, requiredSources);
      if (missing.length > 0) throw new ContractNotPinnedError(caps.gatewayId, missing);
    }
    if (this.gateways.has(caps.gatewayId)) throw new GatewayRegistryError(`Duplicate gateway ${caps.gatewayId}`);
    this.gateways.set(caps.gatewayId, gateway);
    return this;
  }

  get(gatewayId: string): OwnedPaymentGateway {
    const gw = this.gateways.get(gatewayId);
    if (!gw) throw new GatewayRegistryError(`Unknown or unapproved gateway ${gatewayId}`);
    return gw;
  }

  /** Capabilities in registration (approved priority) order, for route selection. */
  capabilities(): GatewayAdapterCapabilities[] {
    return [...this.gateways.values()].map((g) => g.capabilities());
  }
}
