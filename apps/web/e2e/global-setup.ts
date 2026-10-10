import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { adminSettingsFromEnv, base32Decode, hotp, StaffAuthService, totpStep } from '@texholiday/admin';
import { createCoreDatabase, migrateCore, PermissionRepository, PolicyRepository } from '@texholiday/db';
import { E2E_ADMIN_PASSWORD, E2E_PAYLOAD_SECRET, E2E_STAFF_MFA_KEY } from './keys';

/**
 * Fresh core schema + an approved TEST pricing policy (10% provider API margin on hotels and flights) + /yonetim accounts. These are test
 * inputs only: real margins are entered and approved by finance users (G06).
 * Setup links for the admin tests (one account per Playwright project, links are single-use) are passed to the
 * tests through E2E_SETUP_TOKEN_<project>.
 */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('E2E tests need TEST_DATABASE_URL (disposable database)');
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS core CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS cms CASCADE');
  await admin.end();
  await migrateCore(url);
  // The CMS schema comes from its committed migrations, as in production (pnpm cms:migrate).
  execFileSync('npx', ['payload', 'migrate'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url, PAYLOAD_SECRET: E2E_PAYLOAD_SECRET, PAYLOAD_CONFIG_PATH: 'src/payload.config.ts', APP_ENV: 'test' },
    stdio: 'pipe',
  });
  if (process.env.E2E_MAIL_DIR) rmSync(process.env.E2E_MAIL_DIR, { recursive: true, force: true });
  // Last TOTP step used per account, shared across worker restarts (a code is accepted once per account).
  process.env.E2E_STEP_FILE = join(tmpdir(), `texholiday-e2e-steps-${process.pid}.json`);
  writeFileSync(process.env.E2E_STEP_FILE, '{}');
  const { db, close } = createCoreDatabase(url, { max: 2 });
  try {
    const auth = new StaffAuthService(db, adminSettingsFromEnv({ STAFF_MFA_KEY: E2E_STAFF_MFA_KEY }));
    const boot = await auth.bootstrapOwner({ email: 'owner@e2e.test', displayName: 'E2E Owner' });
    const owner = { kind: 'STAFF' as const, id: boot.staffId };
    process.env['E2E_SETUP_TOKEN_desktop'] = boot.token;
    process.env['E2E_SETUP_TOKEN_mobile-320'] = (await auth.invite(owner, { email: 'mobile@e2e.test', displayName: 'E2E Mobile' })).token;
    const perms = new PermissionRepository(db);
    // Fully set-up panel accounts (password + enrolled authenticator) for the admin tests; secrets via env.
    const account = async (key: string, email: string, displayName: string, role: 'OWNER_ADMIN' | 'FINANCE' | 'FINANCE_APPROVER' | null) => {
      const inv = await auth.invite(owner, { email, displayName });
      const setup = await auth.completeSetup(inv.token, E2E_ADMIN_PASSWORD);
      const { secret } = await auth.beginEnrollment(setup.token);
      await auth.completeEnrollment(setup.token, hotp(base32Decode(secret), totpStep(new Date())));
      if (role) await perms.grantRole(inv.staffId, role, owner);
      process.env[`E2E_SECRET_${key}`] = secret;
      return inv.staffId;
    };
    await account('admin', 'admin@e2e.test', 'E2E Admin', 'OWNER_ADMIN');
    await account('finance', 'finance@e2e.test', 'E2E Finans', 'FINANCE');
    await account('approver', 'approver@e2e.test', 'E2E Onaycı', 'FINANCE_APPROVER');
    // Content editor without the right to publish (P06).
    await perms.grant(await account('editor', 'editor@e2e.test', 'E2E Editör', null), 'content.edit', owner);
    await perms.grantRole('e2e-finance', 'FINANCE', owner);
    await perms.grantRole('e2e-approver', 'FINANCE_APPROVER', owner);
    const policies = new PolicyRepository(db);
    const v = await policies.createDraft(
      'PRICING',
      'b2c',
      {
        rounding: 'HALF_EVEN',
        rules: [
          { productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 },
          { productType: 'FLIGHT', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 },
        ],
        serviceFees: [],
        fx: null,
        allowBelowSspInOpaquePackage: false,
      },
      { kind: 'STAFF', id: 'e2e-finance' },
      'E2E test policy',
    );
    await policies.approve('PRICING', 'b2c', v.version, { kind: 'STAFF', id: 'e2e-approver' });
  } finally {
    await close();
  }
}
