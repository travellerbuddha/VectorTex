import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { ProviderEnvironment } from '@texholiday/contracts';
import type { CoreDb } from './client';
import { customerLoginCodes, customerSessions } from './schema';

/**
 * Storage of customer sign-in (ADR-0017): one-time codes and sessions, both kept as hashes only. Orders are found by
 * the e-mail address the customer booked with (guest checkout keeps one customer row per checkout).
 */
export interface CustomerOrderRow {
  id: string;
  createdAt: string;
  status: string;
  total: { currency: string; minor: string };
  productType: string | null;
  title: string | null;
  checkin: string | null;
  checkout: string | null;
  bookingStatus: string | null;
  providerBookingRef: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export class CustomerAccountRepository {
  constructor(private readonly db: CoreDb) {}

  async codesSince(environment: ProviderEnvironment, email: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(customerLoginCodes)
      .where(and(eq(customerLoginCodes.environment, environment), eq(customerLoginCodes.email, email), gt(customerLoginCodes.createdAt, since.toISOString())));
    return row?.n ?? 0;
  }

  async insertCode(row: { id: string; environment: ProviderEnvironment; email: string; codeHash: string; expiresAt: Date }, now: Date): Promise<void> {
    await this.db.insert(customerLoginCodes).values({ ...row, expiresAt: row.expiresAt.toISOString(), createdAt: now.toISOString() });
  }

  /** The newest code of the address that is still usable. */
  async latestCode(environment: ProviderEnvironment, email: string, now: Date) {
    const [row] = await this.db
      .select()
      .from(customerLoginCodes)
      .where(and(eq(customerLoginCodes.environment, environment), eq(customerLoginCodes.email, email), isNull(customerLoginCodes.consumedAt), gt(customerLoginCodes.expiresAt, now.toISOString())))
      .orderBy(desc(customerLoginCodes.createdAt))
      .limit(1);
    return row ?? null;
  }

  async failAttempt(id: string): Promise<void> {
    await this.db
      .update(customerLoginCodes)
      .set({ attempts: sql`${customerLoginCodes.attempts} + 1` })
      .where(eq(customerLoginCodes.id, id));
  }

  /** Uses a code up; false when another request used it first. */
  async consume(id: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(customerLoginCodes)
      .set({ consumedAt: now.toISOString() })
      .where(and(eq(customerLoginCodes.id, id), isNull(customerLoginCodes.consumedAt)))
      .returning({ id: customerLoginCodes.id });
    return rows.length === 1;
  }

  async createSession(row: { tokenHash: string; environment: ProviderEnvironment; email: string; expiresAt: Date }, now: Date): Promise<void> {
    await this.db.insert(customerSessions).values({ ...row, expiresAt: row.expiresAt.toISOString(), createdAt: now.toISOString() });
  }

  async session(tokenHash: string, environment: ProviderEnvironment, now: Date): Promise<{ email: string; expiresAt: string } | null> {
    const [row] = await this.db
      .select({ email: customerSessions.email, expiresAt: customerSessions.expiresAt })
      .from(customerSessions)
      .where(and(eq(customerSessions.tokenHash, tokenHash), eq(customerSessions.environment, environment), gt(customerSessions.expiresAt, now.toISOString())));
    return row ? { email: row.email, expiresAt: iso(row.expiresAt) } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.delete(customerSessions).where(eq(customerSessions.tokenHash, tokenHash));
  }

  /** Housekeeping: expired sessions and codes older than a day. */
  async prune(now: Date): Promise<void> {
    await this.db.delete(customerSessions).where(lt(customerSessions.expiresAt, now.toISOString()));
    await this.db.delete(customerLoginCodes).where(or(lt(customerLoginCodes.createdAt, new Date(now.getTime() - 86_400_000).toISOString())));
  }

  async hasOrders(environment: ProviderEnvironment, email: string): Promise<boolean> {
    const res = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM core.orders o JOIN core.customers c ON c.id = o.customer_id
        WHERE o.environment = ${environment} AND lower(c.email) = ${email}
      ) AS found`);
    return res.rows[0]?.found === true;
  }

  async ownsOrder(environment: ProviderEnvironment, email: string, orderId: string): Promise<boolean> {
    const res = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM core.orders o JOIN core.customers c ON c.id = o.customer_id
        WHERE o.id = ${orderId} AND o.environment = ${environment} AND lower(c.email) = ${email}
      ) AS found`);
    return res.rows[0]?.found === true;
  }

  /** The address's orders in this environment, newest first (no draft orders: they never reached checkout). */
  async orders(environment: ProviderEnvironment, email: string, limit = 100): Promise<CustomerOrderRow[]> {
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT o.id, o.created_at, o.status::text AS status, o.charge_total_minor::text AS total_minor, o.charge_currency,
             f.product_type, f.option, f.booking_status, f.provider_booking_ref
      FROM core.orders o
      JOIN core.customers c ON c.id = o.customer_id
      LEFT JOIN LATERAL (
        SELECT i.product_type::text AS product_type, qv.option, pb.status::text AS booking_status, pb.provider_booking_ref
        FROM core.order_items i
        JOIN core.quote_versions qv ON qv.id = i.quote_version_id
        LEFT JOIN core.provider_bookings pb ON pb.order_item_id = i.id
        WHERE i.order_id = o.id ORDER BY i.position LIMIT 1
      ) f ON true
      WHERE o.environment = ${environment} AND lower(c.email) = ${email} AND o.status <> 'DRAFT'
      ORDER BY o.created_at DESC
      LIMIT ${limit}`);
    return res.rows.map((r) => {
      const option = (r.option ?? {}) as Record<string, unknown>;
      const legs = Array.isArray(option.legs) ? (option.legs as Array<{ date?: unknown }>) : [];
      const legDate = (i: number) => (typeof legs[i]?.date === 'string' ? (legs[i]!.date as string) : null);
      return {
        id: String(r.id),
        createdAt: iso(r.created_at),
        status: String(r.status),
        total: { currency: String(r.charge_currency).trim(), minor: String(r.total_minor) },
        productType: (r.product_type as string | null) ?? null,
        title: typeof option.hotelName === 'string' ? option.hotelName : typeof option.title === 'string' ? option.title : null,
        checkin: typeof option.checkin === 'string' ? option.checkin : legDate(0),
        checkout: typeof option.checkout === 'string' ? option.checkout : legDate(1),
        bookingStatus: (r.booking_status as string | null) ?? null,
        providerBookingRef: (r.provider_booking_ref as string | null) ?? null,
      };
    });
  }
}
