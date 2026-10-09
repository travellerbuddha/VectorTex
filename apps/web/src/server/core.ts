import { loadConfig } from '@texholiday/config';
import { createCoreDatabase, type CoreDatabase } from '@texholiday/db';

// Next bundles pages, actions and route handlers separately: one pool per server process lives on globalThis.
const holder = globalThis as typeof globalThis & { __texholidayCore?: CoreDatabase };

/** The core database pool of this server process (shared by the customer site and /yonetim). */
export function coreDatabase(): CoreDatabase {
  holder.__texholidayCore ??= createCoreDatabase(loadConfig(process.env).database.url, { applicationName: 'texholiday-web' });
  return holder.__texholidayCore;
}
