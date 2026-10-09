import pg from 'pg';
import { createCoreDatabase, migrateCore, PermissionRepository, PolicyRepository } from '@texholiday/db';

/**
 * Fresh core schema + an approved TEST pricing policy (10% provider API margin). These are test inputs only:
 * real margins are entered and approved by finance users (G06).
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
    const perms = new PermissionRepository(db);
    await perms.bootstrapManager('e2e-owner');
    await perms.grantRole('e2e-finance', 'FINANCE', { kind: 'STAFF', id: 'e2e-owner' });
    await perms.grantRole('e2e-approver', 'FINANCE_APPROVER', { kind: 'STAFF', id: 'e2e-owner' });
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
