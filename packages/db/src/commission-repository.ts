import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DomainError, type ProviderEnvironment } from '@texholiday/contracts';
import type { CoreDb } from './client';
import { auditLogs, commissionPayouts, ledgerEntries, providerCommissions } from './schema';

/**
 * Provider commission lifecycle (ADR-0006, ADR-0019): EXPECTED at confirmation; EARNED after the stay; RECEIVED when
 * finance records the provider payout that settles it — Nuitee pays when it collects the payment, so this usually
 * comes before the stay: the money is an advance until the stay ends (`earned_at`); VOIDED when the booking is
 * cancelled — if it was already paid, it is owed back until a later payout nets it. Revenue is booked only when the
 * stay is over (a confirmed booking is not earned revenue).
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
  /** Paid before the stay ended: not revenue yet. */
  advance: (provider: string) => `liability:commission_received_in_advance:${provider}`,
  /** Paid, then the booking was cancelled: owed back to the provider until a payout nets it. */
  refundDue: (provider: string) => `liability:commission_refund_due:${provider}`,
};

/** Where a commission stands, as finance reads it. */
export type CommissionBucket = 'EXPECTED' | 'EARNED' | 'RECEIVED_ADVANCE' | 'RECEIVED' | 'REFUND_DUE' | 'VOIDED';
/** The lists of the finance screen: not paid yet, paid, owed back, cancelled. */
export type CommissionView = 'UNPAID' | 'RECEIVED' | 'REFUND_DUE' | 'VOIDED';

const BUCKET = sql`CASE
  WHEN pc.status = 'RECEIVED' AND pc.earned_at IS NULL THEN 'RECEIVED_ADVANCE'
  WHEN pc.status = 'VOIDED' AND pc.payout_id IS NOT NULL AND pc.clawback_payout_id IS NULL THEN 'REFUND_DUE'
  ELSE pc.status END`;

const VIEWS: Record<CommissionView, ReturnType<typeof sql>> = {
  UNPAID: sql`pc.status IN ('EXPECTED', 'EARNED')`,
  RECEIVED: sql`pc.status = 'RECEIVED'`,
  REFUND_DUE: sql`pc.status = 'VOIDED' AND pc.payout_id IS NOT NULL AND pc.clawback_payout_id IS NULL`,
  VOIDED: sql`pc.status = 'VOIDED' AND (pc.payout_id IS NULL OR pc.clawback_payout_id IS NOT NULL)`,
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
  bucket: CommissionBucket;
  source: 'BOOKING' | 'QUOTE';
  amount: MoneyJson;
  earnedAt: string | null;
  payoutReference: string | null;
  /** Reference of the payout that netted it back (cancelled after it was paid). */
  clawbackReference: string | null;
  createdAt: string;
}

