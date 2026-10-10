CREATE TABLE "core"."permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"description_tr" text NOT NULL,
	"description_en" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."staff_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"revoke_note" text,
	CONSTRAINT "staff_permission_grants_revoke_pair" CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
--> statement-breakpoint
ALTER TABLE "core"."pricing_policy_versions" DROP CONSTRAINT "pricing_policy_versions_four_eyes";--> statement-breakpoint
ALTER TABLE "core"."risk_policy_versions" DROP CONSTRAINT "risk_policy_versions_four_eyes";--> statement-breakpoint
ALTER TABLE "core"."pricing_policy_versions" ADD COLUMN "approval_mode" text;--> statement-breakpoint
ALTER TABLE "core"."risk_policy_versions" ADD COLUMN "approval_mode" text;--> statement-breakpoint
-- Versions approved before ADR-0007 were approved under the four-eyes CHECK: record that mode.
ALTER TABLE core.pricing_policy_versions DISABLE TRIGGER pricing_policy_immutable;--> statement-breakpoint
UPDATE core.pricing_policy_versions SET approval_mode = 'FOUR_EYES' WHERE approved_by IS NOT NULL;--> statement-breakpoint
ALTER TABLE core.pricing_policy_versions ENABLE TRIGGER pricing_policy_immutable;--> statement-breakpoint
ALTER TABLE core.risk_policy_versions DISABLE TRIGGER risk_policy_immutable;--> statement-breakpoint
UPDATE core.risk_policy_versions SET approval_mode = 'FOUR_EYES' WHERE approved_by IS NOT NULL;--> statement-breakpoint
ALTER TABLE core.risk_policy_versions ENABLE TRIGGER risk_policy_immutable;--> statement-breakpoint
ALTER TABLE "core"."staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_permission_permissions_code_fk" FOREIGN KEY ("permission") REFERENCES "core"."permissions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_permission_grants_active_uq" ON "core"."staff_permission_grants" USING btree ("staff_id","permission") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "staff_permission_grants_staff_idx" ON "core"."staff_permission_grants" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "core"."pricing_policy_versions" ADD CONSTRAINT "pricing_policy_versions_approval_mode" CHECK ((approved_by IS NULL) = (approval_mode IS NULL) AND (approval_mode IS NULL OR approval_mode IN ('FOUR_EYES', 'SELF')) AND (approval_mode IS DISTINCT FROM 'FOUR_EYES' OR (approved_by <> created_by AND approved_by <> updated_by)));--> statement-breakpoint
ALTER TABLE "core"."risk_policy_versions" ADD CONSTRAINT "risk_policy_versions_approval_mode" CHECK ((approved_by IS NULL) = (approval_mode IS NULL) AND (approval_mode IS NULL OR approval_mode IN ('FOUR_EYES', 'SELF')) AND (approval_mode IS DISTINCT FROM 'FOUR_EYES' OR (approved_by <> created_by AND approved_by <> updated_by)));--> statement-breakpoint

-- Permission catalog (ADR-0007); must equal PERMISSIONS in packages/contracts/src/permissions.ts (tested).
INSERT INTO core.permissions (code, description_tr, description_en) VALUES
  ('permissions.manage', 'Kullanıcılara izin verme ve izin geri alma', 'Grant and revoke staff permissions'),
  ('pricing_policy.edit', 'Fiyat politikası (marj, servis bedeli, kur) taslağı oluşturma ve düzenleme', 'Create and edit pricing policy drafts (margins, service fees, FX)'),
  ('pricing_policy.approve', 'Başka bir kullanıcının hazırladığı fiyat politikasını onaylama veya devreden çıkarma', 'Approve or retire pricing policies prepared by someone else'),
  ('pricing_policy.approve_own', 'Kendi hazırladığı fiyat politikasını tek başına onaylama (iki kişili onay aranmaz)', 'Approve own pricing policy changes alone (no second approver)'),
  ('risk_policy.edit', 'Risk politikası (tedarikçi riski, provizyon güvenlik payı, finansman sırası) taslağı oluşturma ve düzenleme', 'Create and edit risk policy drafts (supplier exposure, authorization safety margin, funding order)'),
  ('risk_policy.approve', 'Başka bir kullanıcının hazırladığı risk politikasını onaylama veya devreden çıkarma', 'Approve or retire risk policies prepared by someone else'),
  ('risk_policy.approve_own', 'Kendi hazırladığı risk politikasını tek başına onaylama (iki kişili onay aranmaz)', 'Approve own risk policy changes alone (no second approver)');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION core.staff_has_permission(staff text, perm text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM core.staff_permission_grants g WHERE g.staff_id = staff AND g.permission = perm AND g.revoked_at IS NULL)
