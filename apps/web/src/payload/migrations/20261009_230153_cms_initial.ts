import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres';

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // ADR-0003: Payload owns the `cms` schema only; it is created here, never `core`.
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "cms";`);
  await db.execute(sql`
   CREATE TYPE "cms"."_locales" AS ENUM('tr', 'en');
  CREATE TYPE "cms"."enum_pages_blocks_image_text_image_position" AS ENUM('left', 'right');
  CREATE TYPE "cms"."enum_pages_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__pages_v_blocks_image_text_image_position" AS ENUM('left', 'right');
  CREATE TYPE "cms"."enum__pages_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__pages_v_published_locale" AS ENUM('tr', 'en');
  CREATE TYPE "cms"."enum_destinations_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__destinations_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__destinations_v_published_locale" AS ENUM('tr', 'en');
  CREATE TYPE "cms"."enum_posts_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__posts_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__posts_v_published_locale" AS ENUM('tr', 'en');
  CREATE TYPE "cms"."enum_faqs_category" AS ENUM('general', 'booking', 'payment', 'cancellation');
  CREATE TYPE "cms"."enum_faqs_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__faqs_v_version_category" AS ENUM('general', 'booking', 'payment', 'cancellation');
  CREATE TYPE "cms"."enum__faqs_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__faqs_v_published_locale" AS ENUM('tr', 'en');
  CREATE TYPE "cms"."enum_campaigns_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__campaigns_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "cms"."enum__campaigns_v_published_locale" AS ENUM('tr', 'en');
  CREATE TYPE "cms"."enum_media_rights" AS ENUM('OWNED', 'LICENSED', 'PROVIDER');
  CREATE TABLE "cms"."pages_blocks_hero" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"subheading" varchar,
  	"image_id" integer,
  	"show_hotel_search" boolean DEFAULT true,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_rich_text" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"content" jsonb,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_image_text" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"heading" varchar,
  	"text" varchar,
  	"image_position" "cms"."enum_pages_blocks_image_text_image_position" DEFAULT 'left',
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_faq_list" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_destination_grid" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages_blocks_campaign_banner" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"campaign_id" integer,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."pages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"seo_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "cms"."enum_pages_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "cms"."pages_locales" (
  	"title" varchar,
  	"slug" varchar,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."pages_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"locale" "cms"."_locales",
  	"faqs_id" integer,
  	"destinations_id" integer
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_hero" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"subheading" varchar,
  	"image_id" integer,
  	"show_hotel_search" boolean DEFAULT true,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_rich_text" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"content" jsonb,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_image_text" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"heading" varchar,
  	"text" varchar,
  	"image_position" "cms"."enum__pages_v_blocks_image_text_image_position" DEFAULT 'left',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_faq_list" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_destination_grid" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v_blocks_campaign_banner" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"campaign_id" integer,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "cms"."_pages_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_seo_image_id" integer,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "cms"."enum__pages_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"snapshot" boolean,
  	"published_locale" "cms"."enum__pages_v_published_locale",
  	"latest" boolean
  );
  
  CREATE TABLE "cms"."_pages_v_locales" (
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."_pages_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"locale" "cms"."_locales",
  	"faqs_id" integer,
  	"destinations_id" integer
  );
  
  CREATE TABLE "cms"."destinations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_image_id" integer,
  	"search_place_id" varchar,
  	"seo_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "cms"."enum_destinations_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "cms"."destinations_locales" (
  	"name" varchar,
  	"slug" varchar,
  	"summary" varchar,
  	"body" jsonb,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."_destinations_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_hero_image_id" integer,
  	"version_search_place_id" varchar,
  	"version_seo_image_id" integer,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "cms"."enum__destinations_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"snapshot" boolean,
  	"published_locale" "cms"."enum__destinations_v_published_locale",
  	"latest" boolean
  );
  
  CREATE TABLE "cms"."_destinations_v_locales" (
  	"version_name" varchar,
  	"version_slug" varchar,
  	"version_summary" varchar,
  	"version_body" jsonb,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."posts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"cover_image_id" integer,
  	"destination_id" integer,
  	"published_at" timestamp(3) with time zone,
  	"seo_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "cms"."enum_posts_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "cms"."posts_locales" (
  	"title" varchar,
  	"slug" varchar,
  	"excerpt" varchar,
  	"body" jsonb,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."_posts_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_cover_image_id" integer,
  	"version_destination_id" integer,
  	"version_published_at" timestamp(3) with time zone,
  	"version_seo_image_id" integer,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "cms"."enum__posts_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"snapshot" boolean,
  	"published_locale" "cms"."enum__posts_v_published_locale",
  	"latest" boolean
  );
  
  CREATE TABLE "cms"."_posts_v_locales" (
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_excerpt" varchar,
  	"version_body" jsonb,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."faqs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"category" "cms"."enum_faqs_category" DEFAULT 'general',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "cms"."enum_faqs_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "cms"."faqs_locales" (
  	"question" varchar,
  	"answer" jsonb,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."_faqs_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_category" "cms"."enum__faqs_v_version_category" DEFAULT 'general',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "cms"."enum__faqs_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"snapshot" boolean,
  	"published_locale" "cms"."enum__faqs_v_published_locale",
  	"latest" boolean
  );
  
  CREATE TABLE "cms"."_faqs_v_locales" (
  	"version_question" varchar,
  	"version_answer" jsonb,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."campaigns" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"link_path" varchar,
  	"valid_from" timestamp(3) with time zone,
  	"valid_to" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "cms"."enum_campaigns_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "cms"."campaigns_locales" (
  	"title" varchar,
  	"summary" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."_campaigns_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_image_id" integer,
  	"version_link_path" varchar,
  	"version_valid_from" timestamp(3) with time zone,
  	"version_valid_to" timestamp(3) with time zone,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "cms"."enum__campaigns_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"snapshot" boolean,
  	"published_locale" "cms"."enum__campaigns_v_published_locale",
  	"latest" boolean
  );
  
  CREATE TABLE "cms"."_campaigns_v_locales" (
  	"version_title" varchar,
  	"version_summary" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"rights" "cms"."enum_media_rights" NOT NULL,
  	"source" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "cms"."media_locales" (
  	"alt" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "cms"."cms_users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"staff_id" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"display_name" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "cms"."payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"pages_id" integer,
  	"destinations_id" integer,
  	"posts_id" integer,
  	"faqs_id" integer,
  	"campaigns_id" integer,
  	"media_id" integer,
  	"cms_users_id" integer
  );
  
  CREATE TABLE "cms"."payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"cms_users_id" integer
  );
  
  CREATE TABLE "cms"."payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cms"."navigation_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"href" varchar NOT NULL
  );
  
  CREATE TABLE "cms"."navigation_items_locales" (
  	"label" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "cms"."navigation" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "cms"."footer_columns_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"href" varchar NOT NULL
  );
  
  CREATE TABLE "cms"."footer_columns_links_locales" (
  	"label" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "cms"."footer_columns" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "cms"."footer_columns_locales" (
  	"heading" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "cms"."footer" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "cms"."footer_locales" (
  	"legal" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "cms"."_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  ALTER TABLE "cms"."pages_blocks_hero" ADD CONSTRAINT "pages_blocks_hero_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_hero" ADD CONSTRAINT "pages_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_rich_text" ADD CONSTRAINT "pages_blocks_rich_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_image_text" ADD CONSTRAINT "pages_blocks_image_text_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_image_text" ADD CONSTRAINT "pages_blocks_image_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_faq_list" ADD CONSTRAINT "pages_blocks_faq_list_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_destination_grid" ADD CONSTRAINT "pages_blocks_destination_grid_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_campaign_banner" ADD CONSTRAINT "pages_blocks_campaign_banner_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "cms"."campaigns"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."pages_blocks_campaign_banner" ADD CONSTRAINT "pages_blocks_campaign_banner_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages" ADD CONSTRAINT "pages_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."pages_locales" ADD CONSTRAINT "pages_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_rels" ADD CONSTRAINT "pages_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_rels" ADD CONSTRAINT "pages_rels_faqs_fk" FOREIGN KEY ("faqs_id") REFERENCES "cms"."faqs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."pages_rels" ADD CONSTRAINT "pages_rels_destinations_fk" FOREIGN KEY ("destinations_id") REFERENCES "cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_hero" ADD CONSTRAINT "_pages_v_blocks_hero_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_hero" ADD CONSTRAINT "_pages_v_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_rich_text" ADD CONSTRAINT "_pages_v_blocks_rich_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_image_text" ADD CONSTRAINT "_pages_v_blocks_image_text_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_image_text" ADD CONSTRAINT "_pages_v_blocks_image_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_faq_list" ADD CONSTRAINT "_pages_v_blocks_faq_list_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_destination_grid" ADD CONSTRAINT "_pages_v_blocks_destination_grid_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_campaign_banner" ADD CONSTRAINT "_pages_v_blocks_campaign_banner_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "cms"."campaigns"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_blocks_campaign_banner" ADD CONSTRAINT "_pages_v_blocks_campaign_banner_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v" ADD CONSTRAINT "_pages_v_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."pages"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v" ADD CONSTRAINT "_pages_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_locales" ADD CONSTRAINT "_pages_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_rels" ADD CONSTRAINT "_pages_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_rels" ADD CONSTRAINT "_pages_v_rels_faqs_fk" FOREIGN KEY ("faqs_id") REFERENCES "cms"."faqs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_pages_v_rels" ADD CONSTRAINT "_pages_v_rels_destinations_fk" FOREIGN KEY ("destinations_id") REFERENCES "cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."destinations" ADD CONSTRAINT "destinations_hero_image_id_media_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."destinations" ADD CONSTRAINT "destinations_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."destinations_locales" ADD CONSTRAINT "destinations_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_destinations_v" ADD CONSTRAINT "_destinations_v_parent_id_destinations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."destinations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_destinations_v" ADD CONSTRAINT "_destinations_v_version_hero_image_id_media_id_fk" FOREIGN KEY ("version_hero_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_destinations_v" ADD CONSTRAINT "_destinations_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_destinations_v_locales" ADD CONSTRAINT "_destinations_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_destinations_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."posts" ADD CONSTRAINT "posts_cover_image_id_media_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."posts" ADD CONSTRAINT "posts_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "cms"."destinations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."posts" ADD CONSTRAINT "posts_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."posts_locales" ADD CONSTRAINT "posts_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v" ADD CONSTRAINT "_posts_v_parent_id_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."posts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v" ADD CONSTRAINT "_posts_v_version_cover_image_id_media_id_fk" FOREIGN KEY ("version_cover_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v" ADD CONSTRAINT "_posts_v_version_destination_id_destinations_id_fk" FOREIGN KEY ("version_destination_id") REFERENCES "cms"."destinations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v" ADD CONSTRAINT "_posts_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_posts_v_locales" ADD CONSTRAINT "_posts_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."faqs_locales" ADD CONSTRAINT "faqs_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."faqs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_faqs_v" ADD CONSTRAINT "_faqs_v_parent_id_faqs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."faqs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_faqs_v_locales" ADD CONSTRAINT "_faqs_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_faqs_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."campaigns" ADD CONSTRAINT "campaigns_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."campaigns_locales" ADD CONSTRAINT "campaigns_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."_campaigns_v" ADD CONSTRAINT "_campaigns_v_parent_id_campaigns_id_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."campaigns"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_campaigns_v" ADD CONSTRAINT "_campaigns_v_version_image_id_media_id_fk" FOREIGN KEY ("version_image_id") REFERENCES "cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cms"."_campaigns_v_locales" ADD CONSTRAINT "_campaigns_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."_campaigns_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."media_locales" ADD CONSTRAINT "media_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_destinations_fk" FOREIGN KEY ("destinations_id") REFERENCES "cms"."destinations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_posts_fk" FOREIGN KEY ("posts_id") REFERENCES "cms"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_faqs_fk" FOREIGN KEY ("faqs_id") REFERENCES "cms"."faqs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "cms"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "cms"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_cms_users_fk" FOREIGN KEY ("cms_users_id") REFERENCES "cms"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "cms"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_cms_users_fk" FOREIGN KEY ("cms_users_id") REFERENCES "cms"."cms_users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."navigation_items" ADD CONSTRAINT "navigation_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."navigation"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."navigation_items_locales" ADD CONSTRAINT "navigation_items_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."navigation_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."footer_columns_links" ADD CONSTRAINT "footer_columns_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."footer_columns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."footer_columns_links_locales" ADD CONSTRAINT "footer_columns_links_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."footer_columns_links"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."footer_columns" ADD CONSTRAINT "footer_columns_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."footer"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."footer_columns_locales" ADD CONSTRAINT "footer_columns_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."footer_columns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "cms"."footer_locales" ADD CONSTRAINT "footer_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "cms"."footer"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_hero_order_idx" ON "cms"."pages_blocks_hero" USING btree ("_order");
  CREATE INDEX "pages_blocks_hero_parent_id_idx" ON "cms"."pages_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_hero_path_idx" ON "cms"."pages_blocks_hero" USING btree ("_path");
  CREATE INDEX "pages_blocks_hero_locale_idx" ON "cms"."pages_blocks_hero" USING btree ("_locale");
  CREATE INDEX "pages_blocks_hero_image_idx" ON "cms"."pages_blocks_hero" USING btree ("image_id");
  CREATE INDEX "pages_blocks_rich_text_order_idx" ON "cms"."pages_blocks_rich_text" USING btree ("_order");
  CREATE INDEX "pages_blocks_rich_text_parent_id_idx" ON "cms"."pages_blocks_rich_text" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_rich_text_path_idx" ON "cms"."pages_blocks_rich_text" USING btree ("_path");
  CREATE INDEX "pages_blocks_rich_text_locale_idx" ON "cms"."pages_blocks_rich_text" USING btree ("_locale");
  CREATE INDEX "pages_blocks_image_text_order_idx" ON "cms"."pages_blocks_image_text" USING btree ("_order");
  CREATE INDEX "pages_blocks_image_text_parent_id_idx" ON "cms"."pages_blocks_image_text" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_image_text_path_idx" ON "cms"."pages_blocks_image_text" USING btree ("_path");
  CREATE INDEX "pages_blocks_image_text_locale_idx" ON "cms"."pages_blocks_image_text" USING btree ("_locale");
  CREATE INDEX "pages_blocks_image_text_image_idx" ON "cms"."pages_blocks_image_text" USING btree ("image_id");
  CREATE INDEX "pages_blocks_faq_list_order_idx" ON "cms"."pages_blocks_faq_list" USING btree ("_order");
  CREATE INDEX "pages_blocks_faq_list_parent_id_idx" ON "cms"."pages_blocks_faq_list" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_faq_list_path_idx" ON "cms"."pages_blocks_faq_list" USING btree ("_path");
  CREATE INDEX "pages_blocks_faq_list_locale_idx" ON "cms"."pages_blocks_faq_list" USING btree ("_locale");
  CREATE INDEX "pages_blocks_destination_grid_order_idx" ON "cms"."pages_blocks_destination_grid" USING btree ("_order");
  CREATE INDEX "pages_blocks_destination_grid_parent_id_idx" ON "cms"."pages_blocks_destination_grid" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_destination_grid_path_idx" ON "cms"."pages_blocks_destination_grid" USING btree ("_path");
  CREATE INDEX "pages_blocks_destination_grid_locale_idx" ON "cms"."pages_blocks_destination_grid" USING btree ("_locale");
  CREATE INDEX "pages_blocks_campaign_banner_order_idx" ON "cms"."pages_blocks_campaign_banner" USING btree ("_order");
  CREATE INDEX "pages_blocks_campaign_banner_parent_id_idx" ON "cms"."pages_blocks_campaign_banner" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_campaign_banner_path_idx" ON "cms"."pages_blocks_campaign_banner" USING btree ("_path");
  CREATE INDEX "pages_blocks_campaign_banner_locale_idx" ON "cms"."pages_blocks_campaign_banner" USING btree ("_locale");
  CREATE INDEX "pages_blocks_campaign_banner_campaign_idx" ON "cms"."pages_blocks_campaign_banner" USING btree ("campaign_id");
  CREATE INDEX "pages_seo_seo_image_idx" ON "cms"."pages" USING btree ("seo_image_id");
  CREATE INDEX "pages_updated_at_idx" ON "cms"."pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "cms"."pages" USING btree ("created_at");
  CREATE INDEX "pages__status_idx" ON "cms"."pages" USING btree ("_status");
  CREATE UNIQUE INDEX "pages_slug_idx" ON "cms"."pages_locales" USING btree ("slug","_locale");
  CREATE UNIQUE INDEX "pages_locales_locale_parent_id_unique" ON "cms"."pages_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_rels_order_idx" ON "cms"."pages_rels" USING btree ("order");
  CREATE INDEX "pages_rels_parent_idx" ON "cms"."pages_rels" USING btree ("parent_id");
  CREATE INDEX "pages_rels_path_idx" ON "cms"."pages_rels" USING btree ("path");
  CREATE INDEX "pages_rels_locale_idx" ON "cms"."pages_rels" USING btree ("locale");
  CREATE INDEX "pages_rels_faqs_id_idx" ON "cms"."pages_rels" USING btree ("faqs_id","locale");
  CREATE INDEX "pages_rels_destinations_id_idx" ON "cms"."pages_rels" USING btree ("destinations_id","locale");
  CREATE INDEX "_pages_v_blocks_hero_order_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hero_parent_id_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_hero_path_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_hero_locale_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_hero_image_idx" ON "cms"."_pages_v_blocks_hero" USING btree ("image_id");
  CREATE INDEX "_pages_v_blocks_rich_text_order_idx" ON "cms"."_pages_v_blocks_rich_text" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_rich_text_parent_id_idx" ON "cms"."_pages_v_blocks_rich_text" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_rich_text_path_idx" ON "cms"."_pages_v_blocks_rich_text" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_rich_text_locale_idx" ON "cms"."_pages_v_blocks_rich_text" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_image_text_order_idx" ON "cms"."_pages_v_blocks_image_text" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_image_text_parent_id_idx" ON "cms"."_pages_v_blocks_image_text" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_image_text_path_idx" ON "cms"."_pages_v_blocks_image_text" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_image_text_locale_idx" ON "cms"."_pages_v_blocks_image_text" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_image_text_image_idx" ON "cms"."_pages_v_blocks_image_text" USING btree ("image_id");
  CREATE INDEX "_pages_v_blocks_faq_list_order_idx" ON "cms"."_pages_v_blocks_faq_list" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_faq_list_parent_id_idx" ON "cms"."_pages_v_blocks_faq_list" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_faq_list_path_idx" ON "cms"."_pages_v_blocks_faq_list" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_faq_list_locale_idx" ON "cms"."_pages_v_blocks_faq_list" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_destination_grid_order_idx" ON "cms"."_pages_v_blocks_destination_grid" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_destination_grid_parent_id_idx" ON "cms"."_pages_v_blocks_destination_grid" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_destination_grid_path_idx" ON "cms"."_pages_v_blocks_destination_grid" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_destination_grid_locale_idx" ON "cms"."_pages_v_blocks_destination_grid" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_campaign_banner_order_idx" ON "cms"."_pages_v_blocks_campaign_banner" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_campaign_banner_parent_id_idx" ON "cms"."_pages_v_blocks_campaign_banner" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_campaign_banner_path_idx" ON "cms"."_pages_v_blocks_campaign_banner" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_campaign_banner_locale_idx" ON "cms"."_pages_v_blocks_campaign_banner" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_campaign_banner_campaign_idx" ON "cms"."_pages_v_blocks_campaign_banner" USING btree ("campaign_id");
  CREATE INDEX "_pages_v_parent_idx" ON "cms"."_pages_v" USING btree ("parent_id");
  CREATE INDEX "_pages_v_version_seo_version_seo_image_idx" ON "cms"."_pages_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_pages_v_version_version_updated_at_idx" ON "cms"."_pages_v" USING btree ("version_updated_at");
  CREATE INDEX "_pages_v_version_version_created_at_idx" ON "cms"."_pages_v" USING btree ("version_created_at");
  CREATE INDEX "_pages_v_version_version__status_idx" ON "cms"."_pages_v" USING btree ("version__status");
  CREATE INDEX "_pages_v_created_at_idx" ON "cms"."_pages_v" USING btree ("created_at");
  CREATE INDEX "_pages_v_updated_at_idx" ON "cms"."_pages_v" USING btree ("updated_at");
  CREATE INDEX "_pages_v_snapshot_idx" ON "cms"."_pages_v" USING btree ("snapshot");
  CREATE INDEX "_pages_v_published_locale_idx" ON "cms"."_pages_v" USING btree ("published_locale");
  CREATE INDEX "_pages_v_latest_idx" ON "cms"."_pages_v" USING btree ("latest");
  CREATE INDEX "_pages_v_version_version_slug_idx" ON "cms"."_pages_v_locales" USING btree ("version_slug","_locale");
  CREATE UNIQUE INDEX "_pages_v_locales_locale_parent_id_unique" ON "cms"."_pages_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_pages_v_rels_order_idx" ON "cms"."_pages_v_rels" USING btree ("order");
  CREATE INDEX "_pages_v_rels_parent_idx" ON "cms"."_pages_v_rels" USING btree ("parent_id");
  CREATE INDEX "_pages_v_rels_path_idx" ON "cms"."_pages_v_rels" USING btree ("path");
  CREATE INDEX "_pages_v_rels_locale_idx" ON "cms"."_pages_v_rels" USING btree ("locale");
  CREATE INDEX "_pages_v_rels_faqs_id_idx" ON "cms"."_pages_v_rels" USING btree ("faqs_id","locale");
  CREATE INDEX "_pages_v_rels_destinations_id_idx" ON "cms"."_pages_v_rels" USING btree ("destinations_id","locale");
  CREATE INDEX "destinations_hero_image_idx" ON "cms"."destinations" USING btree ("hero_image_id");
  CREATE INDEX "destinations_seo_seo_image_idx" ON "cms"."destinations" USING btree ("seo_image_id");
  CREATE INDEX "destinations_updated_at_idx" ON "cms"."destinations" USING btree ("updated_at");
  CREATE INDEX "destinations_created_at_idx" ON "cms"."destinations" USING btree ("created_at");
  CREATE INDEX "destinations__status_idx" ON "cms"."destinations" USING btree ("_status");
  CREATE UNIQUE INDEX "destinations_slug_idx" ON "cms"."destinations_locales" USING btree ("slug","_locale");
  CREATE UNIQUE INDEX "destinations_locales_locale_parent_id_unique" ON "cms"."destinations_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_destinations_v_parent_idx" ON "cms"."_destinations_v" USING btree ("parent_id");
  CREATE INDEX "_destinations_v_version_version_hero_image_idx" ON "cms"."_destinations_v" USING btree ("version_hero_image_id");
  CREATE INDEX "_destinations_v_version_seo_version_seo_image_idx" ON "cms"."_destinations_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_destinations_v_version_version_updated_at_idx" ON "cms"."_destinations_v" USING btree ("version_updated_at");
  CREATE INDEX "_destinations_v_version_version_created_at_idx" ON "cms"."_destinations_v" USING btree ("version_created_at");
  CREATE INDEX "_destinations_v_version_version__status_idx" ON "cms"."_destinations_v" USING btree ("version__status");
  CREATE INDEX "_destinations_v_created_at_idx" ON "cms"."_destinations_v" USING btree ("created_at");
  CREATE INDEX "_destinations_v_updated_at_idx" ON "cms"."_destinations_v" USING btree ("updated_at");
  CREATE INDEX "_destinations_v_snapshot_idx" ON "cms"."_destinations_v" USING btree ("snapshot");
  CREATE INDEX "_destinations_v_published_locale_idx" ON "cms"."_destinations_v" USING btree ("published_locale");
  CREATE INDEX "_destinations_v_latest_idx" ON "cms"."_destinations_v" USING btree ("latest");
  CREATE INDEX "_destinations_v_version_version_slug_idx" ON "cms"."_destinations_v_locales" USING btree ("version_slug","_locale");
  CREATE UNIQUE INDEX "_destinations_v_locales_locale_parent_id_unique" ON "cms"."_destinations_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "posts_cover_image_idx" ON "cms"."posts" USING btree ("cover_image_id");
  CREATE INDEX "posts_destination_idx" ON "cms"."posts" USING btree ("destination_id");
  CREATE INDEX "posts_seo_seo_image_idx" ON "cms"."posts" USING btree ("seo_image_id");
  CREATE INDEX "posts_updated_at_idx" ON "cms"."posts" USING btree ("updated_at");
  CREATE INDEX "posts_created_at_idx" ON "cms"."posts" USING btree ("created_at");
  CREATE INDEX "posts__status_idx" ON "cms"."posts" USING btree ("_status");
  CREATE UNIQUE INDEX "posts_slug_idx" ON "cms"."posts_locales" USING btree ("slug","_locale");
  CREATE UNIQUE INDEX "posts_locales_locale_parent_id_unique" ON "cms"."posts_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_posts_v_parent_idx" ON "cms"."_posts_v" USING btree ("parent_id");
  CREATE INDEX "_posts_v_version_version_cover_image_idx" ON "cms"."_posts_v" USING btree ("version_cover_image_id");
  CREATE INDEX "_posts_v_version_version_destination_idx" ON "cms"."_posts_v" USING btree ("version_destination_id");
  CREATE INDEX "_posts_v_version_seo_version_seo_image_idx" ON "cms"."_posts_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_posts_v_version_version_updated_at_idx" ON "cms"."_posts_v" USING btree ("version_updated_at");
  CREATE INDEX "_posts_v_version_version_created_at_idx" ON "cms"."_posts_v" USING btree ("version_created_at");
  CREATE INDEX "_posts_v_version_version__status_idx" ON "cms"."_posts_v" USING btree ("version__status");
  CREATE INDEX "_posts_v_created_at_idx" ON "cms"."_posts_v" USING btree ("created_at");
  CREATE INDEX "_posts_v_updated_at_idx" ON "cms"."_posts_v" USING btree ("updated_at");
  CREATE INDEX "_posts_v_snapshot_idx" ON "cms"."_posts_v" USING btree ("snapshot");
  CREATE INDEX "_posts_v_published_locale_idx" ON "cms"."_posts_v" USING btree ("published_locale");
  CREATE INDEX "_posts_v_latest_idx" ON "cms"."_posts_v" USING btree ("latest");
  CREATE INDEX "_posts_v_version_version_slug_idx" ON "cms"."_posts_v_locales" USING btree ("version_slug","_locale");
  CREATE UNIQUE INDEX "_posts_v_locales_locale_parent_id_unique" ON "cms"."_posts_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "faqs_updated_at_idx" ON "cms"."faqs" USING btree ("updated_at");
  CREATE INDEX "faqs_created_at_idx" ON "cms"."faqs" USING btree ("created_at");
  CREATE INDEX "faqs__status_idx" ON "cms"."faqs" USING btree ("_status");
  CREATE UNIQUE INDEX "faqs_locales_locale_parent_id_unique" ON "cms"."faqs_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_faqs_v_parent_idx" ON "cms"."_faqs_v" USING btree ("parent_id");
  CREATE INDEX "_faqs_v_version_version_updated_at_idx" ON "cms"."_faqs_v" USING btree ("version_updated_at");
  CREATE INDEX "_faqs_v_version_version_created_at_idx" ON "cms"."_faqs_v" USING btree ("version_created_at");
  CREATE INDEX "_faqs_v_version_version__status_idx" ON "cms"."_faqs_v" USING btree ("version__status");
  CREATE INDEX "_faqs_v_created_at_idx" ON "cms"."_faqs_v" USING btree ("created_at");
  CREATE INDEX "_faqs_v_updated_at_idx" ON "cms"."_faqs_v" USING btree ("updated_at");
  CREATE INDEX "_faqs_v_snapshot_idx" ON "cms"."_faqs_v" USING btree ("snapshot");
  CREATE INDEX "_faqs_v_published_locale_idx" ON "cms"."_faqs_v" USING btree ("published_locale");
  CREATE INDEX "_faqs_v_latest_idx" ON "cms"."_faqs_v" USING btree ("latest");
  CREATE UNIQUE INDEX "_faqs_v_locales_locale_parent_id_unique" ON "cms"."_faqs_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "campaigns_image_idx" ON "cms"."campaigns" USING btree ("image_id");
  CREATE INDEX "campaigns_updated_at_idx" ON "cms"."campaigns" USING btree ("updated_at");
  CREATE INDEX "campaigns_created_at_idx" ON "cms"."campaigns" USING btree ("created_at");
  CREATE INDEX "campaigns__status_idx" ON "cms"."campaigns" USING btree ("_status");
  CREATE UNIQUE INDEX "campaigns_locales_locale_parent_id_unique" ON "cms"."campaigns_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_campaigns_v_parent_idx" ON "cms"."_campaigns_v" USING btree ("parent_id");
  CREATE INDEX "_campaigns_v_version_version_image_idx" ON "cms"."_campaigns_v" USING btree ("version_image_id");
  CREATE INDEX "_campaigns_v_version_version_updated_at_idx" ON "cms"."_campaigns_v" USING btree ("version_updated_at");
  CREATE INDEX "_campaigns_v_version_version_created_at_idx" ON "cms"."_campaigns_v" USING btree ("version_created_at");
  CREATE INDEX "_campaigns_v_version_version__status_idx" ON "cms"."_campaigns_v" USING btree ("version__status");
  CREATE INDEX "_campaigns_v_created_at_idx" ON "cms"."_campaigns_v" USING btree ("created_at");
  CREATE INDEX "_campaigns_v_updated_at_idx" ON "cms"."_campaigns_v" USING btree ("updated_at");
  CREATE INDEX "_campaigns_v_snapshot_idx" ON "cms"."_campaigns_v" USING btree ("snapshot");
  CREATE INDEX "_campaigns_v_published_locale_idx" ON "cms"."_campaigns_v" USING btree ("published_locale");
  CREATE INDEX "_campaigns_v_latest_idx" ON "cms"."_campaigns_v" USING btree ("latest");
  CREATE UNIQUE INDEX "_campaigns_v_locales_locale_parent_id_unique" ON "cms"."_campaigns_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "media_updated_at_idx" ON "cms"."media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "cms"."media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "cms"."media" USING btree ("filename");
  CREATE UNIQUE INDEX "media_locales_locale_parent_id_unique" ON "cms"."media_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "cms_users_staff_id_idx" ON "cms"."cms_users" USING btree ("staff_id");
  CREATE INDEX "cms_users_updated_at_idx" ON "cms"."cms_users" USING btree ("updated_at");
  CREATE INDEX "cms_users_created_at_idx" ON "cms"."cms_users" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "cms"."payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "cms"."payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "cms"."payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "cms"."payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "cms"."payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "cms"."payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "cms"."payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("pages_id");
  CREATE INDEX "payload_locked_documents_rels_destinations_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("destinations_id");
  CREATE INDEX "payload_locked_documents_rels_posts_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("posts_id");
  CREATE INDEX "payload_locked_documents_rels_faqs_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("faqs_id");
  CREATE INDEX "payload_locked_documents_rels_campaigns_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("campaigns_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_cms_users_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("cms_users_id");
  CREATE INDEX "payload_preferences_key_idx" ON "cms"."payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "cms"."payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "cms"."payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "cms"."payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "cms"."payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "cms"."payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_cms_users_id_idx" ON "cms"."payload_preferences_rels" USING btree ("cms_users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "cms"."payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "cms"."payload_migrations" USING btree ("created_at");
  CREATE INDEX "navigation_items_order_idx" ON "cms"."navigation_items" USING btree ("_order");
  CREATE INDEX "navigation_items_parent_id_idx" ON "cms"."navigation_items" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "navigation_items_locales_locale_parent_id_unique" ON "cms"."navigation_items_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "footer_columns_links_order_idx" ON "cms"."footer_columns_links" USING btree ("_order");
  CREATE INDEX "footer_columns_links_parent_id_idx" ON "cms"."footer_columns_links" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "footer_columns_links_locales_locale_parent_id_unique" ON "cms"."footer_columns_links_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "footer_columns_order_idx" ON "cms"."footer_columns" USING btree ("_order");
  CREATE INDEX "footer_columns_parent_id_idx" ON "cms"."footer_columns" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "footer_columns_locales_locale_parent_id_unique" ON "cms"."footer_columns_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "footer_locales_locale_parent_id_unique" ON "cms"."footer_locales" USING btree ("_locale","_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "cms"."pages_blocks_hero" CASCADE;
  DROP TABLE "cms"."pages_blocks_rich_text" CASCADE;
  DROP TABLE "cms"."pages_blocks_image_text" CASCADE;
  DROP TABLE "cms"."pages_blocks_faq_list" CASCADE;
  DROP TABLE "cms"."pages_blocks_destination_grid" CASCADE;
  DROP TABLE "cms"."pages_blocks_campaign_banner" CASCADE;
  DROP TABLE "cms"."pages" CASCADE;
  DROP TABLE "cms"."pages_locales" CASCADE;
  DROP TABLE "cms"."pages_rels" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_hero" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_rich_text" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_image_text" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_faq_list" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_destination_grid" CASCADE;
  DROP TABLE "cms"."_pages_v_blocks_campaign_banner" CASCADE;
  DROP TABLE "cms"."_pages_v" CASCADE;
  DROP TABLE "cms"."_pages_v_locales" CASCADE;
  DROP TABLE "cms"."_pages_v_rels" CASCADE;
  DROP TABLE "cms"."destinations" CASCADE;
  DROP TABLE "cms"."destinations_locales" CASCADE;
  DROP TABLE "cms"."_destinations_v" CASCADE;
  DROP TABLE "cms"."_destinations_v_locales" CASCADE;
  DROP TABLE "cms"."posts" CASCADE;
  DROP TABLE "cms"."posts_locales" CASCADE;
  DROP TABLE "cms"."_posts_v" CASCADE;
  DROP TABLE "cms"."_posts_v_locales" CASCADE;
  DROP TABLE "cms"."faqs" CASCADE;
  DROP TABLE "cms"."faqs_locales" CASCADE;
  DROP TABLE "cms"."_faqs_v" CASCADE;
  DROP TABLE "cms"."_faqs_v_locales" CASCADE;
  DROP TABLE "cms"."campaigns" CASCADE;
  DROP TABLE "cms"."campaigns_locales" CASCADE;
  DROP TABLE "cms"."_campaigns_v" CASCADE;
  DROP TABLE "cms"."_campaigns_v_locales" CASCADE;
  DROP TABLE "cms"."media" CASCADE;
  DROP TABLE "cms"."media_locales" CASCADE;
  DROP TABLE "cms"."cms_users" CASCADE;
  DROP TABLE "cms"."payload_kv" CASCADE;
  DROP TABLE "cms"."payload_locked_documents" CASCADE;
  DROP TABLE "cms"."payload_locked_documents_rels" CASCADE;
  DROP TABLE "cms"."payload_preferences" CASCADE;
  DROP TABLE "cms"."payload_preferences_rels" CASCADE;
  DROP TABLE "cms"."payload_migrations" CASCADE;
  DROP TABLE "cms"."navigation_items" CASCADE;
  DROP TABLE "cms"."navigation_items_locales" CASCADE;
  DROP TABLE "cms"."navigation" CASCADE;
  DROP TABLE "cms"."footer_columns_links" CASCADE;
  DROP TABLE "cms"."footer_columns_links_locales" CASCADE;
  DROP TABLE "cms"."footer_columns" CASCADE;
  DROP TABLE "cms"."footer_columns_locales" CASCADE;
  DROP TABLE "cms"."footer" CASCADE;
  DROP TABLE "cms"."footer_locales" CASCADE;
  DROP TYPE "cms"."_locales";
  DROP TYPE "cms"."enum_pages_blocks_image_text_image_position";
  DROP TYPE "cms"."enum_pages_status";
  DROP TYPE "cms"."enum__pages_v_blocks_image_text_image_position";
  DROP TYPE "cms"."enum__pages_v_version_status";
  DROP TYPE "cms"."enum__pages_v_published_locale";
  DROP TYPE "cms"."enum_destinations_status";
  DROP TYPE "cms"."enum__destinations_v_version_status";
  DROP TYPE "cms"."enum__destinations_v_published_locale";
  DROP TYPE "cms"."enum_posts_status";
  DROP TYPE "cms"."enum__posts_v_version_status";
  DROP TYPE "cms"."enum__posts_v_published_locale";
  DROP TYPE "cms"."enum_faqs_category";
  DROP TYPE "cms"."enum_faqs_status";
  DROP TYPE "cms"."enum__faqs_v_version_category";
  DROP TYPE "cms"."enum__faqs_v_version_status";
  DROP TYPE "cms"."enum__faqs_v_published_locale";
  DROP TYPE "cms"."enum_campaigns_status";
  DROP TYPE "cms"."enum__campaigns_v_version_status";
  DROP TYPE "cms"."enum__campaigns_v_published_locale";
  DROP TYPE "cms"."enum_media_rights";`)
}
