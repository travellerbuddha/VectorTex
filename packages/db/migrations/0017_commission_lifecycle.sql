-- Commission lifecycle (ADR-0019): EXPECTED -> EARNED after the stay (provider still reports the booking confirmed),
-- EARNED -> RECEIVED when finance records the provider payout that settles it; a booking cancelled after earning voids
-- the commission (EARNED -> VOIDED, the ledger entries are reversed by the application).

CREATE TABLE "core"."commission_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"provider_id" text NOT NULL,
	"reference" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"commissions_minor" bigint NOT NULL,
	"received_on" date NOT NULL,
	"note" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_payouts_amounts_positive" CHECK (amount_minor > 0 AND commissions_minor > 0),
	CONSTRAINT "commission_payouts_reference_valid" CHECK (length(btrim(reference)) BETWEEN 1 AND 100),
	CONSTRAINT "commission_payouts_difference_explained" CHECK (amount_minor = commissions_minor OR length(btrim(coalesce(note, ''))) >= 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "commission_payouts_reference_uq" ON "core"."commission_payouts" USING btree ("environment","provider_id","reference");--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD COLUMN "payout_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD COLUMN "earned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD CONSTRAINT "provider_commissions_payout_id_commission_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "core"."commission_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_commissions_payout_idx" ON "core"."provider_commissions" USING btree ("payout_id");--> statement-breakpoint

-- Forward-only status (now also EARNED -> VOIDED), immutable amount/identity, earned date and payout set once, and a
-- payout only settles commissions of its own environment, provider and currency under its own reference.
CREATE OR REPLACE FUNCTION core.provider_commissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider_commissions rows cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'payout_reference' - 'payout_id' - 'earned_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'payout_reference' - 'payout_id' - 'earned_at' - 'updated_at') THEN
    RAISE EXCEPTION 'provider commission amount and identity are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'EXPECTED' AND NEW.status IN ('EARNED', 'VOIDED'))
    OR (OLD.status = 'EARNED' AND NEW.status IN ('RECEIVED', 'VOIDED'))
  ) THEN
    RAISE EXCEPTION 'provider commission % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.payout_reference IS NOT NULL AND NEW.payout_reference IS DISTINCT FROM OLD.payout_reference THEN
    RAISE EXCEPTION 'payout reference can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.payout_id IS NOT NULL AND NEW.payout_id IS DISTINCT FROM OLD.payout_id THEN
    RAISE EXCEPTION 'payout can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.earned_at IS NOT NULL AND NEW.earned_at IS DISTINCT FROM OLD.earned_at THEN
    RAISE EXCEPTION 'earned date can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.payout_id IS NOT NULL AND NEW.payout_id IS DISTINCT FROM OLD.payout_id THEN
    SELECT environment, provider_id, currency, reference INTO p FROM core.commission_payouts WHERE id = NEW.payout_id;
    IF p.environment IS DISTINCT FROM NEW.environment OR p.provider_id IS DISTINCT FROM NEW.provider_id
       OR p.currency IS DISTINCT FROM NEW.currency OR p.reference IS DISTINCT FROM NEW.payout_reference THEN
      RAISE EXCEPTION 'payout % does not match the commission (environment, provider, currency, reference)', NEW.payout_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" DROP CONSTRAINT "provider_commissions_received_has_payout";--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD CONSTRAINT "provider_commissions_earned_has_date" CHECK (status NOT IN ('EARNED', 'RECEIVED') OR earned_at IS NOT NULL);--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD CONSTRAINT "provider_commissions_received_has_payout" CHECK (status <> 'RECEIVED' OR (payout_reference IS NOT NULL AND payout_id IS NOT NULL));--> statement-breakpoint

-- A payout is a fact from the statement: never edited or deleted.
CREATE TRIGGER commission_payouts_append_only BEFORE UPDATE OR DELETE ON core.commission_payouts
  FOR EACH ROW EXECUTE FUNCTION core.append_only();
--> statement-breakpoint

-- The commissions a payout settles add up to its commissions_minor (checked at commit, after they are linked).
CREATE OR REPLACE FUNCTION core.commission_payout_settles_its_sum() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settled bigint;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO settled FROM core.provider_commissions WHERE payout_id = NEW.id AND status = 'RECEIVED';
  IF settled <> NEW.commissions_minor THEN
    RAISE EXCEPTION 'payout % settles % but records %', NEW.id, settled, NEW.commissions_minor USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commission_payout_settles_its_sum
  AFTER INSERT ON core.commission_payouts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.commission_payout_settles_its_sum();
--> statement-breakpoint

INSERT INTO core.permissions (code, description_tr, description_en) VALUES
  ('commissions.record_payout', 'Sağlayıcının ödediği komisyonu (payout) ekstredeki referansıyla kaydetme', 'Record a commission payout from a provider with its statement reference');
