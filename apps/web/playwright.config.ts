import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { E2E_STAFF_MFA_KEY } from './e2e/keys';

/**
 * End-to-end tests of the customer hotel flow in the MOCK environment (MockHotelConnector, no provider involved).
 * Needs TEST_DATABASE_URL (disposable; its core schema is dropped) and a built app (`next build`).
 */
const port = Number(process.env.E2E_PORT ?? 3100);
// Use the preinstalled Chromium when present (cloud dev containers); CI installs Playwright's own browser.
const preinstalled = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', launchOptions: { executablePath } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } },
    { name: 'mobile-320', use: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, launchOptions: { executablePath } } },
  ],
  webServer: {
    command: `npx next start --port ${port} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}/api/v1/places?q=an`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: 'development',
      PROVIDER_ENV: 'mock',
      ALLOW_MOCK_ADAPTERS: 'true',
      PAYLOAD_ENABLED: 'false',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15',
      ORDER_ACCESS_SECRET: 'e2e-only-secret-0123456789abcdef-xyz',
      STAFF_MFA_KEY: E2E_STAFF_MFA_KEY,
      // Every test signs in from 127.0.0.1; the per-IP brake is tested separately.
      STAFF_IP_ATTEMPTS_PER_5_MIN: '10000',
      TERMS_VERSION: 'e2e-terms-1',
      POLICY_ID: 'b2c',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