export interface PayoutRow {
  id: string;
  providerId: string;
  reference: string;
  amount: MoneyJson;
  commissions: MoneyJson;
  /** Commissions of cancelled bookings the provider took back in this payout. */
  clawbacks: MoneyJson;
  /** amount − (commissions − clawbacks); negative: less arrived than expected. */
  difference: MoneyJson;
  count: number;
  clawbackCount: number;
  receivedOn: string;
  note: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface CommissionFilter {
  status?: CommissionStatus;
  view?: CommissionView;
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
  /** Paid commissions of cancelled bookings the provider takes back in this payout. */
  clawbackIds?: readonly string[];
  /** e.g. `staff:<id>`. */
  actor: string;
  at: Date;
}

/**
 * Voids the commission of a cancelled booking inside the caller's transaction (the order store):
 * - not paid: VOIDED; if it was earned, its ledger entries are reversed;
 * - paid before the end of the stay: VOIDED and owed back to the provider (advance → refund due);
 * - paid and earned (cancelled after the stay): left as it is for finance, reported to the caller.
 */
export async function voidCommission(tx: Db, orderId: string, orderItemId: string): Promise<'NONE' | 'VOIDED' | 'REVERSED' | 'REFUND_DUE' | 'ALREADY_RECEIVED'> {
  const res = await tx.execute<{ id: string; status: CommissionStatus; earned_at: unknown; provider_id: string; amount: string; currency: string }>(
    sql`SELECT id, status, earned_at, provider_id, amount_minor::text AS amount, currency FROM core.provider_commissions WHERE order_item_id = ${orderItemId} FOR UPDATE`,
  );
  const row = res.rows[0];
  if (!row || row.status === 'VOIDED') return 'NONE';
  if (row.status === 'RECEIVED' && row.earned_at != null) return 'ALREADY_RECEIVED';
  await tx.update(providerCommissions).set({ status: 'VOIDED' }).where(and(eq(providerCommissions.id, row.id), inArray(providerCommissions.status, ['EXPECTED', 'EARNED', 'RECEIVED'])));
  if (row.status === 'EXPECTED') return 'VOIDED';
  const journal = randomUUID();
  if (row.status === 'RECEIVED') {
    const amount = BigInt(row.amount);
    const currency = String(row.currency).trim();
    await tx.insert(ledgerEntries).values([
      { journalId: journal, orderId, orderItemId, account: commissionAccounts.advance(row.provider_id), direction: 'DEBIT', amountMinor: amount, currency, kind: 'COMMISSION_REFUND_DUE', reference: row.id },
      { journalId: journal, orderId, orderItemId, account: commissionAccounts.refundDue(row.provider_id), direction: 'CREDIT', amountMinor: amount, currency, kind: 'COMMISSION_REFUND_DUE', reference: row.id },
    ]);
    await tx.insert(auditLogs).values({ entityType: 'order', entityId: orderId, action: 'commission.refund_due', actor: 'system', detail: { itemId: orderItemId, amount: amount.toString(), currency } });
    return 'REFUND_DUE';
  }
  const earned = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.journalId, row.id), eq(ledgerEntries.kind, 'COMMISSION_EARNED')));
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
   * Commissions of one payment route not earned yet — not paid (EXPECTED) or paid in advance (RECEIVED) — whose
   * service ended before `today` (YYYY-MM-DD, Istanbul) and whose booking is still confirmed.
   */
  async due(environment: ProviderEnvironment, today: string, paymentMode: 'PROVIDER_MANAGED' | 'OWN_GATEWAY', limit = 100): Promise<CommissionDue[]> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT pc.id, i.order_id, pc.order_item_id, se.service_end
      FROM core.provider_commissions pc
      JOIN core.order_items i ON i.id = pc.order_item_id
      JOIN core.quote_versions qv ON qv.id = i.quote_version_id
      JOIN core.provider_bookings pb ON pb.order_item_id = i.id
      CROSS JOIN LATERAL (SELECT ${SERVICE_END} AS service_end) se
      WHERE pc.environment = ${environment} AND pc.payment_mode = ${paymentMode} AND pc.status IN ('EXPECTED', 'RECEIVED') AND pc.earned_at IS NULL AND pb.status IN ('CONFIRMED', 'ISSUED')
        AND se.service_end < ${today}::date
      ORDER BY se.service_end, pc.created_at
      LIMIT ${limit}`);
    return res.rows.map((r) => ({ id: String(r.id), orderId: String(r.order_id), orderItemId: String(r.order_item_id), serviceEnd: day(r.service_end)! }));
  }

  /**
   * Earns one commission when its booking is still confirmed: a not-paid one becomes EARNED (receivable → revenue), a
   * paid-in-advance one gets its earned date (advance → revenue). The order row is locked, so a cancellation saved at
   * the same time either comes first (nothing is earned) or finds it earned.
   */
  async markEarned(id: string, at: Date, actor: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const res = await tx.execute<Record<string, unknown>>(sql`
        SELECT pc.status, pc.earned_at, pc.amount_minor::text AS amount, pc.currency, pc.provider_id, i.order_id, i.id AS item_id, pb.status::text AS booking_status
        FROM core.provider_commissions pc
        JOIN core.order_items i ON i.id = pc.order_item_id
        JOIN core.orders o ON o.id = i.order_id
        LEFT JOIN core.provider_bookings pb ON pb.order_item_id = i.id
        WHERE pc.id = ${id}
        FOR UPDATE OF pc, o`);
      const r = res.rows[0];
      const prepaid = r?.status === 'RECEIVED' && r.earned_at == null;
      if (!r || (r.status !== 'EXPECTED' && !prepaid) || (r.booking_status !== 'CONFIRMED' && r.booking_status !== 'ISSUED')) return false;
      const provider = String(r.provider_id);
      const amount = BigInt(String(r.amount));
      const currency = String(r.currency).trim();
      const orderId = String(r.order_id);
      const orderItemId = String(r.item_id);
      if (prepaid) {
        await tx.update(providerCommissions).set({ earnedAt: at.toISOString() }).where(and(eq(providerCommissions.id, id), eq(providerCommissions.status, 'RECEIVED'), isNull(providerCommissions.earnedAt)));
      } else {
        await tx.update(providerCommissions).set({ status: 'EARNED', earnedAt: at.toISOString() }).where(and(eq(providerCommissions.id, id), eq(providerCommissions.status, 'EXPECTED')));
      }
      await tx.insert(ledgerEntries).values([
        { journalId: id, orderId, orderItemId, account: prepaid ? commissionAccounts.advance(provider) : commissionAccounts.receivable(provider), direction: 'DEBIT', amountMinor: amount, currency, kind: 'COMMISSION_EARNED', reference: id },
        { journalId: id, orderId, orderItemId, account: commissionAccounts.revenue(provider), direction: 'CREDIT', amountMinor: amount, currency, kind: 'COMMISSION_EARNED', reference: id },
      ]);
      await tx.insert(auditLogs).values({ entityType: 'order', entityId: orderId, action: 'commission.earned', actor, detail: { itemId: orderItemId, amount: amount.toString(), currency, paidInAdvance: prepaid }, createdAt: at.toISOString() });
      return true;
    });
  }

  async list(environment: ProviderEnvironment, filter: CommissionFilter = {}): Promise<CommissionRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT pc.id, i.order_id, pc.order_item_id, pc.provider_id, i.product_type::text AS product_type, pc.status, pc.source,
             pc.amount_minor::text AS amount, pc.currency, pc.earned_at, pc.payout_reference, pc.created_at, ${BUCKET} AS bucket,
             (SELECT cp.reference FROM core.commission_payouts cp WHERE cp.id = pc.clawback_payout_id) AS clawback_reference,
             pb.provider_booking_ref, pb.status::text AS booking_status,
             COALESCE(qv.option->>'hotelName', qv.option->>'title') AS title,
             ${SERVICE_START} AS service_start, ${SERVICE_END} AS service_end
      FROM core.provider_commissions pc
      JOIN core.order_items i ON i.id = pc.order_item_id
      JOIN core.quote_versions qv ON qv.id = i.quote_version_id
      LEFT JOIN core.provider_bookings pb ON pb.order_item_id = i.id
      WHERE pc.environment = ${environment}
        ${filter.status ? sql`AND pc.status = ${filter.status}` : sql``}
        ${filter.view ? sql`AND ${VIEWS[filter.view]}` : sql``}
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
      bucket: r.bucket as CommissionBucket,
      source: r.source as 'BOOKING' | 'QUOTE',
      amount: { currency: String(r.currency).trim(), minor: String(r.amount) },
      earnedAt: iso(r.earned_at),
      payoutReference: (r.payout_reference as string | null) ?? null,
      clawbackReference: (r.clawback_reference as string | null) ?? null,
      createdAt: iso(r.created_at)!,
    }));
  }

  /** Count and sum per bucket and currency, now. */
  async totals(environment: ProviderEnvironment): Promise<Array<{ bucket: CommissionBucket; currency: string; count: number; amount: MoneyJson }>> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT ${BUCKET} AS bucket, pc.currency, count(*)::int AS n, sum(pc.amount_minor)::text AS total
      FROM core.provider_commissions pc WHERE pc.environment = ${environment}
      GROUP BY 1, 2 ORDER BY 2, 1`);
    return res.rows.map((r) => ({ bucket: r.bucket as CommissionBucket, currency: String(r.currency).trim(), count: Number(r.n), amount: { currency: String(r.currency).trim(), minor: String(r.total) } }));
  }

  /**
   * Records a payout, all or nothing. It settles commissions not paid yet — earned ones (receivable) or ones whose stay
   * is not over (an advance until it is) — and may net paid commissions of cancelled bookings the provider takes back.
   * Everything must be of this environment, the payout's provider and currency. What arrived is compared with
   * (settled − netted): a difference needs a note and is booked as a shortfall or an adjustment. A reference is
   * recorded once per provider.
   */
  async recordPayout(input: PayoutInput): Promise<{ payoutId: string; commissionsMinor: bigint; clawbacksMinor: bigint; differenceMinor: bigint }> {
    const bad = (m: string) => new DomainError('VALIDATION_FAILED', m, { httpStatus: 422, action: 'FIX_FIELDS' });
    const ids = [...new Set(input.commissionIds)];
    const clawIds = [...new Set(input.clawbackIds ?? [])].filter((id) => !ids.includes(id));
    if (ids.length === 0 && clawIds.length === 0) throw bad('Select the commissions this payout settles');
    try {
      return await this.db.transaction(async (tx) => {
        const all = [...ids, ...clawIds];
        const res = await tx.execute<Record<string, unknown>>(sql`
          SELECT pc.id, pc.status, pc.earned_at, pc.payout_id, pc.clawback_payout_id, pc.environment::text AS environment, pc.provider_id, pc.currency,
                 pc.amount_minor::text AS amount, i.order_id, i.id AS item_id
          FROM core.provider_commissions pc JOIN core.order_items i ON i.id = pc.order_item_id
          WHERE pc.id IN (${sql.join(
            all.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
          FOR UPDATE OF pc`);
        const rows = res.rows;
        if (rows.length !== all.length || rows.some((r) => r.environment !== input.environment)) throw bad('Some selected commissions do not exist');
        if (rows.some((r) => r.provider_id !== input.providerId)) throw bad('All commissions must be from the payout’s provider');
        if (rows.some((r) => String(r.currency).trim() !== input.currency)) throw bad('All commissions must be in the payout currency');
        const settle = rows.filter((r) => ids.includes(String(r.id)));
        const claw = rows.filter((r) => clawIds.includes(String(r.id)));
        if (settle.some((r) => r.status !== 'EXPECTED' && r.status !== 'EARNED')) {
          throw new DomainError('VERSION_CONFLICT', 'Only commissions that are not paid yet can be settled', { httpStatus: 409, action: 'REFRESH' });
        }
        if (claw.some((r) => r.status !== 'VOIDED' || r.payout_id == null || r.clawback_payout_id != null)) {
          throw new DomainError('VERSION_CONFLICT', 'Only paid commissions of cancelled bookings not netted yet can be netted', { httpStatus: 409, action: 'REFRESH' });
        }
        const total = (list: typeof rows) => list.reduce((s, r) => s + BigInt(String(r.amount)), 0n);
        const settled = total(settle);
        const netted = total(claw);
        // The provider deducts refunds from what it pays: never more than the commissions of the same payout.
        if (settled === 0n || netted > settled) throw bad('Refunds deducted cannot exceed the commissions of the payout');
        const difference = input.amountMinor - (settled - netted);
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
            commissionsMinor: settled,
            clawbacksMinor: netted,
            receivedOn: input.receivedOn,
            note,
            recordedBy: input.actor,
            createdAt: input.at.toISOString(),
          })
          .returning({ id: commissionPayouts.id });
        const payoutId = payout!.id;
        if (settle.length > 0) {
          await tx
            .update(providerCommissions)
            .set({ status: 'RECEIVED', payoutId, payoutReference: input.reference })
            .where(and(inArray(providerCommissions.id, settle.map((r) => String(r.id))), inArray(providerCommissions.status, ['EXPECTED', 'EARNED'])));
        }
        if (claw.length > 0) {
          await tx
            .update(providerCommissions)
            .set({ clawbackPayoutId: payoutId })
            .where(and(inArray(providerCommissions.id, claw.map((r) => String(r.id))), eq(providerCommissions.status, 'VOIDED'), isNull(providerCommissions.clawbackPayoutId)));
        }
        const p = input.providerId;
        const ccy = input.currency;
        const line = (r: (typeof rows)[number], account: string, direction: 'DEBIT' | 'CREDIT') => ({
          journalId: payoutId,
          orderId: String(r.order_id),
          orderItemId: String(r.item_id),
          account,
          direction,
          amountMinor: BigInt(String(r.amount)),
          currency: ccy,
          kind: 'COMMISSION_PAYOUT',
          reference: input.reference,
        });
        const entries: Array<typeof ledgerEntries.$inferInsert> = [
          { journalId: payoutId, account: commissionAccounts.clearing(p), direction: 'DEBIT', amountMinor: input.amountMinor, currency: ccy, kind: 'COMMISSION_PAYOUT', reference: input.reference },
          // Earned: the receivable is paid; stay not over: an advance until it is.
          ...settle.map((r) => line(r, r.status === 'EARNED' ? commissionAccounts.receivable(p) : commissionAccounts.advance(p), 'CREDIT')),
          // Taken back: what we owed is settled.
          ...claw.map((r) => line(r, commissionAccounts.refundDue(p), 'DEBIT')),
        ];
        if (difference < 0n) entries.push({ journalId: payoutId, account: commissionAccounts.shortfall(p), direction: 'DEBIT', amountMinor: -difference, currency: ccy, kind: 'COMMISSION_PAYOUT', reference: input.reference });
        if (difference > 0n) entries.push({ journalId: payoutId, account: commissionAccounts.surplus(p), direction: 'CREDIT', amountMinor: difference, currency: ccy, kind: 'COMMISSION_PAYOUT', reference: input.reference });
        await tx.insert(ledgerEntries).values(entries);
        const at = input.at.toISOString();
        await tx.insert(auditLogs).values([
          {
            entityType: 'commission_payout',
            entityId: payoutId,
            action: 'commission.payout_recorded',
            actor: input.actor,
            detail: { reference: input.reference, currency: ccy, amount: input.amountMinor.toString(), commissions: settled.toString(), clawbacks: netted.toString(), count: settle.length, netted: claw.length, receivedOn: input.receivedOn },
            createdAt: at,
          },
          ...settle.map((r) => ({ entityType: 'order', entityId: String(r.order_id), action: 'commission.received', actor: input.actor, detail: { itemId: String(r.item_id), payoutId, reference: input.reference, inAdvance: r.status === 'EXPECTED' }, createdAt: at })),
          ...claw.map((r) => ({ entityType: 'order', entityId: String(r.order_id), action: 'commission.clawback_netted', actor: input.actor, detail: { itemId: String(r.item_id), payoutId, reference: input.reference }, createdAt: at })),
        ]);
        return { payoutId, commissionsMinor: settled, clawbacksMinor: netted, differenceMinor: difference };
      });
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new DomainError('VALIDATION_FAILED', 'This payout reference is already recorded for the provider', { httpStatus: 422, action: 'FIX_FIELDS' });
      throw err;
    }
  }

  async payouts(environment: ProviderEnvironment, limit = 50): Promise<PayoutRow[]> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT p.*, p.amount_minor::text AS amount, p.commissions_minor::text AS commissions, p.clawbacks_minor::text AS clawbacks,
             (SELECT count(*)::int FROM core.provider_commissions pc WHERE pc.payout_id = p.id) AS n,
             (SELECT count(*)::int FROM core.provider_commissions pc WHERE pc.clawback_payout_id = p.id) AS nc
      FROM core.commission_payouts p WHERE p.environment = ${environment}
      ORDER BY p.received_on DESC, p.created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 500)}`);
    return res.rows.map((r) => {
      const ccy = String(r.currency).trim();
      const amount = BigInt(String(r.amount));
      const commissions = BigInt(String(r.commissions));
      const clawbacks = BigInt(String(r.clawbacks));
      return {
        id: String(r.id),
        providerId: String(r.provider_id),
        reference: String(r.reference),
        amount: { currency: ccy, minor: amount.toString() },
        commissions: { currency: ccy, minor: commissions.toString() },
        clawbacks: { currency: ccy, minor: clawbacks.toString() },
        difference: { currency: ccy, minor: (amount - (commissions - clawbacks)).toString() },
        count: Number(r.n),
        clawbackCount: Number(r.nc),
        receivedOn: day(r.received_on)!,
        note: (r.note as string | null) ?? null,
        recordedBy: String(r.recorded_by),
        createdAt: iso(r.created_at)!,
      };
    });
  }
}
