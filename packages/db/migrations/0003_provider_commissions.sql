CREATE TABLE "core"."provider_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"payment_mode" "core"."payment_mode" NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"payout_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_commissions_amount_positive" CHECK (amount_minor > 0),
	CONSTRAINT "provider_commissions_status_valid" CHECK (status IN ('EXPECTED', 'EARNED', 'RECEIVED', 'VOIDED')),
	CONSTRAINT "provider_commissions_source_valid" CHECK (source IN ('BOOKING', 'QUOTE')),
	CONSTRAINT "provider_commissions_received_has_payout" CHECK (status <> 'RECEIVED' OR payout_reference IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "core"."provider_bookings" ADD COLUMN "provider_commission_minor" bigint;--> statement-breakpoint
ALTER TABLE "core"."provider_bookings" ADD COLUMN "provider_commission_currency" char(3);--> statement-breakpoint
ALTER TABLE "core"."quote_versions" ADD COLUMN "provider_commission_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD CONSTRAINT "provider_commissions_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "core"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_commissions_item_uq" ON "core"."provider_commissions" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "provider_commissions_provider_status_idx" ON "core"."provider_commissions" USING btree ("provider_id","status");--> statement-breakpoint
ALTER TABLE "core"."provider_bookings" ADD CONSTRAINT "provider_bookings_commission_pair" CHECK ((provider_commission_minor IS NULL) = (provider_commission_currency IS NULL) AND (provider_commission_minor IS NULL OR provider_commission_minor >= 0));--> statement-breakpoint
ALTER TABLE "core"."quote_versions" ADD CONSTRAINT "quote_versions_commission_within_cost" CHECK (provider_commission_minor >= 0 AND provider_commission_minor <= supplier_cost_minor);--> statement-breakpoint

-- Provider commission receivables (ADR-0006): forward-only status, immutable amount/identity, never deleted.
-- EXPECTED -> EARNED (after the stay) -> RECEIVED (payout reference); EXPECTED -> VOIDED (booking cancelled).
CREATE OR REPLACE FUNCTION core.provider_commissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider_commissions rows cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'payout_reference' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'payout_reference' - 'updated_at') THEN
    RAISE EXCEPTION 'provider commission amount and identity are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'EXPECTED' AND NEW.status IN ('EARNED', 'VOIDED'))
    OR (OLD.status = 'EARNED' AND NEW.status = 'RECEIVED')
  ) THEN
    RAISE EXCEPTION 'provider commission % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.payout_reference IS NOT NULL AND NEW.payout_reference IS DISTINCT FROM OLD.payout_reference THEN
    RAISE EXCEPTION 'payout reference can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_commissions_guard BEFORE UPDATE OR DELETE ON core.provider_commissions
  FOR EACH ROW EXECUTE FUNCTION core.provider_commissions_guard();
--> statement-breakpoint
CREATE TRIGGER provider_commissions_environment BEFORE INSERT OR UPDATE OF environment ON core.provider_commissions
  FOR EACH ROW EXECUTE FUNCTION core.booking_environment_matches_order();
