CREATE TABLE "core"."customer_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."customer_notifications" ADD CONSTRAINT "customer_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "core"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notifications_event_uq" ON "core"."customer_notifications" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "customer_notifications_order_idx" ON "core"."customer_notifications" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "core"."customer_notifications" ADD CONSTRAINT "customer_notifications_kind_ck" CHECK ("kind" IN ('BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'REFUND_RECORDED', 'PAYMENT_NOT_BOOKED'));--> statement-breakpoint
ALTER TABLE "core"."customer_notifications" ADD CONSTRAINT "customer_notifications_status_ck" CHECK ("status" IN ('SENDING', 'SENT', 'NOT_CONFIGURED'));
