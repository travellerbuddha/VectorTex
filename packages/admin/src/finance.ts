import { sql } from 'drizzle-orm';
import { DomainError, type StaffActor } from '@texholiday/contracts';
import { activePermissions, type CoreDb } from '@texholiday/db';
import { money, toMajor } from '@texholiday/pricing';

type Env = 'mock' | 'sandbox' | 'production';
type MoneyJson = { currency: string; minor: string };

/**
 * Finance reports of /yonetim (P15b): read-only sums over one period of the deployment's provider environment.
 * Amounts are summed per currency in the database (bigint minor units) and never converted or mixed. No personal
 * data: the CSV carries order and booking references only. Needs orders.view_financials (checked here).
 */
export interface FinancePeriod {
  /** Inclusive dates (YYYY-MM-DD) in Europe/Istanbul. */
  from: string;
  to: string;
}

export interface CountAndAmount {
  currency: string;
  count: number;
  amount: MoneyJson;
}

export interface FinanceReport {
  environment: Env;
  period: FinancePeriod;
  /** Orders created in the period, per status and currency (customer charge). */
  orders: Array<CountAndAmount & { status: string }>;
  /** Booked items (confirmed or ticketed now) of those orders, per product: customer charge and provider price. */
  sales: Array<{ productType: string; count: number; charge: MoneyJson; supplierPrice: MoneyJson }>;
  /** Provider commission receivables of those orders, per status. */
  commissions: Array<CountAndAmount & { status: string }>;
  /** Open commission receivables now (EXPECTED and EARNED, any period). */
  openCommissions: Array<CountAndAmount & { status: string }>;
  /** Items of those orders whose booking is cancelled now. */
  cancellations: CountAndAmount[];
  /** Refunds recorded in the period (by their date). */
  refunds: CountAndAmount[];
  /** Payment attempts created in the period, per status. */
  payments: Array<CountAndAmount & { status: string }>;
}

export interface FinanceCsvRow {
  orderId: string;
  createdAt: string;
  orderStatus: string;
  position: number;
  productType: string;
  providerId: string;
  fundingMethod: string;
  bookingStatus: string | null;
  providerBookingRef: string | null;
  charge: MoneyJson;
  supplierPrice: MoneyJson;
  commission: MoneyJson | null;
  commissionStatus: string | null;
  refunded: MoneyJson | null;
  paymentStatus: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const amount = (minor: unknown, currency: unknown): MoneyJson => ({ currency: String(currency).trim(), minor: String(minor ?? '0') });

/** Validates a period: real dates, from <= to, at most 366 days. */
export function financePeriod(from: string, to: string): FinancePeriod {
  const bad = (m: string) => new DomainError('VALIDATION_FAILED', m, { httpStatus: 422, action: 'FIX_FIELDS' });
  if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) throw bad('Dates are YYYY-MM-DD');
  if (new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) !== from || new Date(`${to}T00:00:00Z`).toISOString().slice(0, 10) !== to) throw bad('Not a calendar date');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0) throw bad('The start is after the end');
  if (days + 1 > MAX_DAYS) throw bad(`At most ${MAX_DAYS} days`);
  return { from, to };
}

/** Decimal amount in major units for CSV ("1234.50"), exact. */
export const csvAmount = (m: MoneyJson | null): string => (m ? toMajor(money(m.currency, m.minor)) : '');

export class FinanceReports {
  constructor(
    private readonly db: CoreDb,
    private readonly environment: Env,
  ) {}

  private async require(actor: StaffActor): Promise<void> {
    if (!(await activePermissions(this.db, actor.id)).has('orders.view_financials')) {
      throw new DomainError('FORBIDDEN', 'Missing permission orders.view_financials', { httpStatus: 403 });
    }
  }

  /** Start and end instants of the period: Istanbul midnights. */
  private bounds(p: FinancePeriod) {
    return {
      start: sql`(${p.from}::date)::timestamp AT TIME ZONE 'Europe/Istanbul'`,
      end: sql`((${p.to}::date) + 1)::timestamp AT TIME ZONE 'Europe/Istanbul'`,
    };
  }

