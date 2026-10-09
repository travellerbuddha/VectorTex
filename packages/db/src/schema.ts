import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Core booking/finance schema. Payload owns `cms`; nothing here references it (ADR-0003). */
export const core = pgSchema('core');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const minor = (name: string) => bigint(name, { mode: 'bigint' });
const ccy = (name: string) => char(name, { length: 3 });

export const environmentEnum = core.enum('provider_environment', ['mock', 'sandbox', 'production']);
export const productTypeEnum = core.enum('product_type', ['HOTEL', 'FLIGHT', 'EXPERIENCE', 'TRANSFER']);
export const paymentModeEnum = core.enum('payment_mode', ['OWN_GATEWAY', 'PROVIDER_MANAGED']);
export const fundingMethodEnum = core.enum('funding_method', ['ACCOUNT_CARD', 'CREDIT_LINE', 'PROVIDER_MANAGED']);
export const orderStatusEnum = core.enum('order_status', ['DRAFT', 'PROCESSING', 'CONFIRMED', 'ACTION_REQUIRED', 'COMPENSATING', 'CANCELLED']);
export const paymentStatusEnum = core.enum('payment_status', [
  'NEW',
  'PENDING',
  'REQUIRES_ACTION',
  'FRAUD_REVIEW',
  'AUTHORIZED',
  'CAPTURE_PENDING',
  'CAPTURED',
  'DECLINED',
  'VOID_PENDING',
  'VOIDED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'UNKNOWN',
]);
export const bookingStatusEnum = core.enum('booking_status', [
  'NEW',
  'PREPARED',
  'HELD',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'ISSUED',
  'CANCEL_PENDING',
  'CANCELLED',
  'FAILED',
  'UNKNOWN',
]);
export const ticketingStatusEnum = core.enum('ticketing_status', ['NOT_REQUIRED', 'PENDING', 'ISSUED', 'FAILED', 'UNKNOWN']);
export const cancellationStatusEnum = core.enum('cancellation_status', ['QUOTED', 'EXPIRED', 'REQUESTED', 'PROVIDER_PENDING', 'COMPLETED', 'REJECTED', 'UNKNOWN']);
export const refundStatusEnum = core.enum('refund_status', ['REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN']);
export const fraudVerdictEnum = core.enum('fraud_verdict', ['APPROVED', 'REVIEW', 'REJECTED', 'NOT_PROVIDED']);
export const outboxStatusEnum = core.enum('outbox_status', ['PENDING', 'DISPATCHED', 'COMPLETED', 'DEAD']);
export const taskStatusEnum = core.enum('task_status', ['OPEN', 'RESOLVED']);
export const policyStatusEnum = core.enum('policy_status', ['DRAFT', 'APPROVED', 'RETIRED']);

// ------------------------------------------------------------------ customers & travelers

export const customers = core.table('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: ['GUEST', 'REGISTERED'] }).notNull(),
  email: text('email').notNull(),
  emailVerifiedAt: ts('email_verified_at'),
  locale: text('locale', { enum: ['tr', 'en'] }).notNull(),
  /** Future B2B scope. A nullable column alone is not tenant isolation (§16); queries scope by it explicitly. */
  agencyId: uuid('agency_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const travelers = core.table(
  'travelers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    type: text('type', { enum: ['ADULT', 'CHILD', 'INFANT'] }).notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    birthDate: text('birth_date'),
    nationality: char('nationality', { length: 2 }),
    /** Identity document data: restricted role access, redacted in logs (§17). */
    documentType: text('document_type'),
    documentNumber: text('document_number'),
    documentExpiry: text('document_expiry'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('travelers_customer_idx').on(t.customerId)],
);

// ------------------------------------------------------------------ search & quotes

export const searchSessions = core.table('search_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  productType: productTypeEnum('product_type').notNull(),
  criteria: jsonb('criteria').notNull(),
  market: char('market', { length: 2 }),
  guestNationality: char('guest_nationality', { length: 2 }),
  locale: text('locale').notNull(),
  displayCurrency: ccy('display_currency').notNull(),
  status: text('status', { enum: ['RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED'] }).notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
});

