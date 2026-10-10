CREATE TABLE "core"."hotel_list_price_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"scope_key" text NOT NULL,
	"hotel_id" text NOT NULL,
	"checkin" text NOT NULL,
	"currency" char(3) NOT NULL,
	"list_minor" bigint NOT NULL,
	"live_minor" bigint,
	"list_as_of" timestamp with time zone NOT NULL,
	"shown" boolean NOT NULL,
	"outcome" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hotel_list_price_checks_list_positive" CHECK ("core"."hotel_list_price_checks"."list_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX "hotel_list_price_checks_at_idx" ON "core"."hotel_list_price_checks" USING btree ("checked_at");