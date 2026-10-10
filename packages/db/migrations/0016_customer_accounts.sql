CREATE TABLE "core"."customer_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."customer_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "customer_login_codes_email_idx" ON "core"."customer_login_codes" USING btree ("environment","email","created_at");--> statement-breakpoint
CREATE INDEX "customer_sessions_expiry_idx" ON "core"."customer_sessions" USING btree ("expires_at");