$$;
--> statement-breakpoint

-- Grants: only a holder of permissions.manage grants or revokes. The very first manager is created once by the
-- bootstrap command (granted_by = 'system:bootstrap') while nobody holds permissions.manage. Rows are never deleted,
-- a revoke is recorded once, and the last active manager cannot be revoked (no lock-out).
CREATE OR REPLACE FUNCTION core.staff_permission_grants_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE managers int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'permission grants are never deleted (revoke instead)' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'a grant cannot be inserted already revoked' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.granted_by = 'system:bootstrap' THEN
      PERFORM pg_advisory_xact_lock(hashtext('core.permissions.manage'));
      SELECT count(*) INTO managers FROM core.staff_permission_grants WHERE permission = 'permissions.manage' AND revoked_at IS NULL;
      IF NEW.permission <> 'permissions.manage' OR managers > 0 THEN
        RAISE EXCEPTION 'bootstrap only creates the first permissions manager' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF NOT core.staff_has_permission(NEW.granted_by, 'permissions.manage') THEN
      RAISE EXCEPTION '% may not grant permissions', NEW.granted_by USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only the one-time revoke fields may change.
  IF (to_jsonb(NEW) - 'revoked_by' - 'revoked_at' - 'revoke_note') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_by' - 'revoked_at' - 'revoke_note') THEN
    RAISE EXCEPTION 'a permission grant is immutable except for its revoke' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'grant already revoked' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    IF NOT core.staff_has_permission(NEW.revoked_by, 'permissions.manage') THEN
      RAISE EXCEPTION '% may not revoke permissions', NEW.revoked_by USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.permission = 'permissions.manage' THEN
      PERFORM pg_advisory_xact_lock(hashtext('core.permissions.manage'));
      SELECT count(*) INTO managers FROM core.staff_permission_grants WHERE permission = 'permissions.manage' AND revoked_at IS NULL AND id <> OLD.id;
      IF managers = 0 THEN
        RAISE EXCEPTION 'the last permissions manager cannot be revoked' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER staff_permission_grants_guard BEFORE INSERT OR UPDATE OR DELETE ON core.staff_permission_grants
  FOR EACH ROW EXECUTE FUNCTION core.staff_permission_grants_guard();
--> statement-breakpoint

-- Policies: the editor must hold <kind>.edit; an approval needs <kind>.approve (FOUR_EYES) or <kind>.approve_own (SELF).
CREATE OR REPLACE FUNCTION core.policy_permission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prefix text := CASE TG_TABLE_NAME WHEN 'pricing_policy_versions' THEN 'pricing_policy' ELSE 'risk_policy' END;
BEGIN
  IF NEW.status = 'DRAFT' AND (TG_OP = 'INSERT' OR NEW.document IS DISTINCT FROM OLD.document OR NEW.updated_by IS DISTINCT FROM OLD.updated_by) THEN
    IF NOT core.staff_has_permission(NEW.updated_by, prefix || '.edit') THEN
      RAISE EXCEPTION '% lacks %', NEW.updated_by, prefix || '.edit' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPROVED') THEN
    IF NOT core.staff_has_permission(NEW.approved_by, prefix || CASE WHEN NEW.approval_mode = 'SELF' THEN '.approve_own' ELSE '.approve' END) THEN
      RAISE EXCEPTION '% lacks the permission for a % approval', NEW.approved_by, NEW.approval_mode USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER pricing_policy_permission BEFORE INSERT OR UPDATE ON core.pricing_policy_versions
  FOR EACH ROW EXECUTE FUNCTION core.policy_permission_guard();
--> statement-breakpoint
CREATE TRIGGER risk_policy_permission BEFORE INSERT OR UPDATE ON core.risk_policy_versions
  FOR EACH ROW EXECUTE FUNCTION core.policy_permission_guard();
