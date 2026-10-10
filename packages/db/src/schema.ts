import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  bigserial,
  foreignKey,
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
  environment: environmentEnum('environment'),
  /** Route preview chosen server-side for the search (payment mode decides the provider margin). */
  route: jsonb('route'),
  /**
   * Server-side offer snapshots (provider offer ids, exact prices). The client only receives offer keys, so it can
   * never choose a price by sending a provider offer id (§14).
   */
  results: jsonb('results'),
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
    /** Provider commission included in the supplier cost (PROVIDER_API margin, ADR-0006); supplier cost currency. */
    providerCommissionMinor: minor('provider_commission_minor').notNull().default(sql`0`),
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
  (t) => [
    uniqueIndex('quote_versions_quote_version_uq').on(t.quoteId, t.version),
    check('quote_versions_commission_within_cost', sql`provider_commission_minor >= 0 AND provider_commission_minor <= supplier_cost_minor`),
  ],
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

/**
 * Booking contact and room guests sent to the provider (personal data: restricted access, never logged, §17).
 * One row per order item; the provider needs a holder and one lead guest per room. Flights keep the passenger names
 * and types only: birth dates, nationality and travel documents go to the provider at prebook and are not stored
 * (ADR-0012, no retention period decided).
 */
export const orderItemGuests = core.table('order_item_guests', {
  orderItemId: uuid('order_item_id')
    .primaryKey()
    .references(() => orderItems.id),
  holder: jsonb('holder').notNull(),
  roomGuests: jsonb('room_guests').notNull(),
  passengers: jsonb('passengers'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

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
    /** Commission the provider reported on the booking (ADR-0006). */
    providerCommissionMinor: minor('provider_commission_minor'),
    providerCommissionCurrency: ccy('provider_commission_currency'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'provider_bookings_commission_pair',
      sql`(provider_commission_minor IS NULL) = (provider_commission_currency IS NULL) AND (provider_commission_minor IS NULL OR provider_commission_minor >= 0)`,
    ),
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
    /** PROVIDER_MANAGED (ADR-0008): transaction created with our prebook; never taken from a browser URL. */
    providerPrebookRef: text('provider_prebook_ref'),
    providerTransactionId: text('provider_transaction_id'),
    /** Short-lived client secret for the provider payment component; cleared once the payment is settled. */
    providerClientSecret: text('provider_client_secret'),
    /** When the secret was first handed to the customer's browser; services attach only before (ADR-0013). */
    providerSecretIssuedAt: ts('provider_secret_issued_at'),
    /** PROVIDER_MANAGED: an unpaid checkout is abandoned after this instant. */
    payBy: ts('pay_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'payment_attempts_provider_fields',
      sql`(provider_prebook_ref IS NULL) = (provider_transaction_id IS NULL) AND (mode = 'PROVIDER_MANAGED' OR (provider_prebook_ref IS NULL AND provider_client_secret IS NULL AND pay_by IS NULL))`,
    ),
    uniqueIndex('payment_attempts_provider_tx_uq').on(t.environment, t.providerTransactionId),
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

/**
 * Provider commission receivables (ADR-0006; spec §6: kept apart from customer money and supplier payables).
 * EXPECTED at booking confirmation, EARNED after the stay, RECEIVED with the provider payout reference, VOIDED when
 * the booking is cancelled. No ledger entry before EARNED: a confirmed booking is not an earned commission.
 */
export const providerCommissions = core.table(
  'provider_commissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    providerId: text('provider_id').notNull(),
    environment: environmentEnum('environment').notNull(),
    paymentMode: paymentModeEnum('payment_mode').notNull(),
    status: text('status', { enum: ['EXPECTED', 'EARNED', 'RECEIVED', 'VOIDED'] }).notNull(),
    /** BOOKING = amount the provider reported on the booking; QUOTE = from the accepted quote (not reported). */
    source: text('source', { enum: ['BOOKING', 'QUOTE'] }).notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency').notNull(),
    payoutReference: text('payout_reference'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('provider_commissions_item_uq').on(t.orderItemId),
    index('provider_commissions_provider_status_idx').on(t.providerId, t.status),
    check('provider_commissions_amount_positive', sql`amount_minor > 0`),
    check('provider_commissions_status_valid', sql`status IN ('EXPECTED', 'EARNED', 'RECEIVED', 'VOIDED')`),
    check('provider_commissions_source_valid', sql`source IN ('BOOKING', 'QUOTE')`),
    check('provider_commissions_received_has_payout', sql`status <> 'RECEIVED' OR payout_reference IS NOT NULL`),
  ],
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

/**
 * Customer e-mails sent for order events (P16): at most one per outbox event (the event id is the key). Holds the outcome
 * only; the address and the message body (personal data) are never stored here.
 */
export const customerNotifications = core.table(
  'customer_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    kind: text('kind', { enum: ['BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'REFUND_RECORDED', 'PAYMENT_NOT_BOOKED'] }).notNull(),
    /** SENDING: handed to the mailer, outcome not recorded yet (a crash here means it may be sent again). */
    status: text('status', { enum: ['SENDING', 'SENT', 'NOT_CONFIGURED'] }).notNull(),
    attempts: integer('attempts').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_notifications_event_uq').on(t.eventId), index('customer_notifications_order_idx').on(t.orderId)],
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
    /** FOUR_EYES = approved by someone else; SELF = author approved alone with `pricing_policy.approve_own` (ADR-0007). */
    approvalMode: text('approval_mode', { enum: ['FOUR_EYES', 'SELF'] }),
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
    // Every approval states its mode; a FOUR_EYES approver is neither the author nor the last editor. Whether the
    // approver held the needed permission is checked by the policy permission trigger (migration 0004).
    check(
      'pricing_policy_versions_approval_mode',
      sql`(approved_by IS NULL) = (approval_mode IS NULL) AND (approval_mode IS NULL OR approval_mode IN ('FOUR_EYES', 'SELF')) AND (approval_mode IS DISTINCT FROM 'FOUR_EYES' OR (approved_by <> created_by AND approved_by <> updated_by))`,
    ),
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
    /** FOUR_EYES = approved by someone else; SELF = author approved alone with `risk_policy.approve_own` (ADR-0007). */
    approvalMode: text('approval_mode', { enum: ['FOUR_EYES', 'SELF'] }),
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
    // Every approval states its mode; a FOUR_EYES approver is neither the author nor the last editor. Whether the
    // approver held the needed permission is checked by the policy permission trigger (migration 0004).
    check(
      'risk_policy_versions_approval_mode',
      sql`(approved_by IS NULL) = (approval_mode IS NULL) AND (approval_mode IS NULL OR approval_mode IN ('FOUR_EYES', 'SELF')) AND (approval_mode IS DISTINCT FROM 'FOUR_EYES' OR (approved_by <> created_by AND approved_by <> updated_by))`,
    ),
  ],
);

