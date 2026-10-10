import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * Menu and footer link addresses become per language (the English menu links to /en/...). Existing links keep their
 * address in every language they already have a label in; going back keeps the Turkish one.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "cms"."navigation_items_locales" ADD COLUMN "href" varchar;
  UPDATE "cms"."navigation_items_locales" l SET "href" = i."href" FROM "cms"."navigation_items" i WHERE l."_parent_id" = i."id";
  DELETE FROM "cms"."navigation_items_locales" WHERE "href" IS NULL;
  ALTER TABLE "cms"."navigation_items_locales" ALTER COLUMN "href" SET NOT NULL;
  ALTER TABLE "cms"."footer_columns_links_locales" ADD COLUMN "href" varchar;
  UPDATE "cms"."footer_columns_links_locales" l SET "href" = i."href" FROM "cms"."footer_columns_links" i WHERE l."_parent_id" = i."id";
  DELETE FROM "cms"."footer_columns_links_locales" WHERE "href" IS NULL;
  ALTER TABLE "cms"."footer_columns_links_locales" ALTER COLUMN "href" SET NOT NULL;
  ALTER TABLE "cms"."navigation_items" DROP COLUMN "href";
  ALTER TABLE "cms"."footer_columns_links" DROP COLUMN "href";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "cms"."navigation_items" ADD COLUMN "href" varchar;
  UPDATE "cms"."navigation_items" i SET "href" = coalesce(
    (SELECT l."href" FROM "cms"."navigation_items_locales" l WHERE l."_parent_id" = i."id" AND l."_locale" = 'tr'),
    (SELECT l."href" FROM "cms"."navigation_items_locales" l WHERE l."_parent_id" = i."id" LIMIT 1), '/');
  ALTER TABLE "cms"."navigation_items" ALTER COLUMN "href" SET NOT NULL;
  ALTER TABLE "cms"."footer_columns_links" ADD COLUMN "href" varchar;
  UPDATE "cms"."footer_columns_links" i SET "href" = coalesce(
    (SELECT l."href" FROM "cms"."footer_columns_links_locales" l WHERE l."_parent_id" = i."id" AND l."_locale" = 'tr'),
    (SELECT l."href" FROM "cms"."footer_columns_links_locales" l WHERE l."_parent_id" = i."id" LIMIT 1), '/');
  ALTER TABLE "cms"."footer_columns_links" ALTER COLUMN "href" SET NOT NULL;
  ALTER TABLE "cms"."navigation_items_locales" DROP COLUMN "href";
  ALTER TABLE "cms"."footer_columns_links_locales" DROP COLUMN "href";`)
}
