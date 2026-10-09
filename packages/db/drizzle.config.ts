import { defineConfig } from 'drizzle-kit';

// Drizzle manages only the `core` schema; Payload manages `cms` (ADR-0003).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  schemaFilter: ['core'],
  migrations: { schema: 'core', table: '__drizzle_migrations' },
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost/texholiday_dev' },
});
