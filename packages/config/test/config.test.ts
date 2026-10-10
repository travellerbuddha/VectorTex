import { describe, expect, it } from 'vitest';
import { ConfigError, describeConfig, loadConfig, looksLikePlaceholder } from '../src/index';

const strong = (label: string) => `${label}-9f3c1a7be2d84c06a5e1f0b7c3d9e2a1`;

const productionEnv = (): Record<string, string> => ({
  APP_ENV: 'production',
  DATABASE_URL: 'postgres://core_app:Zx81kq@db.internal:5432/texholiday',
  REDIS_URL: 'rediss://kv.internal:6379',
  PAYLOAD_SECRET: strong('payload'),
  ENABLED_PROVIDERS: 'iyzico,nuitee,welcome_pickups',
  IYZICO_API_KEY: strong('iyz-api'),
  IYZICO_SECRET_KEY: strong('iyz-secret'),
  NUITEE_API_KEY: strong('nuitee'),
  NUITEE_KEY_ENVIRONMENT: 'production',
  WELCOME_API_KEY: strong('welcome'),
});

function issuesOf(env: Record<string, string | undefined>) {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).issues;
  }
  return [];
}

describe('loadConfig (P02 fail-fast)', () => {
  it('accepts a complete production configuration and pins production hosts', () => {
    const cfg = loadConfig(productionEnv());
    expect(cfg.providerEnvironment).toBe('production');
    expect(cfg.iyzico?.baseUrl).toBe('https://api.iyzipay.com');
    expect(cfg.welcome?.baseUrl).toBe('https://api.welcomepickups.com');
    expect(cfg.nuitee?.bookBaseUrl).toBe('https://book.liteapi.travel/v3.0');
  });

  it.each(['', '   ', 'changeme', 'xxxxxxxxxxxxxxxxxxxx', 'your-api-key', '<secret>', 'aaaaaaaaaaaaaaaaaaaaaaaa'])(
    'refuses empty/placeholder secret %j in production',
    (value) => {
      const env = { ...productionEnv(), IYZICO_SECRET_KEY: value };
      const issues = issuesOf(env);
      expect(issues.map((i) => i.variable)).toContain('IYZICO_SECRET_KEY');
    },
  );

  it('never includes secret values in the error message', () => {
    const leaked = 'short-but-real';
    const env = { ...productionEnv(), NUITEE_API_KEY: leaked };
    try {
      loadConfig(env);
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(leaked);
      expect((err as ConfigError).issues).toContainEqual({ variable: 'NUITEE_API_KEY', rule: 'shorter than 16 characters' });
    }
  });

  it('refuses mock adapters in production', () => {
    const issues = issuesOf({ ...productionEnv(), ALLOW_MOCK_ADAPTERS: 'true' });
    expect(issues.map((i) => i.variable)).toContain('ALLOW_MOCK_ADAPTERS');
  });

  it('refuses a sandbox iyzico host in production', () => {
    const issues = issuesOf({ ...productionEnv(), IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com' });
    expect(issues).toContainEqual({ variable: 'IYZICO_BASE_URL', rule: 'must be the production host' });
  });

  it('refuses a Nuitee key declared for another environment', () => {
    const issues = issuesOf({ ...productionEnv(), NUITEE_KEY_ENVIRONMENT: 'sandbox' });
    expect(issues).toContainEqual({ variable: 'NUITEE_KEY_ENVIRONMENT', rule: 'must match PROVIDER_ENV' });
  });

  it('refuses staging talking to production providers', () => {
    const issues = issuesOf({ ...productionEnv(), APP_ENV: 'staging', PROVIDER_ENV: 'production' });
    expect(issues.map((i) => i.variable)).toContain('PROVIDER_ENV');
  });

  it('refuses a local database in production', () => {
    const issues = issuesOf({ ...productionEnv(), DATABASE_URL: 'postgres://u:p@localhost:5432/x' });
    expect(issues).toContainEqual({ variable: 'DATABASE_URL', rule: 'production must not use a local database' });
  });

  it('allows labelled mock providers in development only when explicitly enabled', () => {
    expect(issuesOf({ APP_ENV: 'development', DATABASE_URL: 'postgres://a:b@localhost/x', REDIS_URL: 'redis://localhost', PAYLOAD_ENABLED: 'false' })).toContainEqual({
      variable: 'ALLOW_MOCK_ADAPTERS',
      rule: 'PROVIDER_ENV=mock requires ALLOW_MOCK_ADAPTERS=true',
    });
    const cfg = loadConfig({
      APP_ENV: 'development',
      ALLOW_MOCK_ADAPTERS: 'true',
      DATABASE_URL: 'postgres://a:b@localhost/x',
      REDIS_URL: 'redis://localhost',
      PAYLOAD_ENABLED: 'false',
      ENABLED_PROVIDERS: 'iyzico',
    });
    expect(cfg.providerEnvironment).toBe('mock');
    expect(cfg.iyzico).toBeNull();
  });

  it('describeConfig redacts every secret', () => {
    const text = JSON.stringify(describeConfig(loadConfig(productionEnv())));
    for (const value of Object.values(productionEnv())) {
      if (value.length > 20) expect(text).not.toContain(value);
    }
  });

  it('placeholder detector keeps real-looking values', () => {
    expect(looksLikePlaceholder(strong('x'))).toBe(false);
    expect(looksLikePlaceholder('TODO')).toBe(true);
  });
});
