import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createCoreDatabase } from './client';

export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrateCore(url: string): Promise<void> {
  const { db, close } = createCoreDatabase(url, { max: 1, applicationName: 'texholiday-core-migrate' });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema: 'core', migrationsTable: '__drizzle_migrations' });
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  await migrateCore(url);
  console.log('core migrations applied');
}
