import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { s3Storage } from '@payloadcms/storage-s3';
import { en } from '@payloadcms/translations/languages/en';
import { tr } from '@payloadcms/translations/languages/tr';
import { buildConfig } from 'payload';
import { CMS_USERS } from './payload/access';
import { Campaigns, Destinations, Faqs, Media, Pages, Posts } from './payload/collections/content';
import { HotelListSettings, HotelLists } from './payload/collections/hotel-lists';
import { Redirects } from './payload/collections/redirects';
import { CmsUsers } from './payload/collections/users';
import { Footer, Navigation } from './payload/globals/site';
import { TrackingSettings } from './payload/globals/tracking';
import { jobsConfig } from './payload/scheduled-publish';

/**
 * Payload CMS (P06, ADR-0003): site and editorial content only, in the `cms` schema; bookings and money stay in `core`.
 * Admin at /yonetim/icerik behind the staff sign-in (no separate CMS password). Values are read from the environment
 * here and validated at start (PAYLOAD_SECRET by @texholiday/config; media storage in onInit).
 */
const dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const strict = env.APP_ENV === 'staging' || env.APP_ENV === 'production';

/** Media files: S3 (spec §6: content media) when configured; local disk only for development and tests. */
const s3 =
  env.CMS_S3_BUCKET && env.CMS_S3_REGION && env.CMS_S3_ACCESS_KEY_ID && env.CMS_S3_SECRET_ACCESS_KEY
    ? s3Storage({
        collections: { media: true },
        bucket: env.CMS_S3_BUCKET,
        config: {
          region: env.CMS_S3_REGION,
          ...(env.CMS_S3_ENDPOINT ? { endpoint: env.CMS_S3_ENDPOINT, forcePathStyle: true } : {}),
          credentials: { accessKeyId: env.CMS_S3_ACCESS_KEY_ID, secretAccessKey: env.CMS_S3_SECRET_ACCESS_KEY },
        },
      })
    : null;

export default buildConfig({
  secret: env.PAYLOAD_SECRET ?? '',
  serverURL: env.PUBLIC_BASE_URL?.replace(/\/$/, '') || undefined,
  telemetry: false,
  routes: { admin: '/yonetim/icerik', api: '/api/cms' },
  admin: {
    user: CMS_USERS,
    importMap: { baseDir: dirname, importMapFile: path.resolve(dirname, 'app/(payload)/yonetim/icerik/importMap.js') },
    meta: { titleSuffix: ' · TexHoliday İçerik' },
    dateFormat: 'dd.MM.yyyy HH:mm',
  },
  i18n: { supportedLanguages: { tr, en }, fallbackLanguage: 'tr' },
  localization: {
    locales: [
      { code: 'tr', label: 'Türkçe' },
      { code: 'en', label: 'English' },
    ],
    defaultLocale: 'tr',
    fallback: true,
  },
  editor: lexicalEditor(),
  collections: [
    Pages,
    Destinations,
    Posts,
    Faqs,
    Campaigns,
    HotelLists,
    Redirects,
    // Local files (development/test) live outside the source tree; S3 replaces them when configured.
    { ...Media, upload: { ...(Media.upload as object), staticDir: env.CMS_MEDIA_DIR || path.resolve(dirname, '../.media') } },
    CmsUsers,
  ],
  globals: [Navigation, Footer, HotelListSettings, TrackingSettings],
  // Scheduled publish/unpublish of drafts (ADR-0020).
  jobs: jobsConfig,
  graphQL: { disable: true },
  // The site reads documents with runtime checks; no generated type file is kept in the repository.
  typescript: { autoGenerate: false },
  upload: { limits: { fileSize: 10_000_000 } },
  db: postgresAdapter({
    // A dedicated role without rights on `core` can be given (PAYLOAD_DATABASE_URL); see docs/adr/0003.
    pool: { connectionString: env.PAYLOAD_DATABASE_URL || env.DATABASE_URL || '' },
    schemaName: 'cms',
    // Schema changes only through committed migrations (pnpm cms:migrate), never by push.
    push: false,
    migrationDir: path.resolve(dirname, 'payload/migrations'),
  }),
  plugins: s3 ? [s3] : [],
  onInit: async () => {
    if (strict && !s3) throw new Error('CMS media needs S3 outside development/test (CMS_S3_BUCKET, CMS_S3_REGION, CMS_S3_ACCESS_KEY_ID, CMS_S3_SECRET_ACCESS_KEY)');
  },
});
