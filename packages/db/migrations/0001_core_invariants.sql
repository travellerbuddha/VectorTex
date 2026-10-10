-- Core invariants enforced by the database, independent of application code.

-- 1) Quote versions are immutable price/condition snapshots. Only the one-time customer acceptance may be set.
CREATE OR REPLACE FUNCTION core.quote_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quote_versions are immutable (delete refused)' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.accepted_at IS NOT NULL AND (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.terms_version IS DISTINCT FROM OLD.terms_version) THEN
    RAISE EXCEPTION 'quote_versions acceptance can be set only once' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - 'accepted_at' - 'terms_version') IS DISTINCT FROM (to_jsonb(OLD) - 'accepted_at' - 'terms_version') THEN
    RAISE EXCEPTION 'quote_versions price/condition snapshot is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER quote_versions_immutable BEFORE UPDATE OR DELETE ON core.quote_versions
  FOR EACH ROW EXECUTE FUNCTION core.quote_versions_immutable();
--> statement-breakpoint

-- 2) Ledger and audit are append-only. Corrections use reversing entries.
CREATE OR REPLACE FUNCTION core.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON core.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION core.append_only();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON core.audit_logs
  FOR EACH ROW EXECUTE FUNCTION core.append_only();
--> statement-breakpoint

-- 3) Approved business policies are immutable; the only allowed change is APPROVED -> RETIRED.
CREATE OR REPLACE FUNCTION core.policy_immutable_when_approved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'approved/retired policy cannot be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'APPROVED' THEN
    IF NEW.status <> 'RETIRED' OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
      RAISE EXCEPTION 'approved policy is immutable (only APPROVED -> RETIRED)' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'retired policy is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'approval requires approved_by and approved_at' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pricing_policy_immutable BEFORE UPDATE OR DELETE ON core.pricing_policy_versions
  FOR EACH ROW EXECUTE FUNCTION core.policy_immutable_when_approved();
--> statement-breakpoint
CREATE TRIGGER risk_policy_immutable BEFORE UPDATE OR DELETE ON core.risk_policy_versions
  FOR EACH ROW EXECUTE FUNCTION core.policy_immutable_when_approved();
--> statement-breakpoint

-- 4) Every order update must go through optimistic concurrency (version + 1).
CREATE OR REPLACE FUNCTION core.orders_version_bump() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'orders.version must increase by exactly 1 per update' USING ERRCODE = 'serialization_failure';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER orders_version_bump BEFORE UPDATE ON core.orders
  FOR EACH ROW EXECUTE FUNCTION core.orders_version_bump();
--> statement-breakpoint

-- 5) Sandbox and production records never mix (T15).
CREATE OR REPLACE FUNCTION core.booking_environment_matches_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_env core.provider_environment;
BEGIN
  SELECT o.environment INTO order_env FROM core.order_items i JOIN core.orders o ON o.id = i.order_id WHERE i.id = NEW.order_item_id;
  IF order_env IS DISTINCT FROM NEW.environment THEN
    RAISE EXCEPTION 'provider booking environment % does not match order environment %', NEW.environment, order_env USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_bookings_environment BEFORE INSERT OR UPDATE OF environment ON core.provider_bookings
  FOR EACH ROW EXECUTE FUNCTION core.booking_environment_matches_order();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION core.payment_environment_matches_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE checkout_env core.provider_environment;
BEGIN
  SELECT c.environment INTO checkout_env FROM core.checkout_sessions c WHERE c.id = NEW.checkout_session_id;
  IF checkout_env IS DISTINCT FROM NEW.environment THEN
    RAISE EXCEPTION 'payment environment % does not match checkout environment %', NEW.environment, checkout_env USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_attempts_environment BEFORE INSERT OR UPDATE OF environment ON core.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION core.payment_environment_matches_checkout();
--> statement-breakpoint

-- 6) Money sanity checks.
ALTER TABLE core.ledger_entries ADD CONSTRAINT ledger_entries_amount_positive CHECK (amount_minor > 0);
--> statement-breakpoint
ALTER TABLE core.payment_attempts ADD CONSTRAINT payment_attempts_amount_positive CHECK (amount_minor > 0);
--> statement-breakpoint
ALTER TABLE core.customer_transactions ADD CONSTRAINT customer_transactions_amount_nonnegative CHECK (amount_minor >= 0);
--> statement-breakpoint
ALTER TABLE core.order_items ADD CONSTRAINT order_items_allocation_nonnegative CHECK (charge_allocation_minor >= 0);
--> statement-breakpoint
ALTER TABLE core.quote_versions ADD CONSTRAINT quote_versions_charge_nonnegative CHECK (charge_now_minor >= 0);
--> statement-breakpoint

-- 7) Order item allocations must sum exactly to the order total (T01), checked at commit time.
CREATE OR REPLACE FUNCTION core.order_allocation_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid; total bigint; allocated bigint; ccy_mismatch int;
BEGIN
  oid := COALESCE(NEW.order_id, OLD.order_id);
  SELECT charge_total_minor INTO total FROM core.orders WHERE id = oid;
  SELECT COALESCE(SUM(charge_allocation_minor), 0) INTO allocated FROM core.order_items WHERE order_id = oid;
  SELECT COUNT(*) INTO ccy_mismatch FROM core.order_items i JOIN core.orders o ON o.id = i.order_id WHERE i.order_id = oid AND i.charge_currency <> o.charge_currency;
  IF total IS NOT NULL AND (allocated <> total OR ccy_mismatch > 0) THEN
    RAISE EXCEPTION 'order % item allocations (%) do not equal order total (%)', oid, allocated, total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER order_items_allocation_balanced AFTER INSERT OR UPDATE OR DELETE ON core.order_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.order_allocation_balanced();
