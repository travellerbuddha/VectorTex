import pg from 'pg';
import { adminSettingsFromEnv, StaffAuthService } from '@texholiday/admin';
import { createCoreDatabase, migrateCore, PermissionRepository, PolicyRepository } from '@texholiday/db';
import { E2E_STAFF_MFA_KEY } from './keys';

/**
 * Fresh core schema + an approved TEST pricing policy (10% provider API margin) + /yonetim accounts. These are test
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
  await admin.end();
  await migrateCore(url);
  const { db, close } = createCoreDatabase(url, { max: 2 });
  try {
    const auth = new StaffAuthService(db, adminSettingsFromEnv({ STAFF_MFA_KEY: E2E_STAFF_MFA_KEY }));
    const boot = await auth.bootstrapOwner({ email: 'owner@e2e.test', displayName: 'E2E Owner' });
    const owner = { kind: 'STAFF' as const, id: boot.staffId };
    process.env['E2E_SETUP_TOKEN_desktop'] = boot.token;
    process.env['E2E_SETUP_TOKEN_mobile-320'] = (await auth.invite(owner, { email: 'mobile@e2e.test', displayName: 'E2E Mobile' })).token;
    const perms = new PermissionRepository(db);
    await perms.grantRole('e2e-finance', 'FINANCE', owner);
    await perms.grantRole('e2e-approver', 'FINANCE_APPROVER', owner);
    const policies = new PolicyRepository(db);
    const v = await policies.createDraft(
      'PRICING',
      'b2c',
      { rounding: 'HALF_EVEN', rules: [{ productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: 1000 }], serviceFees: [], fx: null, allowBelowSspInOpaquePackage: false },
      { kind: 'STAFF', id: 'e2e-finance' },
      'E2E test policy',
    );
    await policies.approve('PRICING', 'b2c', v.version, { kind: 'STAFF', id: 'e2e-approver' });
  } finally {
    await close();
  }
}
