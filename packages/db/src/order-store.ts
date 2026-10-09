import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { DomainError, VersionConflictError, opaque, type FraudVerdict, type HoldSemantics, type PaymentRoute } from '@texholiday/contracts';
import type { OrderAggregate, OrderItemState, OrderStore, PaymentState, TaskState } from '@texholiday/domain';
import { money } from '@texholiday/pricing';
import type { CoreDb } from './client';
import {
  auditLogs,
  customerTransactions,
  ledgerEntries,
  operationTasks,
  orderItems,
  orders,
  outboxEvents,
  paymentAttempts,
  paymentItemTransactions,
  providerBookings,
  providerCommissions,
  quoteVersions,
  supplierSettlements,
} from './schema';

interface ConnectorMeta {
  holdSemantics: HoldSemantics;
  reversibilityRank: number;
  requiresIssuance: boolean;
  needsPrebook: boolean;
}

/** PostgreSQL implementation of the domain OrderStore (ADR-0004). */
export class DrizzleOrderStore implements OrderStore {
  constructor(private readonly db: CoreDb) {}

  async load(orderId: string): Promise<OrderAggregate> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new DomainError('NOT_FOUND', `Order ${orderId} not found`, { httpStatus: 404 });

    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.position));
    const itemIds = items.map((i) => i.id);
    const bookings = itemIds.length ? await this.db.select().from(providerBookings).where(inArray(providerBookings.orderItemId, itemIds)) : [];
    const [attempt] = await this.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, orderId)).orderBy(desc(paymentAttempts.createdAt)).limit(1);
    const itemTx = attempt ? await this.db.select().from(paymentItemTransactions).where(eq(paymentItemTransactions.paymentAttemptId, attempt.id)) : [];
    // Provider-managed refunds recorded by staff (the provider made them; ADR-0008).
    const refunds = attempt
      ? await this.db
          .select()
          .from(customerTransactions)
          .where(and(eq(customerTransactions.paymentAttemptId, attempt.id), eq(customerTransactions.kind, 'REFUND'), eq(customerTransactions.status, 'SUCCEEDED')))
          .orderBy(asc(customerTransactions.createdAt))
      : [];
    const tasks = await this.db.select().from(operationTasks).where(and(eq(operationTasks.orderId, orderId), eq(operationTasks.status, 'OPEN')));
    const quoteIds = items.map((i) => i.quoteVersionId);
    const quoteCommissions = quoteIds.length
      ? await this.db
          .select({ id: quoteVersions.id, minor: quoteVersions.providerCommissionMinor, currency: quoteVersions.supplierCostCurrency })
          .from(quoteVersions)
          .where(inArray(quoteVersions.id, quoteIds))
      : [];
    const losses = itemIds.length
      ? await this.db.select().from(supplierSettlements).where(and(inArray(supplierSettlements.orderItemId, itemIds), eq(supplierSettlements.kind, 'PENALTY')))
      : [];

    const itemStates: OrderItemState[] = items.map((i) => {
      const b = bookings.find((x) => x.orderItemId === i.id);
      if (!b) throw new Error(`Order item ${i.id} has no provider booking row`);
      const qc = quoteCommissions.find((q) => q.id === i.quoteVersionId);
      if (!qc) throw new Error(`Order item ${i.id} has no quote version row`);
      return {
        id: i.id,
        productType: i.productType,
        providerId: i.providerId,
        connectorId: i.connectorId,
        quoteVersionId: i.quoteVersionId,
        chargeAllocation: money(i.chargeCurrency, i.chargeAllocationMinor),
        supplierCost: money(i.supplierCostCurrency, i.supplierCostMinor),
        expectedProviderCommission: money(qc.currency, qc.minor),
        funding: { method: i.fundingMethod, capabilityId: i.fundingCapabilityId },
        connector: i.connectorMeta as ConnectorMeta,
        booking: {
          id: b.id,
          status: b.status,
          clientReference: b.clientReference,
          clientReferenceSeq: b.clientReferenceSeq,
          providerBookingRef: b.providerBookingRef ? opaque(b.providerBookingRef) : null,
          prebookRef: b.prebookRef ? opaque(b.prebookRef) : null,
          prebookExpiresAt: b.prebookExpiresAt ? new Date(b.prebookExpiresAt).toISOString() : null,
          pnr: b.pnr,
          ticketNumbers: b.ticketNumbers,
          ticketing: b.ticketing,
          voucherReady: b.voucherReady,
          cancellation: b.cancellation,
          preCancelStatus: b.preCancelStatus,
          intent: b.intent as OrderItemState['booking']['intent'],
          unknownOperation: b.unknownOperation as OrderItemState['booking']['unknownOperation'],
          lookupAttempts: b.lookupAttempts,
          failureCode: b.failureCode,
          providerCommission: b.providerCommissionMinor !== null && b.providerCommissionCurrency ? money(b.providerCommissionCurrency, b.providerCommissionMinor) : null,
        },
      };
    });

    const payment: PaymentState | null = attempt
      ? {
          id: attempt.id,
          createdAt: new Date(attempt.createdAt).toISOString(),
          gatewayId: attempt.gatewayId,
          status: attempt.status,
          amount: money(attempt.currency, attempt.amountMinor),
          sessionRef: attempt.sessionRef,
          gatewayPaymentId: attempt.gatewayPaymentId,
          fraud: attempt.fraud as FraudVerdict,
          authorizationExpiresAt: attempt.authorizationExpiresAt ? new Date(attempt.authorizationExpiresAt).toISOString() : null,
          mismatch: attempt.mismatch,
          captureRejected: attempt.captureRejected,
          intent: attempt.intent as PaymentState['intent'],
          unknownOperation: attempt.unknownOperation as PaymentState['unknownOperation'],
          itemTransactions: itemTx.map((t) => ({ itemId: t.orderItemId, gatewayItemTransactionId: t.gatewayItemTransactionId, amount: money(t.currency, t.amountMinor) })),
          providerTransaction:
            attempt.providerPrebookRef && attempt.providerTransactionId ? { prebookRef: opaque(attempt.providerPrebookRef), transactionId: opaque(attempt.providerTransactionId) } : null,
          providerClientSecret: attempt.providerClientSecret,
          payBy: attempt.payBy ? new Date(attempt.payBy).toISOString() : null,
          providerRefunds: refunds.map((r) => ({
            id: r.id,
            amount: money(r.currency, r.amountMinor),
            reference: r.gatewayReference ?? '',
            recordedBy: r.approvedBy ?? '',
            recordedAt: new Date(r.createdAt).toISOString(),
          })),
        }
      : null;

    return {
      id: order.id,
      version: order.version,
      environment: order.environment,
      status: order.status,
      route: order.route as PaymentRoute,
      chargeTotal: money(order.chargeCurrency, order.chargeTotalMinor),
      compensationReason: order.compensationReason,
      items: itemStates,
      payment,
      tasks: tasks.map((t): TaskState => ({ id: t.id, reason: t.reason as TaskState['reason'], itemId: t.orderItemId, status: t.status, detail: t.detail })),
      supplierLosses: losses.map((l) => ({ id: l.id, itemId: l.orderItemId, amount: money(l.currency, l.amountMinor), reason: l.reason ?? '' })),
      pendingEvents: [],
      pendingAudit: [],
      pendingCommissions: [],
    };
  }

  async save(agg: OrderAggregate): Promise<number> {
    const nextVersion = agg.version + 1;
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(orders)
        .set({ status: agg.status, compensationReason: agg.compensationReason, version: nextVersion })
        .where(and(eq(orders.id, agg.id), eq(orders.version, agg.version)))
        .returning({ id: orders.id });
      if (updated.length === 0) throw new VersionConflictError('order', agg.id);

      for (const it of agg.items) {
        const b = it.booking;
        await tx
          .update(providerBookings)
          .set({
            status: b.status,
            clientReference: b.clientReference,
            clientReferenceSeq: b.clientReferenceSeq,
            providerBookingRef: b.providerBookingRef,
            prebookRef: b.prebookRef,
            prebookExpiresAt: b.prebookExpiresAt,
            pnr: b.pnr,
            ticketNumbers: [...b.ticketNumbers],
            ticketing: b.ticketing,
            voucherReady: b.voucherReady,
            cancellation: b.cancellation,
            preCancelStatus: b.preCancelStatus,
            intent: b.intent,
            unknownOperation: b.unknownOperation,
            lookupAttempts: b.lookupAttempts,
            failureCode: b.failureCode,
            providerCommissionMinor: b.providerCommission?.minor ?? null,
            providerCommissionCurrency: b.providerCommission?.currency ?? null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(providerBookings.id, b.id));
      }

      const p = agg.payment;
      if (p) {
        await tx
          .update(paymentAttempts)
          .set({
            status: p.status,
            sessionRef: p.sessionRef,
            gatewayPaymentId: p.gatewayPaymentId,
            fraud: p.fraud,
            authorizationExpiresAt: p.authorizationExpiresAt,
            mismatch: p.mismatch,
            captureRejected: p.captureRejected,
            intent: p.intent,
            unknownOperation: p.unknownOperation,
            providerPrebookRef: p.providerTransaction?.prebookRef ?? null,
            providerTransactionId: p.providerTransaction?.transactionId ?? null,
            providerClientSecret: p.providerClientSecret,
            payBy: p.payBy,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(paymentAttempts.id, p.id));
        for (const r of p.providerRefunds) {
          if (r.id) continue;
          const [row] = await tx
            .insert(customerTransactions)
            .values({
              paymentAttemptId: p.id,
              kind: 'REFUND',
              status: 'SUCCEEDED',
              amountMinor: r.amount.minor,
              currency: r.amount.currency,
              // Single-item provider-managed order: the whole refund belongs to its item.
              itemAllocations: agg.items.map((i) => ({ itemId: i.id, currency: r.amount.currency, minor: r.amount.minor.toString() })),
              gatewayReference: r.reference,
              approvedBy: r.recordedBy,
              createdAt: r.recordedAt,
            })
            .returning({ id: customerTransactions.id });
          r.id = row!.id;
        }
        for (const t of p.itemTransactions) {
          await tx
            .insert(paymentItemTransactions)
            .values({ paymentAttemptId: p.id, orderItemId: t.itemId, gatewayItemTransactionId: t.gatewayItemTransactionId, amountMinor: t.amount.minor, currency: t.amount.currency })
            .onConflictDoNothing();
        }
      }

      for (const task of agg.tasks) {
        if (task.id) continue;
        const [row] = await tx
          .insert(operationTasks)
          .values({ orderId: agg.id, orderItemId: task.itemId, reason: task.reason, status: task.status, detail: task.detail })
          .onConflictDoNothing()
          .returning({ id: operationTasks.id });
        if (row) task.id = row.id;
      }

      for (const loss of agg.supplierLosses) {
        if (loss.id) continue;
        const it = agg.items.find((i) => i.id === loss.itemId);
        if (!it) throw new Error(`Supplier loss for unknown item ${loss.itemId}`);
        const [row] = await tx
          .insert(supplierSettlements)
          .values({
            orderItemId: loss.itemId,
            providerId: it.providerId,
            method: it.funding.method,
            kind: 'PENALTY',
            status: 'OWED',
            amountMinor: loss.amount.minor,
            currency: loss.amount.currency,
            reason: loss.reason,
          })
          .returning({ id: supplierSettlements.id });
        loss.id = row!.id;
        // Balanced journal: expense vs. supplier payable. Never a customer receivable.
        await tx.insert(ledgerEntries).values([
          { journalId: row!.id, orderId: agg.id, orderItemId: loss.itemId, account: 'expense:supplier_penalty', direction: 'DEBIT', amountMinor: loss.amount.minor, currency: loss.amount.currency, kind: 'SUPPLIER_PENALTY', reference: loss.reason },
          { journalId: row!.id, orderId: agg.id, orderItemId: loss.itemId, account: `liability:supplier_payable:${it.providerId}`, direction: 'CREDIT', amountMinor: loss.amount.minor, currency: loss.amount.currency, kind: 'SUPPLIER_PENALTY', reference: loss.reason },
        ]);
      }

      // Commission receivables (ADR-0006): idempotent, so a replayed confirmation or cancellation is a no-op.
      for (const change of agg.pendingCommissions) {
        const it = agg.items.find((i) => i.id === change.itemId);
        if (!it) throw new Error(`Commission change for unknown item ${change.itemId}`);
        if (change.kind === 'EXPECTED') {
          await tx
            .insert(providerCommissions)
            .values({
              orderItemId: it.id,
              providerId: it.providerId,
              environment: agg.environment,
              paymentMode: agg.route.mode,
              status: 'EXPECTED',
              source: change.source,
              amountMinor: change.amount.minor,
              currency: change.amount.currency,
            })
            .onConflictDoNothing();
        } else {
          await tx
            .update(providerCommissions)
            .set({ status: 'VOIDED' })
            .where(and(eq(providerCommissions.orderItemId, it.id), eq(providerCommissions.status, 'EXPECTED')));
        }
      }

      if (agg.pendingEvents.length > 0) {
        await tx.insert(outboxEvents).values(
          agg.pendingEvents.map((e) => ({
            aggregateType: 'order',
            aggregateId: agg.id,
            type: e.type,
            payload: e.payload,
            ...(e.availableAt ? { availableAt: e.availableAt } : {}),
          })),
        );
      }
      if (agg.pendingAudit.length > 0) {
        await tx.insert(auditLogs).values(agg.pendingAudit.map((a) => ({ entityType: 'order', entityId: agg.id, action: a.action, actor: a.actor, detail: a.detail, createdAt: a.at })));
      }
    });

    agg.version = nextVersion;
    agg.pendingEvents = [];
    agg.pendingAudit = [];
    agg.pendingCommissions = [];
    return nextVersion;
  }
}
