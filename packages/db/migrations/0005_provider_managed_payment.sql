ALTER TABLE "core"."payment_attempts" ADD COLUMN "provider_prebook_ref" text;--> statement-breakpoint
ALTER TABLE "core"."payment_attempts" ADD COLUMN "provider_transaction_id" text;--> statement-breakpoint
ALTER TABLE "core"."payment_attempts" ADD COLUMN "provider_client_secret" text;--> statement-breakpoint
ALTER TABLE "core"."payment_attempts" ADD COLUMN "pay_by" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_tx_uq" ON "core"."payment_attempts" USING btree ("environment","provider_transaction_id");--> statement-breakpoint
ALTER TABLE "core"."payment_attempts" ADD CONSTRAINT "payment_attempts_provider_fields" CHECK ((provider_prebook_ref IS NULL) = (provider_transaction_id IS NULL) AND (mode = 'PROVIDER_MANAGED' OR (provider_prebook_ref IS NULL AND provider_client_secret IS NULL AND pay_by IS NULL)));