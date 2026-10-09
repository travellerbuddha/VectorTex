import { fileURLToPath } from 'node:url';
import { createCoreDatabase } from './client';
import { PermissionRepository } from './permission-repository';

/**
 * First-time setup (ADR-0007): makes one staff member the first permissions manager. Works only while nobody holds
 * `permissions.manage`; after that, permissions are granted on the admin permissions screen.
 * Usage: DATABASE_URL=... pnpm --filter @texholiday/db permissions:bootstrap <staffId>
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  const staffId = process.argv[2];
  if (!url || !staffId) {
    console.error('Usage: DATABASE_URL=... pnpm --filter @texholiday/db permissions:bootstrap <staffId>');
    process.exit(1);
  }
  const { db, close } = createCoreDatabase(url, { max: 1, applicationName: 'texholiday-permissions-bootstrap' });
  try {
    await new PermissionRepository(db).bootstrapManager(staffId);
    console.log(`${staffId} now holds permissions.manage`);
  } finally {
    await close();
  }
}
