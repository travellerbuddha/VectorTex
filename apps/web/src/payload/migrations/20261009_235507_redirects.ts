import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres';

// P17: old-site address map (cms schema only, ADR-0003).

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "cms"."enum_redirects_status" AS ENUM('301', '308');
  CREATE TABLE "cms"."redirects" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"from" varchar NOT NULL,
  	"to" varchar NOT NULL,
  	"status" "cms"."enum_redirects_status" DEFAULT '301' NOT NULL,
  	"note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "redirects_id" integer;
  CREATE UNIQUE INDEX "redirects_from_idx" ON "cms"."redirects" USING btree ("from");
  CREATE INDEX "redirects_updated_at_idx" ON "cms"."redirects" USING btree ("updated_at");
  CREATE INDEX "redirects_created_at_idx" ON "cms"."redirects" USING btree ("created_at");
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_redirects_fk" FOREIGN KEY ("redirects_id") REFERENCES "cms"."redirects"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_redirects_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("redirects_id");`);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // The lock-table reference goes first: dropping the table with CASCADE would remove the constraint already.
  await db.execute(sql`
   ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_redirects_fk";
  DROP INDEX "cms"."payload_locked_documents_rels_redirects_id_idx";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "redirects_id";
  DROP TABLE "cms"."redirects";
  DROP TYPE "cms"."enum_redirects_status";`);
}