export const quotes = core.table('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  searchSessionId: uuid('search_session_id').references(() => searchSessions.id),
  productType: productTypeEnum('product_type').notNull(),
  providerId: text('provider_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Immutable price/condition snapshot. A trigger forbids changes except the one-time acceptance. */
export const quoteVersions = core.table(
  'quote_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    version: integer('version').notNull(),
    environment: environmentEnum('environment').notNull(),
    offerRef: text('offer_ref').notNull(),
    option: jsonb('option').notNull(),
    travelers: jsonb('travelers').notNull(),
    supplierCostMinor: minor('supplier_cost_minor').notNull(),
    supplierCostCurrency: ccy('supplier_cost_currency').notNull(),
    sellMinor: minor('sell_minor').notNull(),
    sellCurrency: ccy('sell_currency').notNull(),
    chargeNowMinor: minor('charge_now_minor').notNull(),
    chargeCurrency: ccy('charge_currency').notNull(),
    fx: jsonb('fx'),
    fees: jsonb('fees').notNull(),
    payAtProperty: jsonb('pay_at_property').notNull(),
    cancellation: jsonb('cancellation').notNull(),
    expiresAt: ts('expires_at').notNull(),
    pricingPolicyId: text('pricing_policy_id').notNull(),
    pricingPolicyVersion: integer('pricing_policy_version').notNull(),
    acceptedAt: ts('accepted_at'),
    termsVersion: text('terms_version'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('quote_versions_quote_version_uq').on(t.quoteId, t.version)],
);

export const checkoutSessions = core.table('checkout_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  environment: environmentEnum('environment').notNull(),
  status: text('status', { enum: ['OPEN', 'SUBMITTED', 'EXPIRED', 'ABANDONED'] }).notNull(),
  /** Route snapshot selected server-side (§4.1); never taken from the client. */
  route: jsonb('route').notNull(),
  chargeTotalMinor: minor('charge_total_minor').notNull(),
  chargeCurrency: ccy('charge_currency').notNull(),
  expiresAt: ts('expires_at').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const checkoutSessionQuotes = core.table(
  'checkout_session_quotes',
  {
    checkoutSessionId: uuid('checkout_session_id')
      .notNull()
      .references(() => checkoutSessions.id),
    quoteVersionId: uuid('quote_version_id')
      .notNull()
      .references(() => quoteVersions.id),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.checkoutSessionId, t.quoteVersionId] })],
);

// ------------------------------------------------------------------ orders

export const orders = core.table(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    checkoutSessionId: uuid('checkout_session_id')
      .notNull()
      .references(() => checkoutSessions.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    environment: environmentEnum('environment').notNull(),
    status: orderStatusEnum('status').notNull(),
    route: jsonb('route').notNull(),
    chargeTotalMinor: minor('charge_total_minor').notNull(),
    chargeCurrency: ccy('charge_currency').notNull(),
    compensationReason: text('compensation_reason'),
    agencyId: uuid('agency_id'),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('orders_checkout_session_uq').on(t.checkoutSessionId), index('orders_status_idx').on(t.status)],
);

export const orderItems = core.table(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    position: integer('position').notNull(),
    productType: productTypeEnum('product_type').notNull(),
    providerId: text('provider_id').notNull(),
    connectorId: text('connector_id').notNull(),
    quoteVersionId: uuid('quote_version_id')
      .notNull()
      .references(() => quoteVersions.id),
    chargeAllocationMinor: minor('charge_allocation_minor').notNull(),
    chargeCurrency: ccy('charge_currency').notNull(),
    supplierCostMinor: minor('supplier_cost_minor').notNull(),
    supplierCostCurrency: ccy('supplier_cost_currency').notNull(),
    fundingMethod: fundingMethodEnum('funding_method').notNull(),
    fundingCapabilityId: text('funding_capability_id').notNull(),
    connectorMeta: jsonb('connector_meta').notNull(),
  },
  (t) => [uniqueIndex('order_items_order_position_uq').on(t.orderId, t.position)],
);