// ------------------------------------------------------------------ staff permissions (ADR-0007)

/** Permission catalog, seeded by migration from `PERMISSIONS` (packages/contracts/src/permissions.ts). */
export const permissions = core.table('permissions', {
  code: text('code').primaryKey(),
  descriptionTr: text('description_tr').notNull(),
  descriptionEn: text('description_en').notNull(),
});

/**
 * Who holds which permission. Rows are never deleted: a revoke records who and when, so the history is the audit
 * trail of the permissions screen. Grants and revokes need `permissions.manage` (DB trigger).
 */
export const staffPermissionGrants = core.table(
  'staff_permission_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: text('staff_id').notNull(),
    permission: text('permission')
      .notNull()
      .references(() => permissions.code),
    grantedBy: text('granted_by').notNull(),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    note: text('note'),
    revokedBy: text('revoked_by'),
    revokedAt: ts('revoked_at'),
    revokeNote: text('revoke_note'),
  },
  (t) => [
    uniqueIndex('staff_permission_grants_active_uq').on(t.staffId, t.permission).where(sql`revoked_at IS NULL`),
    index('staff_permission_grants_staff_idx').on(t.staffId),
    check('staff_permission_grants_revoke_pair', sql`(revoked_at IS NULL) = (revoked_by IS NULL)`),
  ],
);

// ------------------------------------------------------------------ staff identity (ADR-0010)

/**
 * Staff accounts of /yonetim. Separate from customers (§16). Passwords are scrypt hashes; the TOTP secret is sealed
 * with AES-256-GCM (STAFF_MFA_KEY) and is never readable from the database alone. Authority comes only from
 * core.staff_permission_grants (ADR-0007), whose staff_id is this table's id.
 */
export const staffUsers = core.table(
  'staff_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status', { enum: ['INVITED', 'ACTIVE', 'DISABLED'] }).notNull(),
    passwordHash: text('password_hash'),
    mfaSecret: text('mfa_secret'),
    mfaEnrolledAt: ts('mfa_enrolled_at'),
    /** Last accepted TOTP time step: a code is accepted once (replay protection). */
    mfaLastStep: integer('mfa_last_step'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('staff_users_email_uq').on(t.email),
    check('staff_users_email_normalized', sql`email = lower(btrim(email)) AND position('@' in email) > 1`),
    check('staff_users_active_has_password', sql`status <> 'ACTIVE' OR password_hash IS NOT NULL`),
    check('staff_users_mfa_pair', sql`(mfa_secret IS NULL) = (mfa_enrolled_at IS NULL)`),
  ],
);

