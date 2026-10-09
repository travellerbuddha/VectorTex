import { fileURLToPath } from 'node:url';
import { createCoreDatabase } from '@texholiday/db';
import { adminSettingsFromEnv } from './settings';
import { StaffAuthService } from './staff-auth';

/**
 * First-time setup (ADR-0010): creates the first /yonetim account (Owner/Admin preset, permissions.manage included)
 * and prints its one-time setup link. Works only while no staff account exists; everyone else is invited from the
 * panel. Usage: DATABASE_URL=... STAFF_MFA_KEY=... PUBLIC_BASE_URL=https://... pnpm staff:bootstrap <email> "<Ad Soyad>"
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [email, displayName] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url || !email || !displayName) {
    console.error('Usage: DATABASE_URL=... STAFF_MFA_KEY=... PUBLIC_BASE_URL=... pnpm staff:bootstrap <email> "<Name Surname>"');
    process.exit(1);
  }
  const { db, close } = createCoreDatabase(url, { max: 1, applicationName: 'texholiday-staff-bootstrap' });
  try {
    const out = await new StaffAuthService(db, adminSettingsFromEnv(process.env)).bootstrapOwner({ email, displayName });
    const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
    console.log(`Account created for ${email}. Open this link once to set the password and the authenticator (valid until ${out.expiresAt}):`);
    console.log(`${base}/yonetim/kurulum/${out.token}`);
  } finally {
    await close();
  }
}
