import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cms"."tracking_settings" ADD COLUMN "yandex_verification" varchar;
  ALTER TABLE "cms"."tracking_settings" ADD COLUMN "meta_domain_verification" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cms"."tracking_settings" DROP COLUMN "yandex_verification";
  ALTER TABLE "cms"."tracking_settings" DROP COLUMN "meta_domain_verification";`)
}
