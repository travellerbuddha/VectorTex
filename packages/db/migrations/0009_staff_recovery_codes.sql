CREATE TABLE "core"."staff_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "core"."staff_recovery_codes" ADD CONSTRAINT "staff_recovery_codes_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_recovery_codes_hash_uq" ON "core"."staff_recovery_codes" USING btree ("staff_id","code_hash");--> statement-breakpoint
CREATE INDEX "staff_recovery_codes_staff_idx" ON "core"."staff_recovery_codes" USING btree ("staff_id");