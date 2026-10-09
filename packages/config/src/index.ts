import { z } from 'zod';

export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Which upstream environment provider adapters talk to. Mock is never allowed in production. */
export type ProviderEnvironment = 'mock' | 'sandbox' | 'production';

export const PROVIDER_IDS = ['iyzico', 'nuitee', 'welcome_pickups'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ConfigIssue {
  /** Environment variable name. Never the value. */
  variable: string;
  rule: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];
  constructor(issues: readonly ConfigIssue[]) {
    super(`Invalid configuration: ${issues.map((i) => `${i.variable} (${i.rule})`).join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export interface IyzicoConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
}

export interface NuiteeConfig {
  apiKey: string;
  keyEnvironment: Exclude<ProviderEnvironment, 'mock'>;
  searchBaseUrl: string;
  bookBaseUrl: string;
}

export interface WelcomeConfig {
  apiKey: string;
  baseUrl: string;
}

export interface AppConfig {
  appEnv: AppEnv;
  providerEnvironment: ProviderEnvironment;
  allowMockAdapters: boolean;
  database: { url: string };
  redis: { url: string };
  payload: { secret: string } | null;
  iyzico: IyzicoConfig | null;
  nuitee: NuiteeConfig | null;
  welcome: WelcomeConfig | null;
}

/** Hosts named in the specification (§8, §11) and the official iyzico client (sources.lock.json). */
export const PROVIDER_HOSTS = {
  iyzico: { sandbox: 'https://sandbox-api.iyzipay.com', production: 'https://api.iyzipay.com' },
  nuitee: { search: 'https://api.liteapi.travel/v3.0', book: 'https://book.liteapi.travel/v3.0' },
  welcome_pickups: { sandbox: 'https://api.stgazure.welcomd.com', production: 'https://api.welcomepickups.com' },
} as const;

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^(change[-_ ]?me|todo|tbd|fixme|dummy|placeholder|example|sample|test|testing|secret|password|default|none|null|undefined)$/i,
  /^x+$/i,
  /^your[-_ ]/i,
  /[<>]/,
  /^(.)\1+$/,
];

export function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  return v.length === 0 || PLACEHOLDER_PATTERNS.some((re) => re.test(v));
}

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  PROVIDER_ENV: z.enum(['mock', 'sandbox', 'production']).optional(),
  ALLOW_MOCK_ADAPTERS: z.enum(['true', 'false']).optional(),
  ENABLED_PROVIDERS: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  PAYLOAD_SECRET: z.string().optional(),
  IYZICO_API_KEY: z.string().optional(),
  IYZICO_SECRET_KEY: z.string().optional(),
  IYZICO_BASE_URL: z.string().optional(),
  NUITEE_API_KEY: z.string().optional(),
  NUITEE_KEY_ENVIRONMENT: z.enum(['sandbox', 'production']).optional(),
  WELCOME_API_KEY: z.string().optional(),
  WELCOME_BASE_URL: z.string().optional(),
  PAYLOAD_ENABLED: z.enum(['true', 'false']).optional(),
});

type Raw = z.infer<typeof rawSchema>;

const STRICT_ENVS: ReadonlySet<AppEnv> = new Set(['staging', 'production']);

/**
 * Loads and validates configuration. Throws ConfigError listing variable names only.
 * In staging/production every enabled secret must be present and must not look like a placeholder;
 * mock adapters are refused in production.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => ({ variable: String(i.path[0] ?? 'unknown'), rule: 'invalid value' })),
    );
  }
  const raw: Raw = parsed.data;
  const issues: ConfigIssue[] = [];
  const appEnv = raw.APP_ENV;
  const strict = STRICT_ENVS.has(appEnv);

  const providerEnvironment: ProviderEnvironment =
    raw.PROVIDER_ENV ?? (appEnv === 'production' ? 'production' : appEnv === 'staging' ? 'sandbox' : 'mock');
  const allowMockAdapters = raw.ALLOW_MOCK_ADAPTERS === 'true';

  if (appEnv === 'production') {
    if (providerEnvironment !== 'production') issues.push({ variable: 'PROVIDER_ENV', rule: 'must be production when APP_ENV=production' });
    if (allowMockAdapters) issues.push({ variable: 'ALLOW_MOCK_ADAPTERS', rule: 'mock adapters are forbidden in production' });
  }
  if (appEnv === 'staging' && providerEnvironment === 'production') {
    issues.push({ variable: 'PROVIDER_ENV', rule: 'staging must not talk to production providers' });
  }
  if (providerEnvironment === 'mock' && !allowMockAdapters) {
    issues.push({ variable: 'ALLOW_MOCK_ADAPTERS', rule: 'PROVIDER_ENV=mock requires ALLOW_MOCK_ADAPTERS=true' });
  }

  const secret = (variable: keyof Raw, opts: { minLength: number }): string | null => {
    const value = raw[variable];
    if (value === undefined || value.trim() === '') {
      issues.push({ variable, rule: 'required' });
      return null;
    }
    if (strict && looksLikePlaceholder(value)) {
      issues.push({ variable, rule: 'placeholder value refused' });
      return null;
    }
    if (strict && value.length < opts.minLength) {
      issues.push({ variable, rule: `shorter than ${opts.minLength} characters` });
      return null;
    }
    return value;
  };

  const databaseUrl = secret('DATABASE_URL', { minLength: 12 });
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) issues.push({ variable: 'DATABASE_URL', rule: 'must be a postgres URL' });
  if (databaseUrl && appEnv === 'production' && /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
    issues.push({ variable: 'DATABASE_URL', rule: 'production must not use a local database' });
  }
  const redisUrl = secret('REDIS_URL', { minLength: 8 });
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) issues.push({ variable: 'REDIS_URL', rule: 'must be a redis URL' });

  const payloadEnabled = raw.PAYLOAD_ENABLED !== 'false';
  const payloadSecret = payloadEnabled ? secret('PAYLOAD_SECRET', { minLength: 32 }) : null;

  const enabled = new Set(
    (raw.ENABLED_PROVIDERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const p of enabled) {
    if (!(PROVIDER_IDS as readonly string[]).includes(p)) issues.push({ variable: 'ENABLED_PROVIDERS', rule: `unknown provider id` });
  }

  let iyzico: IyzicoConfig | null = null;
  if (enabled.has('iyzico') && providerEnvironment !== 'mock') {
    const apiKey = secret('IYZICO_API_KEY', { minLength: 16 });
    const secretKey = secret('IYZICO_SECRET_KEY', { minLength: 16 });
    const expected = providerEnvironment === 'production' ? PROVIDER_HOSTS.iyzico.production : PROVIDER_HOSTS.iyzico.sandbox;
    const baseUrl = raw.IYZICO_BASE_URL ?? expected;
    // Key format is not used to infer the environment (no documented prefix); the host decides it.
    if (baseUrl !== expected) issues.push({ variable: 'IYZICO_BASE_URL', rule: `must be the ${providerEnvironment} host` });
    if (apiKey && secretKey) iyzico = { apiKey, secretKey, baseUrl };
  }

  let nuitee: NuiteeConfig | null = null;
  if (enabled.has('nuitee') && providerEnvironment !== 'mock') {
    const apiKey = secret('NUITEE_API_KEY', { minLength: 16 });
    const keyEnvironment = raw.NUITEE_KEY_ENVIRONMENT;
    if (!keyEnvironment) issues.push({ variable: 'NUITEE_KEY_ENVIRONMENT', rule: 'required (sandbox|production)' });
    else if (keyEnvironment !== providerEnvironment) {
      issues.push({ variable: 'NUITEE_KEY_ENVIRONMENT', rule: 'must match PROVIDER_ENV' });
    }
    if (apiKey && keyEnvironment && keyEnvironment === providerEnvironment) {
      nuitee = { apiKey, keyEnvironment, searchBaseUrl: PROVIDER_HOSTS.nuitee.search, bookBaseUrl: PROVIDER_HOSTS.nuitee.book };
    }
  }

  let welcome: WelcomeConfig | null = null;
  if (enabled.has('welcome_pickups') && providerEnvironment !== 'mock') {
    const apiKey = secret('WELCOME_API_KEY', { minLength: 16 });
    const expected =
      providerEnvironment === 'production' ? PROVIDER_HOSTS.welcome_pickups.production : PROVIDER_HOSTS.welcome_pickups.sandbox;
    const baseUrl = raw.WELCOME_BASE_URL ?? expected;
    if (baseUrl !== expected) issues.push({ variable: 'WELCOME_BASE_URL', rule: `must be the ${providerEnvironment} host` });
    if (apiKey) welcome = { apiKey, baseUrl };
  }

  if (issues.length > 0) throw new ConfigError(issues);

  return {
    appEnv,
    providerEnvironment,
    allowMockAdapters,
    database: { url: databaseUrl as string },
    redis: { url: redisUrl as string },
    payload: payloadSecret ? { secret: payloadSecret } : null,
    iyzico,
    nuitee,
    welcome,
  };
}

/** Redacts known secret-bearing keys for logging. Values are never logged, only presence. */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  return {
    appEnv: config.appEnv,
    providerEnvironment: config.providerEnvironment,
    allowMockAdapters: config.allowMockAdapters,
    database: '[set]',
    redis: '[set]',
    payload: config.payload ? '[set]' : null,
    iyzico: config.iyzico ? { baseUrl: config.iyzico.baseUrl, apiKey: '[redacted]', secretKey: '[redacted]' } : null,
    nuitee: config.nuitee ? { keyEnvironment: config.nuitee.keyEnvironment, apiKey: '[redacted]' } : null,
    welcome: config.welcome ? { baseUrl: config.welcome.baseUrl, apiKey: '[redacted]' } : null,
  };
}