export const providerBookings = core.table(
  'provider_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    environment: environmentEnum('environment').notNull(),
    status: bookingStatusEnum('status').notNull(),
    clientReference: text('client_reference'),
    clientReferenceSeq: integer('client_reference_seq').notNull().default(0),
    providerBookingRef: text('provider_booking_ref'),
    prebookRef: text('prebook_ref'),
    prebookExpiresAt: ts('prebook_expires_at'),
    pnr: text('pnr'),
    ticketNumbers: text('ticket_numbers').array().notNull().default(sql`'{}'::text[]`),
    ticketing: ticketingStatusEnum('ticketing').notNull(),
    voucherReady: boolean('voucher_ready').notNull().default(false),
    cancellation: cancellationStatusEnum('cancellation'),
    preCancelStatus: bookingStatusEnum('pre_cancel_status'),
    intent: jsonb('intent'),
    unknownOperation: text('unknown_operation'),
    lookupAttempts: integer('lookup_attempts').notNull().default(0),
    failureCode: text('failure_code'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('provider_bookings_item_uq').on(t.orderItemId),
    // One client reference per booking intent, never reused (§8).
    uniqueIndex('provider_bookings_client_ref_uq').on(t.environment, t.clientReference),
    index('provider_bookings_status_idx').on(t.status),
  ],
);

// ------------------------------------------------------------------ payments

export const paymentAttempts = core.table(
  'payment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').references(() => orders.id),
    checkoutSessionId: uuid('checkout_session_id')
      .notNull()
      .references(() => checkoutSessions.id),
    mode: paymentModeEnum('mode').notNull(),
    gatewayId: text('gateway_id').notNull(),
    environment: environmentEnum('environment').notNull(),
    status: paymentStatusEnum('status').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency').notNull(),
    localIdempotencyKey: text('local_idempotency_key').notNull(),
    sessionRef: text('session_ref'),
    gatewayPaymentId: text('gateway_payment_id'),
    fraud: fraudVerdictEnum('fraud').notNull().default('NOT_PROVIDED'),
    authorizationExpiresAt: ts('authorization_expires_at'),
    mismatch: boolean('mismatch').notNull().default(false),
    captureRejected: boolean('capture_rejected').notNull().default(false),
    intent: jsonb('intent'),
    unknownOperation: text('unknown_operation'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_attempts_idem_uq').on(t.localIdempotencyKey),
    uniqueIndex('payment_attempts_gateway_payment_uq').on(t.environment, t.gatewayId, t.gatewayPaymentId),
    // Rule 6 / T21: at most one live attempt per checkout. A declined/voided one may be followed by a new one.
    uniqueIndex('payment_attempts_one_live_per_checkout_uq')
      .on(t.checkoutSessionId)
      .where(sql`status NOT IN ('DECLINED', 'VOIDED')`),
  ],
);

export const paymentItemTransactions = core.table(
  'payment_item_transactions',
  {
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    gatewayItemTransactionId: text('gateway_item_transaction_id').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency').notNull(),
  },
  (t) => [primaryKey({ columns: [t.paymentAttemptId, t.orderItemId] })],
);

