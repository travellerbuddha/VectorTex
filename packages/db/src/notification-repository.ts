import { asc, eq, sql } from 'drizzle-orm';
import type { CoreDb } from './client';
import { auditLogs, customerNotifications, customers, orderItemGuests, orderItems, orders } from './schema';

export type CustomerMailKind = 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'REFUND_RECORDED' | 'PAYMENT_NOT_BOOKED';

/** Who receives an order's mails: the booking customer, in the language they booked in. */
export interface MailRecipient {
  email: string;
  locale: 'tr' | 'en';
  /** Booking holder's first name for the greeting; null when not stored. */
  firstName: string | null;
}

/**
 * Customer e-mail bookkeeping (P16). One row per outbox event: a repeat of the event (at-least-once delivery) finds the
 * row and does not send again once it is SENT. Outcomes are also written to the order's audit log for operations;
 * neither place stores the address or the message.
 */
export class NotificationRepository {
  constructor(private readonly db: CoreDb) {}

  async recipient(orderId: string): Promise<MailRecipient | null> {
    const [row] = await this.db
      .select({ email: customers.email, locale: customers.locale })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.id, orderId));
    if (!row) return null;
    const [guests] = await this.db
      .select({ holder: orderItemGuests.holder })
      .from(orderItems)
      .innerJoin(orderItemGuests, eq(orderItemGuests.orderItemId, orderItems.id))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.position))
      .limit(1);
    const first = (guests?.holder as { firstName?: unknown } | undefined)?.firstName;
    return { email: row.email, locale: row.locale, firstName: typeof first === 'string' && first.trim() !== '' ? first.trim() : null };
  }

  /**
   * Claims the mail of an event. Returns 'SEND' for a first try or a retry after an unrecorded outcome (SENDING), and
   * 'DONE' when the event was already handled (SENT or NOT_CONFIGURED).
   */
  async claim(eventId: string, orderId: string, kind: CustomerMailKind): Promise<'SEND' | 'DONE'> {
    const inserted = await this.db
      .insert(customerNotifications)
      .values({ eventId, orderId, kind, status: 'SENDING' })
      .onConflictDoNothing({ target: customerNotifications.eventId })
      .returning({ id: customerNotifications.id });
    if (inserted.length > 0) return 'SEND';
    const [existing] = await this.db
      .update(customerNotifications)
      .set({ attempts: sql`${customerNotifications.attempts} + 1`, updatedAt: sql`now()` })
      .where(eq(customerNotifications.eventId, eventId))
      .returning({ status: customerNotifications.status });
    return existing?.status === 'SENDING' ? 'SEND' : 'DONE';
  }

  async finish(eventId: string, orderId: string, kind: CustomerMailKind, status: 'SENT' | 'NOT_CONFIGURED'): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(customerNotifications).set({ status, updatedAt: sql`now()` }).where(eq(customerNotifications.eventId, eventId));
      await tx.insert(auditLogs).values({ entityType: 'order', entityId: orderId, action: status === 'SENT' ? 'customer_mail.sent' : 'customer_mail.not_configured', actor: 'system:mail', detail: { kind } });
    });
  }

  /** A refused or lost send: recorded for operations; the event is retried by the outbox. */
  async failed(orderId: string, kind: CustomerMailKind, reason: string): Promise<void> {
    await this.db.insert(auditLogs).values({ entityType: 'order', entityId: orderId, action: 'customer_mail.failed', actor: 'system:mail', detail: { kind, reason: reason.slice(0, 200) } });
  }
}
