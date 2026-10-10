import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "cms"."enum_tracking_settings_consent_mode" AS ENUM('BASIC', 'ADVANCED');
  CREATE TABLE "cms"."tracking_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"gtm_container_id" varchar,
  	"ga4_measurement_id" varchar,
  	"consent_mode" "cms"."enum_tracking_settings_consent_mode" DEFAULT 'BASIC' NOT NULL,
  	"search_console_verification" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "cms"."tracking_settings_locales" (
  	"banner_text" varchar,
  	"privacy_url" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  ALTER TABLE "cms"."tracking_settings_locales" ADD CONSTRAINT "tracking_settings_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."tracking_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "tracking_settings_locales_locale_parent_id_unique" ON "cms"."tracking_settings_locales" USING btree ("_locale","_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "cms"."tracking_settings" CASCADE;
  DROP TABLE "cms"."tracking_settings_locales" CASCADE;
  DROP TYPE "cms"."enum_tracking_settings_consent_mode";`)
}