/** Signed-in sessions. Only a SHA-256 of the cookie token is stored. `stage` is ACTIVE only after MFA. */
export const staffSessions = core.table(
  'staff_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffUsers.id),
    tokenHash: text('token_hash').notNull(),
    stage: text('stage', { enum: ['MFA_REQUIRED', 'MFA_ENROLL', 'ACTIVE'] }).notNull(),
    /** TOTP secret offered during enrollment (sealed), until the first code confirms it. */
    pendingMfaSecret: text('pending_mfa_secret'),
    mfaFailures: integer('mfa_failures').notNull().default(0),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [uniqueIndex('staff_sessions_token_uq').on(t.tokenHash), index('staff_sessions_staff_idx').on(t.staffId)],
);

/** One-time links for the first password (invite) or a password reset; only a SHA-256 of the token is stored. */
export const staffSetupTokens = core.table(
  'staff_setup_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffUsers.id),
    tokenHash: text('token_hash').notNull(),
    purpose: text('purpose', { enum: ['INVITE', 'PASSWORD_RESET'] }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('staff_setup_tokens_token_uq').on(t.tokenHash), index('staff_setup_tokens_staff_idx').on(t.staffId)],
);

/**
 * One-time MFA recovery codes (ADR-0010): only a keyed hash (HMAC with STAFF_MFA_KEY) is stored. A new batch replaces
 * the previous one; a used code keeps its row for the audit trail.
 */