  async report(actor: StaffActor, period: FinancePeriod): Promise<FinanceReport> {
    await this.require(actor);
    const p = financePeriod(period.from, period.to);
    const { start, end } = this.bounds(p);
    const env = this.environment;
    const inPeriod = sql`o.environment = ${env} AND o.created_at >= ${start} AND o.created_at < ${end}`;

    const [orders, sales, commissions, open, cancellations, refunds, payments] = await Promise.all([
      this.db.execute<Record<string, unknown>>(sql`
        SELECT o.status::text AS status, o.charge_currency AS currency, count(*)::int AS n, sum(o.charge_total_minor)::text AS total
        FROM core.orders o WHERE ${inPeriod}
        GROUP BY 1, 2 ORDER BY 2, 1`),
      this.db.execute<Record<string, unknown>>(sql`
        SELECT i.product_type::text AS product, i.charge_currency AS ccy, i.supplier_cost_currency AS scy, count(*)::int AS n,
               sum(i.charge_allocation_minor)::text AS charge, sum(i.supplier_cost_minor)::text AS cost
        FROM core.order_items i JOIN core.orders o ON o.id = i.order_id
        JOIN core.provider_bookings pb ON pb.order_item_id = i.id
        WHERE ${inPeriod} AND pb.status IN ('CONFIRMED', 'ISSUED')
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`),
      this.db.execute<Record<string, unknown>>(sql`
        SELECT pc.status, pc.currency, count(*)::int AS n, sum(pc.amount_minor)::text AS total
        FROM core.provider_commissions pc JOIN core.order_items i ON i.id = pc.order_item_id JOIN core.orders o ON o.id = i.order_id
        WHERE ${inPeriod}
        GROUP BY 1, 2 ORDER BY 2, 1`),
      this.db.execute<Record<string, unknown>>(sql`
        SELECT pc.status, pc.currency, count(*)::int AS n, sum(pc.amount_minor)::text AS total
        FROM core.provider_commissions pc
        WHERE pc.environment = ${env} AND pc.status IN ('EXPECTED', 'EARNED')
        GROUP BY 1, 2 ORDER BY 2, 1`),
      this.db.execute<Record<string, unknown>>(sql`
        SELECT i.charge_currency AS currency, count(*)::int AS n, sum(i.charge_allocation_minor)::text AS total
        FROM core.order_items i JOIN core.orders o ON o.id = i.order_id
        JOIN core.provider_bookings pb ON pb.order_item_id = i.id
        WHERE ${inPeriod} AND pb.status = 'CANCELLED'
        GROUP BY 1 ORDER BY 1`),
      this.db.execute<Record<string, unknown>>(sql`
        SELECT ct.currency, count(*)::int AS n, sum(ct.amount_minor)::text AS total
        FROM core.customer_transactions ct JOIN core.payment_attempts pa ON pa.id = ct.payment_attempt_id
        WHERE pa.environment = ${env} AND ct.kind = 'REFUND' AND ct.status = 'SUCCEEDED' AND ct.created_at >= ${start} AND ct.created_at < ${end}
        GROUP BY 1 ORDER BY 1`),
      this.db.execute<Record<string, unknown>>(sql`
        SELECT pa.status::text AS status, pa.currency, count(*)::int AS n, sum(pa.amount_minor)::text AS total
        FROM core.payment_attempts pa
        WHERE pa.environment = ${env} AND pa.created_at >= ${start} AND pa.created_at < ${end}
        GROUP BY 1, 2 ORDER BY 2, 1`),
    ]);
    const row = (r: Record<string, unknown>): CountAndAmount => ({ currency: String(r.currency).trim(), count: Number(r.n), amount: amount(r.total, r.currency) });
    return {
      environment: env,
      period: p,
      orders: orders.rows.map((r) => ({ ...row(r), status: String(r.status) })),
      sales: sales.rows.map((r) => ({ productType: String(r.product), count: Number(r.n), charge: amount(r.charge, r.ccy), supplierPrice: amount(r.cost, r.scy) })),
      commissions: commissions.rows.map((r) => ({ ...row(r), status: String(r.status) })),
      openCommissions: open.rows.map((r) => ({ ...row(r), status: String(r.status) })),
      cancellations: cancellations.rows.map(row),
      refunds: refunds.rows.map(row),
      payments: payments.rows.map((r) => ({ ...row(r), status: String(r.status) })),
    };
  }

