import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DomainError, type ProviderEnvironment } from '@texholiday/contracts';
import type { CoreDb } from './client';
import { auditLogs, commissionPayouts, ledgerEntries, providerCommissions } from './schema';

/**
 * Provider commission lifecycle (ADR-0006, ADR-0019): EXPECTED at confirmation, EARNED after the stay, RECEIVED when
 * finance records the provider payout that settles it, VOIDED when the booking is cancelled. Ledger entries start at
 * EARNED (a confirmed booking is not earned revenue); a void after earning reverses them.
 */
type Tx = Parameters<Parameters<CoreDb['transaction']>[0]>[0];
type Db = CoreDb | Tx;
type MoneyJson = { currency: string; minor: string };
export type CommissionStatus = 'EXPECTED' | 'EARNED' | 'RECEIVED' | 'VOIDED';

/** Ledger accounts of commissions, per provider. */
export const commissionAccounts = {
  receivable: (provider: string) => `asset:commission_receivable:${provider}`,
  revenue: (provider: string) => `revenue:provider_commission:${provider}`,
  /** Money from a payout until it is matched to the bank account by accounting. */
  clearing: (provider: string) => `asset:payout_clearing:${provider}`,
  shortfall: (provider: string) => `expense:commission_shortfall:${provider}`,
  surplus: (provider: string) => `revenue:commission_adjustment:${provider}`,
};

/** End of the service: hotel check-out date, or the last flight leg's date (YYYY-MM-DD in the stored offer). */
const SERVICE_END = sql`CASE WHEN qv.option->>'checkout' ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (qv.option->>'checkout')::date
  ELSE (SELECT max((l->>'date')::date) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(qv.option->'legs') = 'array' THEN qv.option->'legs' ELSE '[]'::jsonb END) l
        WHERE l->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}$') END`;
const SERVICE_START = sql`CASE WHEN qv.option->>'checkin' ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (qv.option->>'checkin')::date
  ELSE (SELECT min((l->>'date')::date) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(qv.option->'legs') = 'array' THEN qv.option->'legs' ELSE '[]'::jsonb END) l
        WHERE l->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}$') END`;

const PG_UNIQUE_VIOLATION = '23505';
const pgCode = (err: unknown) => (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString());
const day = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export interface CommissionDue {
  id: string;
  orderId: string;
  orderItemId: string;
  serviceEnd: string;
}

export interface CommissionRow {
  id: string;
  orderId: string;
  orderItemId: string;
  providerId: string;
  productType: string;
  title: string | null;
  serviceStart: string | null;
  serviceEnd: string | null;
  providerBookingRef: string | null;
  bookingStatus: string | null;
  status: CommissionStatus;
  source: 'BOOKING' | 'QUOTE';
  amount: MoneyJson;
  earnedAt: string | null;
  payoutReference: string | null;
  createdAt: string;
}

export interface PayoutRow {
  id: string;
  providerId: string;
  reference: string;
  amount: MoneyJson;
  commissions: MoneyJson;
  /** amount − commissions (negative: less arrived than the commissions). */
  difference: MoneyJson;
  count: number;
  receivedOn: string;
  note: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface CommissionFilter {
  status?: CommissionStatus;
  providerId?: string;
  currency?: string;
  limit?: number;
}

export interface PayoutInput {
  environment: ProviderEnvironment;
  providerId: string;
  reference: string;
  currency: string;
  amountMinor: bigint;
  receivedOn: string;
  note: string | null;
  commissionIds: readonly string[];
  /** e.g. `staff:<id>`. */
  actor: string;
  at: Date;
}

/**
 * Voids the commission of a cancelled booking inside the caller's transaction (the order store). An EARNED one gets
 * its ledger entries reversed; a RECEIVED one (money already in) is left for finance and reported to the caller.
 */
export async function voidCommission(tx: Db, orderId: string, orderItemId: string): Promise<'NONE' | 'VOIDED' | 'REVERSED' | 'ALREADY_RECEIVED'> {
  const res = await tx.execute<{ id: string; status: CommissionStatus }>(sql`SELECT id, status FROM core.provider_commissions WHERE order_item_id = ${orderItemId} FOR UPDATE`);
  const row = res.rows[0];
  if (!row || row.status === 'VOIDED') return 'NONE';
  if (row.status === 'RECEIVED') return 'ALREADY_RECEIVED';
  await tx.update(providerCommissions).set({ status: 'VOIDED' }).where(and(eq(providerCommissions.id, row.id), inArray(providerCommissions.status, ['EXPECTED', 'EARNED'])));
  if (row.status === 'EXPECTED') return 'VOIDED';
  const earned = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.journalId, row.id), eq(ledgerEntries.kind, 'COMMISSION_EARNED')));
  const journal = randomUUID();
  if (earned.length > 0) {
    await tx.insert(ledgerEntries).values(
      earned.map((e) => ({
        journalId: journal,
        orderId,
        orderItemId,
        account: e.account,
        direction: e.direction === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const),
        amountMinor: e.amountMinor,
        currency: e.currency,
        kind: 'COMMISSION_VOIDED',
        reference: row.id,
        reversesEntryId: e.id,
      })),
    );
  }
  return 'REVERSED';
}

