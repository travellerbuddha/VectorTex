import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type CoreDb = NodePgDatabase<typeof schema>;

export interface CoreDatabase {
  pool: pg.Pool;
  db: CoreDb;
  close(): Promise<void>;
}

// int8 stays a string at the driver level; Drizzle maps bigint columns (mode 'bigint') to BigInt.
export function createCoreDatabase(url: string, opts: { max?: number; applicationName?: string } = {}): CoreDatabase {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10, application_name: opts.applicationName ?? 'texholiday-core' });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { pool, db, close: () => pool.end() };
}
