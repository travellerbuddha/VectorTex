import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Opt-in Nuitee SANDBOX evidence runs (never CI): the real payment component, paid with Stripe's public test card.
 * Needs NUITEE_API_KEY with NUITEE_KEY_ENVIRONMENT=sandbox, TEST_DATABASE_URL (disposable; its core schema is dropped)
 * and a built app (`next build`). Bookings made here are cancelled at the end of each test.
 */
const key = process.env.NUITEE_API_KEY ?? '';
if (key === '' || process.env.NUITEE_KEY_ENVIRONMENT !== 'sandbox') {
  throw new Error('Sandbox E2E needs NUITEE_API_KEY with NUITEE_KEY_ENVIRONMENT=sandbox (never a production key)');
}
const port = Number(process.env.SANDBOX_E2E_PORT ?? 3200);
const preinstalled = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = existsSync(preinstalled) ? preinstalled : undefined;
// Behind an egress proxy the browser reaches the provider through it, but our local site directly. Playwright sends
// loopback through the proxy unless this is set.
const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const proxy = proxyServer ? { server: proxyServer, bypass: '127.0.0.1,localhost' } : undefined;
if (proxy) process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = '1';

export default defineConfig({
  testDir: './e2e-sandbox',
  testMatch: '**/*.sandbox.spec.ts',
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath }, proxy },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath }, proxy } },
    // The provider's payment component at the narrowest supported width (site-flow only).
    { name: 'mobile-320', testMatch: '**/site-flow.sandbox.spec.ts', use: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, launchOptions: { executablePath }, proxy } },
  ],
  webServer: {
    command: `npx next start --port ${port} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}/tr/terms`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: 'development',
      PROVIDER_ENV: 'sandbox',
      ALLOW_MOCK_ADAPTERS: 'false',
      PAYLOAD_ENABLED: 'false',
      ENABLED_PROVIDERS: 'nuitee',
      NUITEE_API_KEY: key,
      NUITEE_KEY_ENVIRONMENT: 'sandbox',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15',
      ORDER_ACCESS_SECRET: 'sandbox-e2e-only-secret-0123456789abcdef',
      TERMS_VERSION: 'sandbox-e2e-terms-1',
      POLICY_ID: 'b2c',
      SALE_CURRENCIES: process.env.SANDBOX_SITE_CURRENCIES ?? 'EUR',
      // Sandbox suggested selling prices are synthetic and always above the price, so rate parity would hide every
      // offer (settings.ts); the switch is refused outside sandbox.
      SANDBOX_SKIP_RATE_PARITY: 'true',
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      // Node's fetch honours HTTPS_PROXY only when asked to.
      NODE_USE_ENV_PROXY: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
