CREATE TABLE "core"."staff_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"stage" text NOT NULL,
	"pending_mfa_secret" text,
	"mfa_failures" integer DEFAULT 0 NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "core"."staff_setup_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"password_hash" text,
	"mfa_secret" text,
	"mfa_enrolled_at" timestamp with time zone,
	"mfa_last_step" integer,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_email_normalized" CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
	CONSTRAINT "staff_users_active_has_password" CHECK (status <> 'ACTIVE' OR password_hash IS NOT NULL),
	CONSTRAINT "staff_users_mfa_pair" CHECK ((mfa_secret IS NULL) = (mfa_enrolled_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE "core"."staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."staff_setup_tokens" ADD CONSTRAINT "staff_setup_tokens_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "core"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sessions_token_uq" ON "core"."staff_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_idx" ON "core"."staff_sessions" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_setup_tokens_token_uq" ON "core"."staff_setup_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "staff_setup_tokens_staff_idx" ON "core"."staff_setup_tokens" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_uq" ON "core"."staff_users" USING btree ("email");--> statement-breakpoint

-- Permissions of the /yonetim panel (ADR-0010); must equal PERMISSIONS in packages/contracts/src/permissions.ts (tested).
INSERT INTO core.permissions (code, description_tr, description_en) VALUES
  ('staff.manage', 'Personel hesabı açma (davet), kapatma, şifre ve MFA sıfırlama', 'Invite and disable staff accounts, reset their password and MFA'),
  ('orders.view', 'Siparişleri, misafir bilgilerini ve operasyon görevlerini görüntüleme', 'View orders, guest details and operation tasks'),
  ('orders.view_financials', 'Siparişlerde tedarikçi maliyeti, komisyon ve marjı görüntüleme', 'View supplier cost, commission and margin on orders'),
  ('tasks.manage', 'Operasyon görevlerini üstlenme ve gerekçeyle kapatma', 'Take operation tasks and close them with a resolution');
