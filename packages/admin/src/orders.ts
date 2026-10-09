import { and, asc, eq, sql } from 'drizzle-orm';
import { DomainError, type Permission, type StaffActor } from '@texholiday/contracts';
import { activePermissions, schema, type CoreDb } from '@texholiday/db';

const { auditLogs, operationTasks } = schema;

type Env = 'mock' | 'sandbox' | 'production';
type MoneyJson = { currency: string; minor: string };

const forbidden = (p: Permission) => new DomainError('FORBIDDEN', `Missing permission ${p}`, { httpStatus: 403 });
const notFound = () => new DomainError('NOT_FOUND', 'Not found', { httpStatus: 404 });
const invalid = (message: string) => new DomainError('VALIDATION_FAILED', message, { httpStatus: 422, action: 'FIX_FIELDS' });

export const ORDER_STATUSES = ['DRAFT', 'PROCESSING', 'CONFIRMED', 'ACTION_REQUIRED', 'COMPENSATING', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderListFilter {
  status?: OrderStatus | null;
  /** Order id prefix, provider booking reference, customer email or guest surname. */
  q?: string | null;
  /** Orders needing a person: action required, open tasks or an unknown booking outcome. */
  attention?: boolean;
  limit?: number;
  offset?: number;
}

export interface OrderListRow {
  id: string;
  createdAt: string;
  status: OrderStatus;
  total: MoneyJson;
  productType: string | null;
  title: string | null;
  checkin: string | null;
  checkout: string | null;
  holderName: string | null;
  customerEmail: string;
  bookingStatus: string | null;
  providerBookingRef: string | null;
  paymentStatus: string | null;
  openTasks: number;
  belowSuggestedPrice: boolean | null;
}

export interface OrderDetail {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: OrderStatus;
  environment: Env;
  route: unknown;
  total: MoneyJson;
  compensationReason: string | null;
  customer: { email: string; locale: string; kind: string };
  items: Array<{
    id: string;
    position: number;
    productType: string;
    providerId: string;
    fundingMethod: string;
    option: Record<string, unknown>;
    cancellation: unknown;
    payAtProperty: unknown;
    charge: MoneyJson;
    guests: { holder: Record<string, string>; roomGuests: Array<Record<string, unknown>> } | null;
    booking: {
      status: string;
      providerBookingRef: string | null;
      clientReference: string | null;
      failureCode: string | null;
      voucherReady: boolean;
      cancellation: string | null;
      unknownOperation: string | null;
      lookupAttempts: number;
      updatedAt: string;
    } | null;
    /** Present only for holders of orders.view_financials. */
    financials: { supplierCost: MoneyJson; sell: MoneyJson; providerCommission: MoneyJson | null; commissionStatus: string | null } | null;
  }>;
  payment: { mode: string; gatewayId: string; status: string; amount: MoneyJson; providerTransactionId: string | null; payBy: string | null; createdAt: string } | null;
  tasks: TaskRow[];
  timeline: Array<{ at: string; action: string; actor: string; detail: unknown }>;
  canSeeFinancials: boolean;
}

export interface TaskRow {
  id: string;
  orderId: string;
  orderItemId: string | null;
  reason: string;
  status: 'OPEN' | 'RESOLVED';
  detail: string;
  assignee: string | null;
  dueAt: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const money = (minor: unknown, currency: unknown): MoneyJson => ({ currency: String(currency), minor: String(minor) });
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

/**
 * Read side of the operations screens (§16) plus task handling. Reads only the deployment's provider environment.
 * Authority is checked here (not only in the UI): orders.view for orders and tasks, orders.view_financials for
 * costs/commission, tasks.manage for task changes. Opening an order (personal data) is recorded.
 */
export class OrdersQuery {
  constructor(
    private readonly db: CoreDb,
    private readonly environment: Env,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async require(actor: StaffActor, p: Permission): Promise<Set<Permission>> {
    const held = await activePermissions(this.db, actor.id);
    if (!held.has(p)) throw forbidden(p);
    return held;
  }

  async list(actor: StaffActor, filter: OrderListFilter = {}): Promise<OrderListRow[]> {
    await this.require(actor, 'orders.view');
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const q = (filter.q ?? '').trim();
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT o.id, o.created_at, o.status, o.charge_total_minor::text AS total_minor, o.charge_currency,
             c.email, f.product_type, f.option, f.holder, f.booking_status, f.provider_booking_ref,
             p.status AS payment_status, coalesce(tk.n, 0) AS open_tasks
      FROM core.orders o
      JOIN core.customers c ON c.id = o.customer_id
      LEFT JOIN LATERAL (
        SELECT i.product_type, qv.option, g.holder, pb.status AS booking_status, pb.provider_booking_ref
        FROM core.order_items i
        JOIN core.quote_versions qv ON qv.id = i.quote_version_id
        LEFT JOIN core.order_item_guests g ON g.order_item_id = i.id
        LEFT JOIN core.provider_bookings pb ON pb.order_item_id = i.id
        WHERE i.order_id = o.id ORDER BY i.position LIMIT 1
      ) f ON true
      LEFT JOIN LATERAL (SELECT pa.status FROM core.payment_attempts pa WHERE pa.order_id = o.id ORDER BY pa.created_at DESC LIMIT 1) p ON true
      LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM core.operation_tasks t WHERE t.order_id = o.id AND t.status = 'OPEN') tk ON true
      WHERE o.environment = ${this.environment}
        AND (${filter.status ?? null}::text IS NULL OR o.status::text = ${filter.status ?? null})
        AND (${q === ''} OR o.id::text LIKE ${`${q.toLowerCase()}%`} OR c.email ILIKE ${like} OR f.provider_booking_ref = ${q}
             OR f.holder->>'lastName' ILIKE ${like})
        AND (NOT ${filter.attention === true} OR o.status = 'ACTION_REQUIRED' OR coalesce(tk.n, 0) > 0 OR f.booking_status = 'UNKNOWN')
      ORDER BY o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`);
    return rows.rows.map((r) => {
      const option = (r.option ?? {}) as Record<string, unknown>;
      const holder = (r.holder ?? null) as Record<string, string> | null;
      const parity = option.rateParity as { belowSuggestedPrice?: boolean } | null | undefined;
      return {
        id: String(r.id),
        createdAt: iso(r.created_at),
        status: r.status as OrderStatus,
        total: money(r.total_minor, r.charge_currency),
        productType: (r.product_type as string | null) ?? null,
        title: typeof option.hotelName === 'string' ? option.hotelName : null,
        checkin: typeof option.checkin === 'string' ? option.checkin : null,
        checkout: typeof option.checkout === 'string' ? option.checkout : null,
        holderName: holder ? `${holder.firstName ?? ''} ${holder.lastName ?? ''}`.trim() : null,
        customerEmail: String(r.email),
        bookingStatus: (r.booking_status as string | null) ?? null,
        providerBookingRef: (r.provider_booking_ref as string | null) ?? null,
        paymentStatus: (r.payment_status as string | null) ?? null,
        openTasks: Number(r.open_tasks ?? 0),
        belowSuggestedPrice: parity && typeof parity.belowSuggestedPrice === 'boolean' ? parity.belowSuggestedPrice : null,
      };
    });
  }

  async detail(actor: StaffActor, orderId: string): Promise<OrderDetail> {
    const held = await this.require(actor, 'orders.view');
    const financials = held.has('orders.view_financials');
    const [o] = (
      await this.db.execute<Record<string, unknown>>(sql`
        SELECT o.*, o.charge_total_minor::text AS total_minor, c.email, c.locale, c.kind
        FROM core.orders o JOIN core.customers c ON c.id = o.customer_id
        WHERE o.id = ${orderId} AND o.environment = ${this.environment}`)
    ).rows;
    if (!o) throw notFound();

    const items = await this.db.execute<Record<string, unknown>>(sql`
      SELECT i.id, i.position, i.product_type, i.provider_id, i.funding_method,
             i.charge_allocation_minor::text AS charge_minor, i.charge_currency,
             i.supplier_cost_minor::text AS cost_minor, i.supplier_cost_currency,
             qv.option, qv.cancellation, qv.pay_at_property, qv.sell_minor::text AS sell_minor, qv.sell_currency,
             qv.provider_commission_minor::text AS quote_commission_minor,
             g.holder, g.room_guests,
             pb.status AS booking_status, pb.provider_booking_ref, pb.client_reference, pb.failure_code, pb.voucher_ready,
             pb.cancellation AS booking_cancellation, pb.unknown_operation, pb.lookup_attempts, pb.updated_at AS booking_updated_at,
             pb.provider_commission_minor::text AS booked_commission_minor, pb.provider_commission_currency,
             pc.status AS commission_status
      FROM core.order_items i
      JOIN core.quote_versions qv ON qv.id = i.quote_version_id
      LEFT JOIN core.order_item_guests g ON g.order_item_id = i.id
      LEFT JOIN core.provider_bookings pb ON pb.order_item_id = i.id
      LEFT JOIN core.provider_commissions pc ON pc.order_item_id = i.id
      WHERE i.order_id = ${orderId}
      ORDER BY i.position`);

    const [pay] = (
      await this.db.execute<Record<string, unknown>>(sql`
        SELECT mode, gateway_id, status, amount_minor::text AS amount_minor, currency, provider_transaction_id, pay_by, created_at
        FROM core.payment_attempts WHERE order_id = ${orderId} ORDER BY created_at DESC LIMIT 1`)
    ).rows;

    const tasks = await this.tasksOf(sql`t.order_id = ${orderId}`);
    const timeline = await this.db
      .select({ at: auditLogs.createdAt, action: auditLogs.action, actor: auditLogs.actor, detail: auditLogs.detail })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'order'), eq(auditLogs.entityId, orderId)))
      .orderBy(asc(auditLogs.id));

    // Opening an order shows personal data: record who looked (separate entity so the order timeline stays clean).
    await this.db.insert(auditLogs).values({ entityType: 'order_access', entityId: orderId, action: 'order.viewed', actor: actor.id, detail: { financials } });

    return {
      id: String(o.id),
      createdAt: iso(o.created_at),
      updatedAt: iso(o.updated_at),
      status: o.status as OrderStatus,
      environment: o.environment as Env,
      route: o.route,
      total: money(o.total_minor, o.charge_currency),
      compensationReason: (o.compensation_reason as string | null) ?? null,
      customer: { email: String(o.email), locale: String(o.locale), kind: String(o.kind) },
      items: items.rows.map((i) => {
        const bookedCommission = i.booked_commission_minor !== null && i.booked_commission_minor !== undefined;
        return {
          id: String(i.id),
          position: Number(i.position),
          productType: String(i.product_type),
          providerId: String(i.provider_id),
          fundingMethod: String(i.funding_method),
          option: (i.option ?? {}) as Record<string, unknown>,
          cancellation: i.cancellation,
          payAtProperty: i.pay_at_property,
          charge: money(i.charge_minor, i.charge_currency),
          guests: i.holder ? { holder: i.holder as Record<string, string>, roomGuests: (i.room_guests ?? []) as Array<Record<string, unknown>> } : null,
          booking: i.booking_status
            ? {
                status: String(i.booking_status),
                providerBookingRef: (i.provider_booking_ref as string | null) ?? null,
                clientReference: (i.client_reference as string | null) ?? null,
                failureCode: (i.failure_code as string | null) ?? null,
                voucherReady: i.voucher_ready === true,
                cancellation: (i.booking_cancellation as string | null) ?? null,
                unknownOperation: (i.unknown_operation as string | null) ?? null,
                lookupAttempts: Number(i.lookup_attempts ?? 0),
                updatedAt: iso(i.booking_updated_at),
              }
            : null,
          financials: financials
            ? {
                supplierCost: money(i.cost_minor, i.supplier_cost_currency),
                sell: money(i.sell_minor, i.sell_currency),
                providerCommission: bookedCommission
                  ? money(i.booked_commission_minor, i.provider_commission_currency)
                  : i.quote_commission_minor && i.quote_commission_minor !== '0'
                    ? money(i.quote_commission_minor, i.supplier_cost_currency)
                    : null,
                commissionStatus: (i.commission_status as string | null) ?? null,
              }
            : null,
        };
      }),
      payment: pay
        ? {
            mode: String(pay.mode),
            gatewayId: String(pay.gateway_id),
            status: String(pay.status),
            amount: money(pay.amount_minor, pay.currency),
            providerTransactionId: (pay.provider_transaction_id as string | null) ?? null,
            payBy: isoOrNull(pay.pay_by),
            createdAt: iso(pay.created_at),
          }
        : null,
      tasks,
      timeline: timeline.map((e) => ({ at: e.at, action: e.action, actor: e.actor, detail: e.detail })),
      canSeeFinancials: financials,
    };
  }

  // ------------------------------------------------------------------ tasks

  private async tasksOf(where: ReturnType<typeof sql>): Promise<TaskRow[]> {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT t.* FROM core.operation_tasks t JOIN core.orders o ON o.id = t.order_id
      WHERE o.environment = ${this.environment} AND ${where}
      ORDER BY (t.status = 'OPEN') DESC, t.created_at DESC
      LIMIT 200`);
    return rows.rows.map((t) => ({
      id: String(t.id),
      orderId: String(t.order_id),
      orderItemId: (t.order_item_id as string | null) ?? null,
      reason: String(t.reason),
      status: t.status as 'OPEN' | 'RESOLVED',
      detail: String(t.detail),
      assignee: (t.assignee as string | null) ?? null,
      dueAt: isoOrNull(t.due_at),
      resolution: (t.resolution as string | null) ?? null,
      createdAt: iso(t.created_at),
      resolvedAt: isoOrNull(t.resolved_at),
    }));
  }

  async tasks(actor: StaffActor, status: 'OPEN' | 'RESOLVED' | 'ALL' = 'OPEN'): Promise<TaskRow[]> {
    await this.require(actor, 'orders.view');
    return this.tasksOf(status === 'ALL' ? sql`true` : sql`t.status = ${status}`);
  }

  /** Takes an open task (the person becomes its assignee). */
  async takeTask(actor: StaffActor, taskId: string): Promise<void> {
    await this.require(actor, 'tasks.manage');
    const rows = await this.db
      .update(operationTasks)
      .set({ assignee: actor.id })
      .where(and(eq(operationTasks.id, taskId), eq(operationTasks.status, 'OPEN')))
      .returning({ orderId: operationTasks.orderId, reason: operationTasks.reason });
    if (rows.length === 0) throw notFound();
    await this.db.insert(auditLogs).values({ entityType: 'order', entityId: rows[0]!.orderId, action: 'task.assigned', actor: actor.id, detail: { taskId, reason: rows[0]!.reason } });
  }

  /** Closes an open task with what was done (kept on the task and in the order timeline). */
  async resolveTask(actor: StaffActor, taskId: string, resolution: string): Promise<void> {
    await this.require(actor, 'tasks.manage');
    const text = String(resolution ?? '').trim();
    if (text.length < 5 || text.length > 1000) throw invalid('Describe what was done (5-1000 characters)');
    const rows = await this.db
      .update(operationTasks)
      .set({ status: 'RESOLVED', resolution: text, resolvedAt: this.clock().toISOString(), assignee: sql`coalesce(${operationTasks.assignee}, ${actor.id})` })
      .where(and(eq(operationTasks.id, taskId), eq(operationTasks.status, 'OPEN')))
      .returning({ orderId: operationTasks.orderId, reason: operationTasks.reason });
    if (rows.length === 0) throw notFound();
    await this.db.insert(auditLogs).values({ entityType: 'order', entityId: rows[0]!.orderId, action: 'task.resolved', actor: actor.id, detail: { taskId, reason: rows[0]!.reason, resolution: text } });
  }
}
