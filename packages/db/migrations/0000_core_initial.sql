CREATE SCHEMA IF NOT EXISTS "core";
--> statement-breakpoint
CREATE TYPE "core"."booking_status" AS ENUM('NEW', 'PREPARED', 'HELD', 'PENDING_CONFIRMATION', 'CONFIRMED', 'ISSUED', 'CANCEL_PENDING', 'CANCELLED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "core"."cancellation_status" AS ENUM('QUOTED', 'EXPIRED', 'REQUESTED', 'PROVIDER_PENDING', 'COMPLETED', 'REJECTED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "core"."provider_environment" AS ENUM('mock', 'sandbox', 'production');--> statement-breakpoint
CREATE TYPE "core"."fraud_verdict" AS ENUM('APPROVED', 'REVIEW', 'REJECTED', 'NOT_PROVIDED');--> statement-breakpoint
CREATE TYPE "core"."funding_method" AS ENUM('ACCOUNT_CARD', 'CREDIT_LINE', 'PROVIDER_MANAGED');--> statement-breakpoint
CREATE TYPE "core"."order_status" AS ENUM('DRAFT', 'PROCESSING', 'CONFIRMED', 'ACTION_REQUIRED', 'COMPENSATING', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "core"."outbox_status" AS ENUM('PENDING', 'DISPATCHED', 'COMPLETED', 'DEAD');--> statement-breakpoint
CREATE TYPE "core"."payment_mode" AS ENUM('OWN_GATEWAY', 'PROVIDER_MANAGED');--> statement-breakpoint
CREATE TYPE "core"."payment_status" AS ENUM('NEW', 'PENDING', 'REQUIRES_ACTION', 'FRAUD_REVIEW', 'AUTHORIZED', 'CAPTURE_PENDING', 'CAPTURED', 'DECLINED', 'VOID_PENDING', 'VOIDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "core"."policy_status" AS ENUM('DRAFT', 'APPROVED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "core"."product_type" AS ENUM('HOTEL', 'FLIGHT', 'EXPERIENCE', 'TRANSFER');--> statement-breakpoint
CREATE TYPE "core"."refund_status" AS ENUM('REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "core"."task_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "core"."ticketing_status" AS ENUM('NOT_REQUIRED', 'PENDING', 'ISSUED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "core"."audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."checkout_session_quotes" (
	"checkout_session_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "checkout_session_quotes_checkout_session_id_quote_version_id_pk" PRIMARY KEY("checkout_session_id","quote_version_id")
);
--> statement-breakpoint
CREATE TABLE "core"."checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"status" text NOT NULL,
	"route" jsonb NOT NULL,
	"charge_total_minor" bigint NOT NULL,
	"charge_currency" char(3) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."customer_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" "core"."refund_status" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"item_allocations" jsonb NOT NULL,
	"gateway_reference" text,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"locale" text NOT NULL,
	"agency_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."fx_rate_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"rate" numeric(30, 12) NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_sha256" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "core"."inbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"payload_sha256" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"journal_id" uuid NOT NULL,
	"order_id" uuid,
	"order_item_id" uuid,
	"account" text NOT NULL,
	"direction" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"kind" text NOT NULL,
	"reference" text,
	"reverses_entry_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."operation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid,
	"reason" text NOT NULL,
	"status" "core"."task_status" DEFAULT 'OPEN' NOT NULL,
	"detail" text NOT NULL,
	"assignee" text,
	"due_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_type" "core"."product_type" NOT NULL,
	"provider_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"charge_allocation_minor" bigint NOT NULL,
	"charge_currency" char(3) NOT NULL,
	"supplier_cost_minor" bigint NOT NULL,
	"supplier_cost_currency" char(3) NOT NULL,
	"funding_method" "core"."funding_method" NOT NULL,
	"funding_capability_id" text NOT NULL,
	"connector_meta" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkout_session_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"status" "core"."order_status" NOT NULL,
	"route" jsonb NOT NULL,
	"charge_total_minor" bigint NOT NULL,
	"charge_currency" char(3) NOT NULL,
	"compensation_reason" text,
	"agency_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "core"."outbox_status" DEFAULT 'PENDING' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"checkout_session_id" uuid NOT NULL,
	"mode" "core"."payment_mode" NOT NULL,
	"gateway_id" text NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"status" "core"."payment_status" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"local_idempotency_key" text NOT NULL,
	"session_ref" text,
	"gateway_payment_id" text,
	"fraud" "core"."fraud_verdict" DEFAULT 'NOT_PROVIDED' NOT NULL,
	"authorization_expires_at" timestamp with time zone,
	"mismatch" boolean DEFAULT false NOT NULL,
	"capture_rejected" boolean DEFAULT false NOT NULL,
	"intent" jsonb,
	"unknown_operation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."payment_item_transactions" (
	"payment_attempt_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"gateway_item_transaction_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	CONSTRAINT "payment_item_transactions_payment_attempt_id_order_item_id_pk" PRIMARY KEY("payment_attempt_id","order_item_id")
);
--> statement-breakpoint
CREATE TABLE "core"."pricing_policy_versions" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "core"."policy_status" NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_policy_versions_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "core"."provider_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"status" "core"."booking_status" NOT NULL,
	"client_reference" text,
	"client_reference_seq" integer DEFAULT 0 NOT NULL,
	"provider_booking_ref" text,
	"prebook_ref" text,
	"prebook_expires_at" timestamp with time zone,
	"pnr" text,
	"ticket_numbers" text[] DEFAULT '{}'::text[] NOT NULL,
	"ticketing" "core"."ticketing_status" NOT NULL,
	"voucher_ready" boolean DEFAULT false NOT NULL,
	"cancellation" "core"."cancellation_status",
	"pre_cancel_status" "core"."booking_status",
	"intent" jsonb,
	"unknown_operation" text,
	"lookup_attempts" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."quote_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"environment" "core"."provider_environment" NOT NULL,
	"offer_ref" text NOT NULL,
	"option" jsonb NOT NULL,
	"travelers" jsonb NOT NULL,
	"supplier_cost_minor" bigint NOT NULL,
	"supplier_cost_currency" char(3) NOT NULL,
	"sell_minor" bigint NOT NULL,
	"sell_currency" char(3) NOT NULL,
	"charge_now_minor" bigint NOT NULL,
	"charge_currency" char(3) NOT NULL,
	"fx" jsonb,
	"fees" jsonb NOT NULL,
	"pay_at_property" jsonb NOT NULL,
	"cancellation" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"pricing_policy_id" text NOT NULL,
	"pricing_policy_version" integer NOT NULL,
	"accepted_at" timestamp with time zone,
	"terms_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_session_id" uuid,
	"product_type" "core"."product_type" NOT NULL,
	"provider_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."risk_policy_versions" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "core"."policy_status" NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_policy_versions_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "core"."search_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_type" "core"."product_type" NOT NULL,
	"criteria" jsonb NOT NULL,
	"market" char(2),
	"guest_nationality" char(2),
	"locale" text NOT NULL,
	"display_currency" char(3) NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."supplier_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"method" "core"."funding_method" NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."travelers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birth_date" text,
	"nationality" char(2),
	"document_type" text,
	"document_number" text,
	"document_expiry" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."checkout_session_quotes" ADD CONSTRAINT "checkout_session_quotes_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "core"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."checkout_session_quotes" ADD CONSTRAINT "checkout_session_quotes_quote_version_id_quote_versions_id_fk" FOREIGN KEY ("quote_version_id") REFERENCES "core"."quote_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."checkout_sessions" ADD CONSTRAINT "checkout_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."customer_transactions" ADD CONSTRAINT "customer_transactions_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "core"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "core"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."ledger_entries" ADD CONSTRAINT "ledger_entries_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "core"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."operation_tasks" ADD CONSTRAINT "operation_tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "core"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."operation_tasks" ADD CONSTRAINT "operation_tasks_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "core"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "core"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."order_items" ADD CONSTRAINT "order_items_quote_version_id_quote_versions_id_fk" FOREIGN KEY ("quote_version_id") REFERENCES "core"."quote_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."orders" ADD CONSTRAINT "orders_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "core"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "core"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."payment_attempts" ADD CONSTRAINT "payment_attempts_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "core"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."payment_item_transactions" ADD CONSTRAINT "payment_item_transactions_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "core"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."payment_item_transactions" ADD CONSTRAINT "payment_item_transactions_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "core"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."provider_bookings" ADD CONSTRAINT "provider_bookings_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "core"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."quote_versions" ADD CONSTRAINT "quote_versions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "core"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."quotes" ADD CONSTRAINT "quotes_search_session_id_search_sessions_id_fk" FOREIGN KEY ("search_session_id") REFERENCES "core"."search_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."supplier_settlements" ADD CONSTRAINT "supplier_settlements_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "core"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."travelers" ADD CONSTRAINT "travelers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "core"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "core"."audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "customer_transactions_attempt_idx" ON "core"."customer_transactions" USING btree ("payment_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_events_source_key_uq" ON "core"."inbox_events" USING btree ("source","dedupe_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_journal_idx" ON "core"."ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_order_idx" ON "core"."ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_tasks_one_open_uq" ON "core"."operation_tasks" USING btree ("order_id","reason",coalesce("order_item_id"::text, '')) WHERE status = 'OPEN';--> statement-breakpoint
CREATE INDEX "operation_tasks_open_idx" ON "core"."operation_tasks" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_position_uq" ON "core"."order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_checkout_session_uq" ON "core"."orders" USING btree ("checkout_session_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "core"."orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "core"."outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "core"."outbox_events" USING btree ("aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_idem_uq" ON "core"."payment_attempts" USING btree ("local_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_gateway_payment_uq" ON "core"."payment_attempts" USING btree ("environment","gateway_id","gateway_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_one_live_per_checkout_uq" ON "core"."payment_attempts" USING btree ("checkout_session_id") WHERE status NOT IN ('DECLINED', 'VOIDED');--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_item_uq" ON "core"."provider_bookings" USING btree ("order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_bookings_client_ref_uq" ON "core"."provider_bookings" USING btree ("environment","client_reference");--> statement-breakpoint
CREATE INDEX "provider_bookings_status_idx" ON "core"."provider_bookings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_versions_quote_version_uq" ON "core"."quote_versions" USING btree ("quote_id","version");--> statement-breakpoint
CREATE INDEX "supplier_settlements_item_idx" ON "core"."supplier_settlements" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "travelers_customer_idx" ON "core"."travelers" USING btree ("customer_id");