export const staffRecoveryCodes = core.table(
  'staff_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffUsers.id),
    codeHash: text('code_hash').notNull(),
    batchId: uuid('batch_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    usedAt: ts('used_at'),
  },
  (t) => [uniqueIndex('staff_recovery_codes_hash_uq').on(t.staffId, t.codeHash), index('staff_recovery_codes_staff_idx').on(t.staffId)],
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

// ------------------------------------------------------------------ hotel list pages (ADR-0014)

/**
 * Hotel lists as last published in the CMS (`cms.hotel_lists`), written by the CMS after the publish commits: the
 * worker and the pages read only this copy (ADR-0003). `config` holds the sources and filters.
 */
export const hotelLists = core.table('hotel_lists', {
  cmsId: text('cms_id').primaryKey(),
  /** Address and title per language ({ tr: 'antalya' }); a language without an address has no page. */
  slugs: jsonb('slugs').notNull(),
  titles: jsonb('titles').notNull(),
  config: jsonb('config').notNull(),
  published: boolean('published').notNull(),
  /** The CMS document's updatedAt when mirrored: a page whose CMS copy differs shows no prices. */
  cmsUpdatedAt: text('cms_updated_at').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Price display settings per language (singleton row 'default'), mirrored from the CMS global. */
export const hotelListSettings = core.table('hotel_list_settings', {
  id: text('id').primaryKey(),
  settings: jsonb('settings').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * What one price scan covers: places and/or hotel ids, board type, currency, nationality, environment. Lists with the
 * same sources share a scope (and its provider calls). Inactive scopes keep their rows until housekeeping.
 */
export const hotelListScopes = core.table('hotel_list_scopes', {
  scopeKey: text('scope_key').primaryKey(),
  scope: jsonb('scope').notNull(),
  environment: environmentEnum('environment').notNull(),
  currency: ccy('currency').notNull(),
  active: boolean('active').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/**
 * One check-in date of a scope (1 night): the unit of work of the scanner. A day is claimed with a lease; only a
 * fully answered day replaces its prices (an UNKNOWN answer keeps the previous ones and retries later).
 */
export const hotelListDays = core.table(
  'hotel_list_days',
  {
    scopeKey: text('scope_key')
      .notNull()
      .references(() => hotelListScopes.scopeKey, { onDelete: 'cascade' }),
    checkin: text('checkin').notNull(),
    nextDueAt: ts('next_due_at').notNull(),
    lockedUntil: ts('locked_until'),
    lockedBy: text('locked_by'),
    attempts: integer('attempts').notNull().default(0),
    /** When the prices of this day were last replaced, and the pricing fingerprint they were computed with. */
    lastSuccessAt: ts('last_success_at'),
    fingerprint: text('fingerprint'),
    lastError: text('last_error'),
  },
  (t) => [primaryKey({ columns: [t.scopeKey, t.checkin] }), index('hotel_list_days_due_idx').on(t.nextDueAt)],
);

/** Lowest customer price of a hotel on a scope's check-in date, in the scope currency. */
export const hotelListPrices = core.table(
  'hotel_list_prices',
  {
    scopeKey: text('scope_key').notNull(),
    checkin: text('checkin').notNull(),
    hotelId: text('hotel_id').notNull(),
    sellMinor: minor('sell_minor').notNull(),
    /** Amount the guest pays at the hotel on top (city tax etc.) in the scope currency, when the provider states one. */
    payAtPropertyMinor: minor('pay_at_property_minor'),
    /** The provider states amounts payable at the hotel in another currency (shown as "plus local taxes"). */
    payAtPropertyOtherCurrency: boolean('pay_at_property_other_currency').notNull().default(false),
    boardType: text('board_type'),
  },
  (t) => [
    primaryKey({ columns: [t.scopeKey, t.checkin, t.hotelId] }),
    foreignKey({ columns: [t.scopeKey, t.checkin], foreignColumns: [hotelListDays.scopeKey, hotelListDays.checkin] }).onDelete('cascade'),
    check('hotel_list_prices_positive', sql`${t.sellMinor} > 0`),
  ],
);

/**
 * Hotels a scope has found, kept for a while after they stop appearing (availability changes daily; pages must not
 * flap in and out of the index).
 */
export const hotelListMembers = core.table(
  'hotel_list_members',
  {
    scopeKey: text('scope_key')
      .notNull()
      .references(() => hotelListScopes.scopeKey, { onDelete: 'cascade' }),
    hotelId: text('hotel_id').notNull(),
    summary: jsonb('summary').notNull(),
    /** The provider's order (top picks or price) on the latest day it was seen. */
    rank: integer('rank').notNull(),
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scopeKey, t.hotelId] })],
);

/** Shared pace of provider calls across worker processes (one row per budget). */
export const rateSlots = core.table('rate_slots', {
  name: text('name').primaryKey(),
  nextAt: ts('next_at').notNull(),
});

/** Static hotel content per language for hotel pages (`/data/hotel`); fetched slowly by the worker, never on request. */
export const hotelContent = core.table(
  'hotel_content',
  {
    environment: environmentEnum('environment').notNull(),
    hotelId: text('hotel_id').notNull(),
    language: text('language').notNull(),
    /** Address of the hotel page in this language ("akra-antalya-lp1897"). */
    slug: text('slug').notNull(),
    status: text('status', { enum: ['OK', 'NOT_FOUND'] }).notNull(),
    content: jsonb('content'),
    fetchedAt: ts('fetched_at').notNull(),
    nextFetchAt: ts('next_fetch_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.environment, t.hotelId, t.language] }),
    uniqueIndex('hotel_content_slug_uq').on(t.environment, t.language, t.slug),
    index('hotel_content_next_idx').on(t.nextFetchAt),
  ],
);

/**
 * List price accuracy (ADR-0014): a live search with the list reference (1 room, 2 adults, 1 night, the scope's
 * currency, nationality and board) compared with the stored list price of the same hotel and date. Written beside
 * searches visitors make anyway (no extra provider call); kept for a while for the panel report.
 */
export const hotelListPriceChecks = core.table(
  'hotel_list_price_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environment: environmentEnum('environment').notNull(),
    scopeKey: text('scope_key').notNull(),
    hotelId: text('hotel_id').notNull(),
    checkin: text('checkin').notNull(),
    currency: ccy('currency').notNull(),
    listMinor: minor('list_minor').notNull(),
    /** Lowest live price of the hotel on that date; null when a search for this very hotel found no bookable offer. */
    liveMinor: minor('live_minor'),
    /** When the list price was taken from the provider, and whether it was young enough to be on the pages. */
    listAsOf: ts('list_as_of').notNull(),
    shown: boolean('shown').notNull(),
    outcome: text('outcome', { enum: ['SAME', 'LIVE_HIGHER', 'LIVE_LOWER', 'LIVE_MISSING'] }).notNull(),
    checkedAt: ts('checked_at').notNull().defaultNow(),
  },
  (t) => [index('hotel_list_price_checks_at_idx').on(t.checkedAt), check('hotel_list_price_checks_list_positive', sql`${t.listMinor} > 0`)],
);

// ------------------------------------------------------------------ customer accounts (ADR-0017)

/**
 * One-time sign-in codes e-mailed to customers ("Rezervasyonlarım"). Only an HMAC of the code is stored; a code is
 * used once, expires in minutes and allows a few wrong tries.
 */
export const customerLoginCodes = core.table(
  'customer_login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environment: environmentEnum('environment').notNull(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('customer_login_codes_email_idx').on(t.environment, t.email, t.createdAt)],
);

/** Signed-in customer sessions: only a SHA-256 of the cookie token is stored. */
export const customerSessions = core.table(
  'customer_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    environment: environmentEnum('environment').notNull(),
    email: text('email').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('customer_sessions_expiry_idx').on(t.expiresAt)],
);