  /** One line per order item of the orders created in the period, oldest first (no personal data). */
  async lines(actor: StaffActor, period: FinancePeriod): Promise<FinanceCsvRow[]> {
    await this.require(actor);
    const p = financePeriod(period.from, period.to);
    const { start, end } = this.bounds(p);
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT o.id AS order_id, o.created_at, o.status::text AS order_status, i.position, i.product_type::text AS product_type, i.provider_id,
             i.funding_method::text AS funding_method, pb.status::text AS booking_status, pb.provider_booking_ref,
             i.charge_allocation_minor::text AS charge, i.charge_currency, i.supplier_cost_minor::text AS cost, i.supplier_cost_currency,
             pc.amount_minor::text AS commission, pc.currency AS commission_currency, pc.status AS commission_status,
             pay.status::text AS payment_status, pay.currency AS payment_currency, rf.total::text AS refunded
      FROM core.orders o
      JOIN core.order_items i ON i.order_id = o.id
      LEFT JOIN core.provider_bookings pb ON pb.order_item_id = i.id
      LEFT JOIN core.provider_commissions pc ON pc.order_item_id = i.id
      LEFT JOIN LATERAL (SELECT pa.id, pa.status, pa.currency FROM core.payment_attempts pa WHERE pa.order_id = o.id ORDER BY pa.created_at DESC LIMIT 1) pay ON true
      LEFT JOIN LATERAL (
        SELECT sum(ct.amount_minor) AS total FROM core.customer_transactions ct
        WHERE ct.payment_attempt_id = pay.id AND ct.kind = 'REFUND' AND ct.status = 'SUCCEEDED'
      ) rf ON i.position = (SELECT min(i2.position) FROM core.order_items i2 WHERE i2.order_id = o.id)
      WHERE o.environment = ${this.environment} AND o.created_at >= ${start} AND o.created_at < ${end}
      ORDER BY o.created_at, o.id, i.position`);
    return rows.rows.map((r) => ({
      orderId: String(r.order_id),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : new Date(String(r.created_at)).toISOString(),
      orderStatus: String(r.order_status),
      position: Number(r.position),
      productType: String(r.product_type),
      providerId: String(r.provider_id),
      fundingMethod: String(r.funding_method),
      bookingStatus: (r.booking_status as string | null) ?? null,
      providerBookingRef: (r.provider_booking_ref as string | null) ?? null,
      charge: amount(r.charge, r.charge_currency),
      supplierPrice: amount(r.cost, r.supplier_cost_currency),
      commission: r.commission === null || r.commission === undefined ? null : amount(r.commission, r.commission_currency),
      commissionStatus: (r.commission_status as string | null) ?? null,
      // Refunds are per payment (order): shown on the order's first line only, so a column sum stays right.
      refunded: r.refunded === null || r.refunded === undefined ? null : amount(r.refunded, r.payment_currency),
      paymentStatus: (r.payment_status as string | null) ?? null,
    }));
  }
}

/** RFC 4180 CSV of the order lines; amounts in major units with their currency beside them. */
export function financeCsv(rows: readonly FinanceCsvRow[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = [
    'order_id',
    'created_at_utc',
    'order_status',
    'item',
    'product',
    'provider',
    'funding',
    'booking_status',
    'provider_booking_ref',
    'currency',
    'charge',
    'supplier_currency',
    'supplier_price',
    'commission_currency',
    'commission',
    'commission_status',
    'refunded_currency',
    'refunded',
    'payment_status',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.orderId,
        r.createdAt,
        r.orderStatus,
        String(r.position),
        r.productType,
        r.providerId,
        r.fundingMethod,
        r.bookingStatus ?? '',
        r.providerBookingRef ?? '',
        r.charge.currency,
        csvAmount(r.charge),
        r.supplierPrice.currency,
        csvAmount(r.supplierPrice),
        r.commission?.currency ?? '',
        csvAmount(r.commission),
        r.commissionStatus ?? '',
        r.refunded?.currency ?? '',
        csvAmount(r.refunded),
        r.paymentStatus ?? '',
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