export class CommissionRepository {
  constructor(private readonly db: CoreDb) {}

  /**
   * EXPECTED commissions of one payment route whose service ended before `today` (YYYY-MM-DD, Istanbul) and whose
   * booking is still confirmed.
   */
  async due(environment: ProviderEnvironment, today: string, paymentMode: 'PROVIDER_MANAGED' | 'OWN_GATEWAY', limit = 100): Promise<CommissionDue[]> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT pc.id, i.order_id, pc.order_item_id, se.service_end
      FROM core.provider_commissions pc
      JOIN core.order_items i ON i.id = pc.order_item_id
      JOIN core.quote_versions qv ON qv.id = i.quote_version_id
      JOIN core.provider_bookings pb ON pb.order_item_id = i.id
      CROSS JOIN LATERAL (SELECT ${SERVICE_END} AS service_end) se
      WHERE pc.environment = ${environment} AND pc.payment_mode = ${paymentMode} AND pc.status = 'EXPECTED' AND pb.status IN ('CONFIRMED', 'ISSUED')
        AND se.service_end < ${today}::date
      ORDER BY se.service_end, pc.created_at
      LIMIT ${limit}`);
    return res.rows.map((r) => ({ id: String(r.id), orderId: String(r.order_id), orderItemId: String(r.order_item_id), serviceEnd: day(r.service_end)! }));
  }

  /**
   * Marks one commission EARNED with its ledger entries when its booking is still confirmed. The order row is locked,
   * so a cancellation saved at the same time either comes first (nothing is earned) or voids it afterwards.
   */
  async markEarned(id: string, at: Date, actor: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const res = await tx.execute<Record<string, unknown>>(sql`
        SELECT pc.status, pc.amount_minor::text AS amount, pc.currency, pc.provider_id, i.order_id, i.id AS item_id, pb.status::text AS booking_status
        FROM core.provider_commissions pc
        JOIN core.order_items i ON i.id = pc.order_item_id
        JOIN core.orders o ON o.id = i.order_id
        LEFT JOIN core.provider_bookings pb ON pb.order_item_id = i.id
        WHERE pc.id = ${id}
        FOR UPDATE OF pc, o`);
      const r = res.rows[0];
      if (!r || r.status !== 'EXPECTED' || (r.booking_status !== 'CONFIRMED' && r.booking_status !== 'ISSUED')) return false;
      const provider = String(r.provider_id);
      const amount = BigInt(String(r.amount));
      const currency = String(r.currency).trim();
      const orderId = String(r.order_id);
      const orderItemId = String(r.item_id);
      await tx.update(providerCommissions).set({ status: 'EARNED', earnedAt: at.toISOString() }).where(and(eq(providerCommissions.id, id), eq(providerCommissions.status, 'EXPECTED')));
      await tx.insert(ledgerEntries).values([
        { journalId: id, orderId, orderItemId, account: commissionAccounts.receivable(provider), direction: 'DEBIT', amountMinor: amount, currency, kind: 'COMMISSION_EARNED', reference: id },
        { journalId: id, orderId, orderItemId, account: commissionAccounts.revenue(provider), direction: 'CREDIT', amountMinor: amount, currency, kind: 'COMMISSION_EARNED', reference: id },
      ]);
      await tx.insert(auditLogs).values({ entityType: 'order', entityId: orderId, action: 'commission.earned', actor, detail: { itemId: orderItemId, amount: amount.toString(), currency }, createdAt: at.toISOString() });
      return true;
    });
  }

  async list(environment: ProviderEnvironment, filter: CommissionFilter = {}): Promise<CommissionRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT pc.id, i.order_id, pc.order_item_id, pc.provider_id, i.product_type::text AS product_type, pc.status, pc.source,
             pc.amount_minor::text AS amount, pc.currency, pc.earned_at, pc.payout_reference, pc.created_at,
             pb.provider_booking_ref, pb.status::text AS booking_status,
             COALESCE(qv.option->>'hotelName', qv.option->>'title') AS title,
             ${SERVICE_START} AS service_start, ${SERVICE_END} AS service_end
      FROM core.provider_commissions pc
      JOIN core.order_items i ON i.id = pc.order_item_id
      JOIN core.quote_versions qv ON qv.id = i.quote_version_id
      LEFT JOIN core.provider_bookings pb ON pb.order_item_id = i.id
      WHERE pc.environment = ${environment}
        ${filter.status ? sql`AND pc.status = ${filter.status}` : sql``}
        ${filter.providerId ? sql`AND pc.provider_id = ${filter.providerId}` : sql``}
        ${filter.currency ? sql`AND pc.currency = ${filter.currency}` : sql``}
      ORDER BY service_end NULLS LAST, pc.created_at
      LIMIT ${limit}`);
    return res.rows.map((r) => ({
      id: String(r.id),
      orderId: String(r.order_id),
      orderItemId: String(r.order_item_id),
      providerId: String(r.provider_id),
      productType: String(r.product_type),
      title: (r.title as string | null) ?? null,
      serviceStart: day(r.service_start),
      serviceEnd: day(r.service_end),
      providerBookingRef: (r.provider_booking_ref as string | null) ?? null,
      bookingStatus: (r.booking_status as string | null) ?? null,
      status: r.status as CommissionStatus,
      source: r.source as 'BOOKING' | 'QUOTE',
      amount: { currency: String(r.currency).trim(), minor: String(r.amount) },
      earnedAt: iso(r.earned_at),
      payoutReference: (r.payout_reference as string | null) ?? null,
      createdAt: iso(r.created_at)!,
    }));
  }

  /** Count and sum per status and currency, now. */
  async totals(environment: ProviderEnvironment): Promise<Array<{ status: CommissionStatus; currency: string; count: number; amount: MoneyJson }>> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT status, currency, count(*)::int AS n, sum(amount_minor)::text AS total
      FROM core.provider_commissions WHERE environment = ${environment}
      GROUP BY 1, 2 ORDER BY 2, 1`);
    return res.rows.map((r) => ({ status: r.status as CommissionStatus, currency: String(r.currency).trim(), count: Number(r.n), amount: { currency: String(r.currency).trim(), minor: String(r.total) } }));
  }

  /**
   * Records a payout and settles the given EARNED commissions, all or nothing: they must belong to this environment,
   * the payout's provider and currency. A difference between what arrived and their sum needs a note and is booked
   * as a shortfall or an adjustment; a reference is recorded once per provider.
   */
  async recordPayout(input: PayoutInput): Promise<{ payoutId: string; commissionsMinor: bigint; differenceMinor: bigint }> {
    const bad = (m: string) => new DomainError('VALIDATION_FAILED', m, { httpStatus: 422, action: 'FIX_FIELDS' });
    const ids = [...new Set(input.commissionIds)];
    if (ids.length === 0) throw bad('Select the commissions this payout settles');
    try {
      return await this.db.transaction(async (tx) => {
        const res = await tx.execute<Record<string, unknown>>(sql`
          SELECT pc.id, pc.status, pc.environment::text AS environment, pc.provider_id, pc.currency, pc.amount_minor::text AS amount, i.order_id, i.id AS item_id
          FROM core.provider_commissions pc JOIN core.order_items i ON i.id = pc.order_item_id
          WHERE pc.id IN (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
          FOR UPDATE OF pc`);
        const rows = res.rows;
        if (rows.length !== ids.length || rows.some((r) => r.environment !== input.environment)) throw bad('Some selected commissions do not exist');
        if (rows.some((r) => r.provider_id !== input.providerId)) throw bad('All commissions must be from the payout’s provider');
        if (rows.some((r) => String(r.currency).trim() !== input.currency)) throw bad('All commissions must be in the payout currency');
        if (rows.some((r) => r.status !== 'EARNED')) {
          throw new DomainError('VERSION_CONFLICT', 'Only earned commissions that are not settled yet can be settled', { httpStatus: 409, action: 'REFRESH' });
        }
        const sum = rows.reduce((s, r) => s + BigInt(String(r.amount)), 0n);
        const difference = input.amountMinor - sum;
        const note = input.note?.trim() || null;
        if (difference !== 0n && (!note || note.length < 5)) throw bad('Explain the difference between the amount received and the commissions');
        const [payout] = await tx
          .insert(commissionPayouts)
          .values({
            environment: input.environment,
            providerId: input.providerId,
            reference: input.reference,
            currency: input.currency,
            amountMinor: input.amountMinor,
            commissionsMinor: sum,
            receivedOn: input.receivedOn,
            note,
            recordedBy: input.actor,
            createdAt: input.at.toISOString(),
          })
          .returning({ id: commissionPayouts.id });
        const payoutId = payout!.id;
        await tx
          .update(providerCommissions)
          .set({ status: 'RECEIVED', payoutId, payoutReference: input.reference })
          .where(and(inArray(providerCommissions.id, ids), eq(providerCommissions.status, 'EARNED')));
        const p = input.providerId;
        const ccy = input.currency;
        const entries: Array<typeof ledgerEntries.$inferInsert> = [
          { journalId: payoutId, account: commissionAccounts.clearing(p), direction: 'DEBIT', amountMinor: input.amountMinor, currency: ccy, kind: 'COMMISSION_PAYOUT', reference: input.reference },
          ...rows.map((r) => ({
            journalId: payoutId,
            orderId: String(r.order_id),
            orderItemId: String(r.item_id),
            account: commissionAccounts.receivable(p),
            direction: 'CREDIT' as const,
            amountMinor: BigInt(String(r.amount)),
            currency: ccy,
            kind: 'COMMISSION_PAYOUT',
            reference: input.reference,
          })),
        ];
        if (difference < 0n) entries.push({ journalId: payoutId, account: commissionAccounts.shortfall(p), direction: 'DEBIT', amountMinor: -difference, currency: ccy, kind: 'COMMISSION_PAYOUT', reference: input.reference });
        if (difference > 0n) entries.push({ journalId: payoutId, account: commissionAccounts.surplus(p), direction: 'CREDIT', amountMinor: difference, currency: ccy, kind: 'COMMISSION_PAYOUT', reference: input.reference });
        await tx.insert(ledgerEntries).values(entries);
        const at = input.at.toISOString();
        await tx.insert(auditLogs).values([
          { entityType: 'commission_payout', entityId: payoutId, action: 'commission.payout_recorded', actor: input.actor, detail: { reference: input.reference, currency: ccy, amount: input.amountMinor.toString(), commissions: sum.toString(), count: rows.length, receivedOn: input.receivedOn }, createdAt: at },
          ...rows.map((r) => ({ entityType: 'order', entityId: String(r.order_id), action: 'commission.received', actor: input.actor, detail: { itemId: String(r.item_id), payoutId, reference: input.reference }, createdAt: at })),
        ]);
        return { payoutId, commissionsMinor: sum, differenceMinor: difference };
      });
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new DomainError('VALIDATION_FAILED', 'This payout reference is already recorded for the provider', { httpStatus: 422, action: 'FIX_FIELDS' });
      throw err;
    }
  }

  async payouts(environment: ProviderEnvironment, limit = 50): Promise<PayoutRow[]> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT p.*, p.amount_minor::text AS amount, p.commissions_minor::text AS commissions,
             (SELECT count(*)::int FROM core.provider_commissions pc WHERE pc.payout_id = p.id) AS n
      FROM core.commission_payouts p WHERE p.environment = ${environment}
      ORDER BY p.received_on DESC, p.created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 500)}`);
    return res.rows.map((r) => {
      const ccy = String(r.currency).trim();
      const amount = BigInt(String(r.amount));
      const commissions = BigInt(String(r.commissions));
      return {
        id: String(r.id),
        providerId: String(r.provider_id),
        reference: String(r.reference),
        amount: { currency: ccy, minor: amount.toString() },
        commissions: { currency: ccy, minor: commissions.toString() },
        difference: { currency: ccy, minor: (amount - commissions).toString() },
        count: Number(r.n),
        receivedOn: day(r.received_on)!,
        note: (r.note as string | null) ?? null,
        recordedBy: String(r.recorded_by),
        createdAt: iso(r.created_at)!,
      };
    });
  }
}