/** Customer money movements through our gateway: authorization, capture, void, refund. */
export const customerTransactions = core.table(
  'customer_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id),
    kind: text('kind', { enum: ['AUTHORIZATION', 'CAPTURE', 'VOID', 'REFUND'] }).notNull(),
    status: refundStatusEnum('status').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency').notNull(),
    /** Per-item allocation of this movement (refunds follow the original allocation). */
    itemAllocations: jsonb('item_allocations').notNull(),
    gatewayReference: text('gateway_reference'),
    approvedBy: text('approved_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('customer_transactions_attempt_idx').on(t.paymentAttemptId)],
);

/** Supplier side: cost, penalties and supplier refunds, tracked apart from customer money. */
export const supplierSettlements = core.table(
  'supplier_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    providerId: text('provider_id').notNull(),
    method: fundingMethodEnum('method').notNull(),
    kind: text('kind', { enum: ['COST', 'PENALTY', 'SUPPLIER_REFUND'] }).notNull(),
    status: text('status', { enum: ['PLANNED', 'OWED', 'PAID', 'REFUND_PENDING', 'REFUNDED', 'WRITTEN_OFF'] }).notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency').notNull(),
    reason: text('reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('supplier_settlements_item_idx').on(t.orderItemId)],
);

/** Append-only double-entry style journal. Corrections are reversing entries (trigger blocks UPDATE/DELETE). */
export const ledgerEntries = core.table(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    journalId: uuid('journal_id').notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    orderItemId: uuid('order_item_id').references(() => orderItems.id),
    account: text('account').notNull(),
    direction: text('direction', { enum: ['DEBIT', 'CREDIT'] }).notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency').notNull(),
    kind: text('kind').notNull(),
    reference: text('reference'),
    reversesEntryId: bigint('reverses_entry_id', { mode: 'bigint' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('ledger_entries_journal_idx').on(t.journalId), index('ledger_entries_order_idx').on(t.orderId)],
);

// ------------------------------------------------------------------ durable messaging

export const outboxEvents = core.table(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('PENDING'),
    availableAt: ts('available_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    lockedUntil: ts('locked_until'),
    dispatchedAt: ts('dispatched_at'),
    completedAt: ts('completed_at'),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('outbox_events_pending_idx').on(t.status, t.availableAt), index('outbox_events_aggregate_idx').on(t.aggregateId)],
);

export const inboxEvents = core.table(
  'inbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    environment: environmentEnum('environment').notNull(),
    payloadSha256: text('payload_sha256').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [uniqueIndex('inbox_events_source_key_uq').on(t.source, t.dedupeKey)],
);

export const idempotencyKeys = core.table(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestSha256: text('request_sha256').notNull(),
    status: text('status', { enum: ['IN_PROGRESS', 'COMPLETED'] }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

// ------------------------------------------------------------------ operations & audit

export const operationTasks = core.table(
  'operation_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    orderItemId: uuid('order_item_id').references(() => orderItems.id),
    reason: text('reason').notNull(),
    status: taskStatusEnum('status').notNull().default('OPEN'),
    detail: text('detail').notNull(),
    assignee: text('assignee'),
    dueAt: ts('due_at'),
    resolution: text('resolution'),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('operation_tasks_one_open_uq')
      .on(t.orderId, t.reason, sql`coalesce(${t.orderItemId}::text, '')`)
      .where(sql`status = 'OPEN'`),
    index('operation_tasks_open_idx').on(t.status, t.createdAt),
  ],
);

export const auditLogs = core.table(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    detail: jsonb('detail').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_logs_entity_idx').on(t.entityType, t.entityId)],
);

// ------------------------------------------------------------------ approved business configuration

export const pricingPolicyVersions = core.table(
  'pricing_policy_versions',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    status: policyStatusEnum('status').notNull(),
    approvedBy: text('approved_by'),
    approvedAt: ts('approved_at'),
    document: jsonb('document').notNull(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    changeNote: text('change_note'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version] }),
    // Exactly one active (APPROVED) version per policy id.
    uniqueIndex('pricing_policy_versions_one_approved_uq').on(t.id).where(sql`status = 'APPROVED'`),
    // Four-eyes: whoever created or last edited a version cannot approve it.
    check('pricing_policy_versions_four_eyes', sql`approved_by IS NULL OR (approved_by <> created_by AND approved_by <> updated_by)`),
  ],
);

export const riskPolicyVersions = core.table(
  'risk_policy_versions',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    status: policyStatusEnum('status').notNull(),
    approvedBy: text('approved_by'),
    approvedAt: ts('approved_at'),
    document: jsonb('document').notNull(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    changeNote: text('change_note'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.version] }),
    // Exactly one active (APPROVED) version per policy id.
    uniqueIndex('risk_policy_versions_one_approved_uq').on(t.id).where(sql`status = 'APPROVED'`),
    // Four-eyes: whoever created or last edited a version cannot approve it.
    check('risk_policy_versions_four_eyes', sql`approved_by IS NULL OR (approved_by <> created_by AND approved_by <> updated_by)`),
  ],
);

export const fxRateSnapshots = core.table('fx_rate_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  base: ccy('base').notNull(),
  quote: ccy('quote').notNull(),
  rate: numeric('rate', { precision: 30, scale: 12 }).notNull(),
  source: text('source').notNull(),
  observedAt: ts('observed_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});
