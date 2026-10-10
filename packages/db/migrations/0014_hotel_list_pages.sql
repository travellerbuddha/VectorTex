CREATE TABLE "core"."hotel_content" (
	"environment" "core"."provider_environment" NOT NULL,
	"hotel_id" text NOT NULL,
	"language" text NOT NULL,
	"slug" text NOT NULL,
	"status" text NOT NULL,
	"content" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"next_fetch_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hotel_content_environment_hotel_id_language_pk" PRIMARY KEY("environment","hotel_id","language")
);
--> statement-breakpoint
CREATE TABLE "core"."hotel_list_days" (
	"scope_key" text NOT NULL,
	"checkin" text NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"fingerprint" text,
	"last_error" text,
	CONSTRAINT "hotel_list_days_scope_key_checkin_pk" PRIMARY KEY("scope_key","checkin")
);
--> statement-breakpoint
CREATE TABLE "core"."hotel_list_members" (
	"scope_key" text NOT NULL,
	"hotel_id" text NOT NULL,
	"summary" jsonb NOT NULL,
	"rank" integer NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "hotel_list_members_scope_key_hotel_id_pk" PRIMARY KEY("scope_key","hotel_id")
);
--> statement-breakpoint
CREATE TABLE "core"."hotel_list_prices" (
	"scope_key" text NOT NULL,
	"checkin" text NOT NULL,
	"hotel_id" text NOT NULL,
	"sell_minor" bigint NOT NULL,
	"pay_at_property_minor" bigint,
	"pay_at_property_other_currency" boolean DEFAULT false NOT NULL,
	"board_type" text,
	CONSTRAINT "hotel_list_prices_scope_key_checkin_hotel_id_pk" PRIMARY KEY("scope_key","checkin","hotel_id"),
	CONSTRAINT "hotel_list_prices_positive" CHECK ("core"."hotel_list_prices"."sell_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."hotel_list_scopes" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"scope" jsonb NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"currency" char(3) NOT NULL,
	"active" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."hotel_list_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."hotel_lists" (
	"cms_id" text PRIMARY KEY NOT NULL,
	"slugs" jsonb NOT NULL,
	"titles" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"published" boolean NOT NULL,
	"cms_updated_at" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."rate_slots" (
	"name" text PRIMARY KEY NOT NULL,
	"next_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."hotel_list_days" ADD CONSTRAINT "hotel_list_days_scope_key_hotel_list_scopes_scope_key_fk" FOREIGN KEY ("scope_key") REFERENCES "core"."hotel_list_scopes"("scope_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."hotel_list_members" ADD CONSTRAINT "hotel_list_members_scope_key_hotel_list_scopes_scope_key_fk" FOREIGN KEY ("scope_key") REFERENCES "core"."hotel_list_scopes"("scope_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."hotel_list_prices" ADD CONSTRAINT "hotel_list_prices_scope_key_checkin_hotel_list_days_scope_key_checkin_fk" FOREIGN KEY ("scope_key","checkin") REFERENCES "core"."hotel_list_days"("scope_key","checkin") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_content_slug_uq" ON "core"."hotel_content" USING btree ("environment","language","slug");--> statement-breakpoint
CREATE INDEX "hotel_content_next_idx" ON "core"."hotel_content" USING btree ("next_fetch_at");--> statement-breakpoint
CREATE INDEX "hotel_list_days_due_idx" ON "core"."hotel_list_days" USING btree ("next_due_at");