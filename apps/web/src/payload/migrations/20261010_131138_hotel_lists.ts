import { type MigrateDownArgs, type MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "cms"."enum_hotel_lists_stars" AS ENUM('1', '2', '3', '4', '5');
  CREATE TYPE "cms"."enum_hotel_lists_board_type" AS ENUM('ANY', 'AI', 'FB', 'HB', 'BI', 'RO');
  CREATE TYPE "cms"."enum_hotel_lists_sort" AS ENUM('TOP_PICKS', 'PRICE', 'MANUAL');
  CREATE TYPE "cms"."enum_hotel_lists_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__hotel_lists_v_version_stars" AS ENUM('1', '2', '3', '4', '5');
  CREATE TYPE "cms"."enum__hotel_lists_v_version_board_type" AS ENUM('ANY', 'AI', 'FB', 'HB', 'BI', 'RO');
  CREATE TYPE "cms"."enum__hotel_lists_v_version_sort" AS ENUM('TOP_PICKS', 'PRICE', 'MANUAL');
  CREATE TYPE "cms"."enum__hotel_lists_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__hotel_lists_v_published_locale" AS ENUM('tr', 'en');
  CREATE TABLE "cms"."hotel_lists_places" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"place_id" varchar,
  	"name" varchar,
  	"address" varchar
  );
  
  CREATE TABLE "cms"."hotel_lists_stars" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "cms"."enum_hotel_lists_stars",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "cms"."hotel_lists_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question" varchar,
  	"answer" varchar
  );
  
  CREATE TABLE "cms"."hotel_lists" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"board_type" "cms"."enum_hotel_lists_board_type" DEFAULT 'ANY',
  	"sort" "cms"."enum_hotel_lists_sort" DEFAULT 'TOP_PICKS',
  	"max_items" numeric DEFAULT 30,
  	"hero_image_id" integer,
  	"seo_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "cms"."enum_hotel_lists_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "cms"."hotel_lists_locales" (
  	"title" varchar,
  	"slug" varchar,
  	"intro" varchar,
  	"body" jsonb,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."hotel_lists_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "cms"."_hotel_lists_v_version_places" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"place_id" varchar,
  	"name" varchar,
  	"address" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "cms"."_hotel_lists_v_version_stars" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "cms"."enum__hotel_lists_v_version_stars",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "cms"."_hotel_lists_v_version_faq" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"question" varchar,
  	"answer" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "cms"."_hotel_lists_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_board_type" "cms"."enum__hotel_lists_v_version_board_type" DEFAULT 'ANY',
  	"version_sort" "cms"."enum__hotel_lists_v_version_sort" DEFAULT 'TOP_PICKS',
  	"version_max_items" numeric DEFAULT 30,
  	"version_hero_image_id" integer,
  	"version_seo_image_id" integer,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "cms"."enum__hotel_lists_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"snapshot" boolean,
  	"published_locale" "cms"."enum__hotel_lists_v_published_locale",
  	"latest" boolean
  );
  
  CREATE TABLE "cms"."_hotel_lists_v_locales" (
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_intro" varchar,
  	"version_body" jsonb,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."_hotel_lists_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "cms"."hotel_list_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tr_currency" varchar,
  	"tr_nationality" varchar,
  	"en_currency" varchar,
  	"en_nationality" varchar,
  	"max_price_age_hours" numeric,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "hotel_lists_id" integer;
  ALTER TABLE "cms"."hotel_lists_places" ADD CONSTRAINT "hotel_lists_places_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."hotel_lists"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."hotel_lists_stars" ADD CONSTRAINT "hotel_lists_stars_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."hotel_lists"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."hotel_lists_faq" ADD CONSTRAINT "hotel_lists_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."hotel_lists"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."hotel_lists" ADD CONSTRAINT "hotel_lists_hero_image_id_media_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."hotel_lists" ADD CONSTRAINT "hotel_lists_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."hotel_lists_locales" ADD CONSTRAINT "hotel_lists_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."hotel_lists"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."hotel_lists_texts" ADD CONSTRAINT "hotel_lists_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."hotel_lists"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_hotel_lists_v_version_places" ADD CONSTRAINT "_hotel_lists_v_version_places_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_hotel_lists_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_hotel_lists_v_version_stars" ADD CONSTRAINT "_hotel_lists_v_version_stars_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."_hotel_lists_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_hotel_lists_v_version_faq" ADD CONSTRAINT "_hotel_lists_v_version_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_hotel_lists_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_hotel_lists_v" ADD CONSTRAINT "_hotel_lists_v_parent_id_hotel_lists_id_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."hotel_lists"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_hotel_lists_v" ADD CONSTRAINT "_hotel_lists_v_version_hero_image_id_media_id_fk" FOREIGN KEY ("version_hero_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_hotel_lists_v" ADD CONSTRAINT "_hotel_lists_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_hotel_lists_v_locales" ADD CONSTRAINT "_hotel_lists_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_hotel_lists_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_hotel_lists_v_texts" ADD CONSTRAINT "_hotel_lists_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."_hotel_lists_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "hotel_lists_places_order_idx" ON "cms"."hotel_lists_places" USING btree ("_order");
  CREATE INDEX "hotel_lists_places_parent_id_idx" ON "cms"."hotel_lists_places" USING btree ("_parent_id");
  CREATE INDEX "hotel_lists_stars_order_idx" ON "cms"."hotel_lists_stars" USING btree ("order");
  CREATE INDEX "hotel_lists_stars_parent_idx" ON "cms"."hotel_lists_stars" USING btree ("parent_id");
  CREATE INDEX "hotel_lists_faq_order_idx" ON "cms"."hotel_lists_faq" USING btree ("_order");
  CREATE INDEX "hotel_lists_faq_parent_id_idx" ON "cms"."hotel_lists_faq" USING btree ("_parent_id");
  CREATE INDEX "hotel_lists_faq_locale_idx" ON "cms"."hotel_lists_faq" USING btree ("_locale");
  CREATE INDEX "hotel_lists_hero_image_idx" ON "cms"."hotel_lists" USING btree ("hero_image_id");
  CREATE INDEX "hotel_lists_seo_seo_image_idx" ON "cms"."hotel_lists" USING btree ("seo_image_id");
  CREATE INDEX "hotel_lists_updated_at_idx" ON "cms"."hotel_lists" USING btree ("updated_at");
  CREATE INDEX "hotel_lists_created_at_idx" ON "cms"."hotel_lists" USING btree ("created_at");
  CREATE INDEX "hotel_lists__status_idx" ON "cms"."hotel_lists" USING btree ("_status");
  CREATE UNIQUE INDEX "hotel_lists_slug_idx" ON "cms"."hotel_lists_locales" USING btree ("slug","_locale");
  CREATE UNIQUE INDEX "hotel_lists_locales_locale_parent_id_unique" ON "cms"."hotel_lists_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "hotel_lists_texts_order_parent" ON "cms"."hotel_lists_texts" USING btree ("order","parent_id");
  CREATE INDEX "_hotel_lists_v_version_places_order_idx" ON "cms"."_hotel_lists_v_version_places" USING btree ("_order");
  CREATE INDEX "_hotel_lists_v_version_places_parent_id_idx" ON "cms"."_hotel_lists_v_version_places" USING btree ("_parent_id");
  CREATE INDEX "_hotel_lists_v_version_stars_order_idx" ON "cms"."_hotel_lists_v_version_stars" USING btree ("order");
  CREATE INDEX "_hotel_lists_v_version_stars_parent_idx" ON "cms"."_hotel_lists_v_version_stars" USING btree ("parent_id");
  CREATE INDEX "_hotel_lists_v_version_faq_order_idx" ON "cms"."_hotel_lists_v_version_faq" USING btree ("_order");
  CREATE INDEX "_hotel_lists_v_version_faq_parent_id_idx" ON "cms"."_hotel_lists_v_version_faq" USING btree ("_parent_id");
  CREATE INDEX "_hotel_lists_v_version_faq_locale_idx" ON "cms"."_hotel_lists_v_version_faq" USING btree ("_locale");
  CREATE INDEX "_hotel_lists_v_parent_idx" ON "cms"."_hotel_lists_v" USING btree ("parent_id");
  CREATE INDEX "_hotel_lists_v_version_version_hero_image_idx" ON "cms"."_hotel_lists_v" USING btree ("version_hero_image_id");
  CREATE INDEX "_hotel_lists_v_version_seo_version_seo_image_idx" ON "cms"."_hotel_lists_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_hotel_lists_v_version_version_updated_at_idx" ON "cms"."_hotel_lists_v" USING btree ("version_updated_at");
  CREATE INDEX "_hotel_lists_v_version_version_created_at_idx" ON "cms"."_hotel_lists_v" USING btree ("version_created_at");
  CREATE INDEX "_hotel_lists_v_version_version__status_idx" ON "cms"."_hotel_lists_v" USING btree ("version__status");
  CREATE INDEX "_hotel_lists_v_created_at_idx" ON "cms"."_hotel_lists_v" USING btree ("created_at");
  CREATE INDEX "_hotel_lists_v_updated_at_idx" ON "cms"."_hotel_lists_v" USING btree ("updated_at");
  CREATE INDEX "_hotel_lists_v_snapshot_idx" ON "cms"."_hotel_lists_v" USING btree ("snapshot");
  CREATE INDEX "_hotel_lists_v_published_locale_idx" ON "cms"."_hotel_lists_v" USING btree ("published_locale");
  CREATE INDEX "_hotel_lists_v_latest_idx" ON "cms"."_hotel_lists_v" USING btree ("latest");
  CREATE INDEX "_hotel_lists_v_version_version_slug_idx" ON "cms"."_hotel_lists_v_locales" USING btree ("version_slug","_locale");
  CREATE UNIQUE INDEX "_hotel_lists_v_locales_locale_parent_id_unique" ON "cms"."_hotel_lists_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_hotel_lists_v_texts_order_parent" ON "cms"."_hotel_lists_v_texts" USING btree ("order","parent_id");
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_hotel_lists_fk" FOREIGN KEY ("hotel_lists_id") REFERENCES "cms"."hotel_lists"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_hotel_lists_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("hotel_lists_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cms"."hotel_lists_places" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."hotel_lists_stars" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."hotel_lists_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."hotel_lists" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."hotel_lists_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."hotel_lists_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_hotel_lists_v_version_places" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_hotel_lists_v_version_stars" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_hotel_lists_v_version_faq" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_hotel_lists_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_hotel_lists_v_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."_hotel_lists_v_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cms"."hotel_list_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "cms"."hotel_lists_places" CASCADE;
  DROP TABLE "cms"."hotel_lists_stars" CASCADE;
  DROP TABLE "cms"."hotel_lists_faq" CASCADE;
  DROP TABLE "cms"."hotel_lists" CASCADE;
  DROP TABLE "cms"."hotel_lists_locales" CASCADE;
  DROP TABLE "cms"."hotel_lists_texts" CASCADE;
  DROP TABLE "cms"."_hotel_lists_v_version_places" CASCADE;
  DROP TABLE "cms"."_hotel_lists_v_version_stars" CASCADE;
  DROP TABLE "cms"."_hotel_lists_v_version_faq" CASCADE;
  DROP TABLE "cms"."_hotel_lists_v" CASCADE;
  DROP TABLE "cms"."_hotel_lists_v_locales" CASCADE;
  DROP TABLE "cms"."_hotel_lists_v_texts" CASCADE;
  DROP TABLE "cms"."hotel_list_settings" CASCADE;
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_hotel_lists_fk";
  
  DROP INDEX "cms"."payload_locked_documents_rels_hotel_lists_id_idx";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "hotel_lists_id";
  DROP TYPE "cms"."enum_hotel_lists_stars";
  DROP TYPE "cms"."enum_hotel_lists_board_type";
  DROP TYPE "cms"."enum_hotel_lists_sort";
  DROP TYPE "cms"."enum_hotel_lists_status";
  DROP TYPE "cms"."enum__hotel_lists_v_version_stars";
  DROP TYPE "cms"."enum__hotel_lists_v_version_board_type";
  DROP TYPE "cms"."enum__hotel_lists_v_version_sort";
  DROP TYPE "cms"."enum__hotel_lists_v_version_status";
  DROP TYPE "cms"."enum__hotel_lists_v_published_locale";`)
}
