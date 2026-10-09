import { describe, expect, it } from 'vitest';
import { bookingSettingsFromEnv } from '../src/index';

const base = { ORDER_ACCESS_SECRET: 'test-only-secret-0123456789abcdef0123', TERMS_VERSION: 'terms-1' };

describe('booking settings', () => {
  it('rate parity is enforced by default in every environment', () => {
    for (const env of ['mock', 'sandbox', 'production'] as const) expect(bookingSettingsFromEnv(base, env, 'b2c').enforceRateParity).toBe(true);
  });

  it('only a sandbox deployment may skip rate parity (synthetic sandbox suggested prices)', () => {
    expect(bookingSettingsFromEnv({ ...base, SANDBOX_SKIP_RATE_PARITY: 'true' }, 'sandbox', 'b2c').enforceRateParity).toBe(false);
    expect(() => bookingSettingsFromEnv({ ...base, SANDBOX_SKIP_RATE_PARITY: 'true' }, 'production', 'b2c')).toThrow(/only allowed with PROVIDER_ENV=sandbox/);
    expect(() => bookingSettingsFromEnv({ ...base, SANDBOX_SKIP_RATE_PARITY: 'true' }, 'mock', 'b2c')).toThrow(/only allowed with PROVIDER_ENV=sandbox/);
    expect(() => bookingSettingsFromEnv({ ...base, SANDBOX_SKIP_RATE_PARITY: 'yes' }, 'sandbox', 'b2c')).toThrow(/true or false/);
  });

  it('refuses a missing access secret or terms version', () => {
    expect(() => bookingSettingsFromEnv({ TERMS_VERSION: 'terms-1' }, 'mock', 'b2c')).toThrow(/ORDER_ACCESS_SECRET/);
    expect(() => bookingSettingsFromEnv({ ORDER_ACCESS_SECRET: base.ORDER_ACCESS_SECRET }, 'mock', 'b2c')).toThrow(/TERMS_VERSION/);
  });
});
