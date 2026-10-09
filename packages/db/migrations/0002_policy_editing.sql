ALTER TABLE "core"."pricing_policy_versions" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."pricing_policy_versions" ADD COLUMN "updated_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."pricing_policy_versions" ADD COLUMN "change_note" text;--> statement-breakpoint
ALTER TABLE "core"."pricing_policy_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."risk_policy_versions" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."risk_policy_versions" ADD COLUMN "updated_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."risk_policy_versions" ADD COLUMN "change_note" text;--> statement-breakpoint
ALTER TABLE "core"."risk_policy_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_policy_versions_one_approved_uq" ON "core"."pricing_policy_versions" USING btree ("id") WHERE status = 'APPROVED';--> statement-breakpoint
CREATE UNIQUE INDEX "risk_policy_versions_one_approved_uq" ON "core"."risk_policy_versions" USING btree ("id") WHERE status = 'APPROVED';--> statement-breakpoint
ALTER TABLE "core"."pricing_policy_versions" ADD CONSTRAINT "pricing_policy_versions_four_eyes" CHECK (approved_by IS NULL OR (approved_by <> created_by AND approved_by <> updated_by));--> statement-breakpoint
ALTER TABLE "core"."risk_policy_versions" ADD CONSTRAINT "risk_policy_versions_four_eyes" CHECK (approved_by IS NULL OR (approved_by <> created_by AND approved_by <> updated_by));