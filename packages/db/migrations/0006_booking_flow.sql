CREATE TABLE "core"."order_item_guests" (
	"order_item_id" uuid PRIMARY KEY NOT NULL,
	"holder" jsonb NOT NULL,
	"room_guests" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."search_sessions" ADD COLUMN "environment" "core"."provider_environment";--> statement-breakpoint
ALTER TABLE "core"."search_sessions" ADD COLUMN "route" jsonb;--> statement-breakpoint
ALTER TABLE "core"."search_sessions" ADD COLUMN "results" jsonb;--> statement-breakpoint
ALTER TABLE "core"."order_item_guests" ADD CONSTRAINT "order_item_guests_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "core"."order_items"("id") ON DELETE no action ON UPDATE no action;