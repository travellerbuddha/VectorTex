-- Nuitee pays our commission when it collects the customer's payment (account owner, 2026-10-10; ADR-0019 rev. 2):
-- a payout can settle a commission before the stay (EXPECTED -> RECEIVED, an advance until the stay ends), and a
-- booking cancelled after its commission was paid owes it back until a later payout nets it (clawback_payout_id).

ALTER TABLE "core"."commission_payouts" DROP CONSTRAINT "commission_payouts_amounts_positive";--> statement-breakpoint
ALTER TABLE "core"."commission_payouts" DROP CONSTRAINT "commission_payouts_difference_explained";--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" DROP CONSTRAINT "provider_commissions_earned_has_date";--> statement-breakpoint
ALTER TABLE "core"."commission_payouts" ADD COLUMN "clawbacks_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD COLUMN "clawback_payout_id" uuid;--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD CONSTRAINT "provider_commissions_clawback_payout_id_commission_payouts_id_fk" FOREIGN KEY ("clawback_payout_id") REFERENCES "core"."commission_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_commissions_clawback_idx" ON "core"."provider_commissions" USING btree ("clawback_payout_id");--> statement-breakpoint
ALTER TABLE "core"."commission_payouts" ADD CONSTRAINT "commission_payouts_amounts_valid" CHECK (amount_minor >= 0 AND commissions_minor > 0 AND clawbacks_minor >= 0 AND clawbacks_minor <= commissions_minor);--> statement-breakpoint
ALTER TABLE "core"."commission_payouts" ADD CONSTRAINT "commission_payouts_difference_explained" CHECK (amount_minor = commissions_minor - clawbacks_minor OR length(btrim(coalesce(note, ''))) >= 5);--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD CONSTRAINT "provider_commissions_clawback_valid" CHECK (clawback_payout_id IS NULL OR (status = 'VOIDED' AND payout_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "core"."provider_commissions" ADD CONSTRAINT "provider_commissions_earned_has_date" CHECK (status <> 'EARNED' OR earned_at IS NOT NULL);--> statement-breakpoint

-- Status: EXPECTED -> EARNED | RECEIVED | VOIDED; EARNED -> RECEIVED | VOIDED; RECEIVED -> VOIDED only while not
-- earned (cancelled before the end of the stay). The earned date, payout and clawback are each set once; a payout or
-- clawback must be of the commission's environment, provider and currency (a payout also of its reference).
CREATE OR REPLACE FUNCTION core.provider_commissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider_commissions rows cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'payout_reference' - 'payout_id' - 'clawback_payout_id' - 'earned_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'payout_reference' - 'payout_id' - 'clawback_payout_id' - 'earned_at' - 'updated_at') THEN
    RAISE EXCEPTION 'provider commission amount and identity are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'EXPECTED' AND NEW.status IN ('EARNED', 'RECEIVED', 'VOIDED'))
    OR (OLD.status = 'EARNED' AND NEW.status IN ('RECEIVED', 'VOIDED'))
    OR (OLD.status = 'RECEIVED' AND NEW.status = 'VOIDED' AND OLD.earned_at IS NULL AND NEW.earned_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'provider commission % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.payout_reference IS NOT NULL AND NEW.payout_reference IS DISTINCT FROM OLD.payout_reference THEN
    RAISE EXCEPTION 'payout reference can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.payout_id IS NOT NULL AND NEW.payout_id IS DISTINCT FROM OLD.payout_id THEN
    RAISE EXCEPTION 'payout can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.clawback_payout_id IS NOT NULL AND NEW.clawback_payout_id IS DISTINCT FROM OLD.clawback_payout_id THEN
    RAISE EXCEPTION 'clawback can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.earned_at IS NOT NULL AND NEW.earned_at IS DISTINCT FROM OLD.earned_at THEN
    RAISE EXCEPTION 'earned date can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.earned_at IS NOT NULL AND OLD.earned_at IS NULL AND NEW.status NOT IN ('EARNED', 'RECEIVED') THEN
    RAISE EXCEPTION 'only an earned or received commission gets an earned date' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.payout_id IS NOT NULL AND NEW.payout_id IS DISTINCT FROM OLD.payout_id THEN
    SELECT environment, provider_id, currency, reference INTO p FROM core.commission_payouts WHERE id = NEW.payout_id;
    IF p.environment IS DISTINCT FROM NEW.environment OR p.provider_id IS DISTINCT FROM NEW.provider_id
       OR p.currency IS DISTINCT FROM NEW.currency OR p.reference IS DISTINCT FROM NEW.payout_reference THEN
      RAISE EXCEPTION 'payout % does not match the commission (environment, provider, currency, reference)', NEW.payout_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.clawback_payout_id IS NOT NULL AND NEW.clawback_payout_id IS DISTINCT FROM OLD.clawback_payout_id THEN
    SELECT environment, provider_id, currency INTO p FROM core.commission_payouts WHERE id = NEW.clawback_payout_id;
    IF p.environment IS DISTINCT FROM NEW.environment OR p.provider_id IS DISTINCT FROM NEW.provider_id OR p.currency IS DISTINCT FROM NEW.currency THEN
      RAISE EXCEPTION 'payout % does not match the commission it nets (environment, provider, currency)', NEW.clawback_payout_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint

-- A payout's recorded sums equal the commissions it settles and the ones it nets (checked at commit).
CREATE OR REPLACE FUNCTION core.commission_payout_settles_its_sum() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settled bigint; netted bigint;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO settled FROM core.provider_commissions WHERE payout_id = NEW.id;
  SELECT COALESCE(SUM(amount_minor), 0) INTO netted FROM core.provider_commissions WHERE clawback_payout_id = NEW.id;
  IF settled <> NEW.commissions_minor OR netted <> NEW.clawbacks_minor THEN
    RAISE EXCEPTION 'payout % settles % and nets % but records % and %', NEW.id, settled, netted, NEW.commissions_minor, NEW.clawbacks_minor USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
