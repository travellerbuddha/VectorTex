import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { IdempotencyConflictError } from '@texholiday/contracts';
import { money } from '@texholiday/pricing';
import { CheckoutRepository, IdempotencyRepository, InboxRepository, PaymentUnresolvedError, QuoteRepository, schema, type CoreDatabase } from '../src/index';
import { dbError, freshDatabase, seedOrder } from './support/db';

let core: CoreDatabase;

beforeAll(async () => {
  core = await freshDatabase();
});
afterAll(async () => {
  await core?.close();
});

describe('database invariants', () => {
  it('quote versions are immutable; acceptance can be recorded once (content editors cannot change prices)', async () => {
    await seedOrder(core);
    const [qv] = await core.db.select({ id: schema.quoteVersions.id }).from(schema.quoteVersions).limit(1);
    expect(await dbError(core.db.execute(sql`UPDATE core.quote_versions SET charge_now_minor = 1 WHERE id = ${qv!.id}`))).toMatch(/immutable|only once/);
    await expect(new QuoteRepository(core.db).accept(qv!.id, 'terms-v2')).rejects.toThrow(/already accepted/);
    expect(await dbError(core.db.execute(sql`UPDATE core.quote_versions SET accepted_at = now() WHERE id = ${qv!.id}`))).toMatch(/only once/);
    expect(await dbError(core.db.execute(sql`DELETE FROM core.quote_versions WHERE id = ${qv!.id}`))).toMatch(/immutable/);
  });

  it('ledger and audit are append-only', async () => {
    await core.db.insert(schema.ledgerEntries).values({ journalId: '00000000-0000-0000-0000-000000000001', account: 'test', direction: 'DEBIT', amountMinor: 1n, currency: 'EUR', kind: 'TEST' });
    expect(await dbError(core.db.execute(sql`UPDATE core.ledger_entries SET amount_minor = 2`))).toMatch(/append-only/);
    expect(await dbError(core.db.execute(sql`DELETE FROM core.ledger_entries`))).toMatch(/append-only/);
    await core.db.insert(schema.auditLogs).values({ entityType: 't', entityId: '1', action: 'a', actor: 'x', detail: {} });
    expect(await dbError(core.db.execute(sql`DELETE FROM core.audit_logs`))).toMatch(/append-only/);
    await expect(core.db.insert(schema.ledgerEntries).values({ journalId: '00000000-0000-0000-0000-000000000002', account: 'test', direction: 'DEBIT', amountMinor: 0n, currency: 'EUR', kind: 'TEST' })).rejects.toThrow();
  });

  it('approved policies are immutable except retirement; approval needs an approver', async () => {
    await expect(core.db.insert(schema.pricingPolicyVersions).values({ id: 'pp', version: 1, status: 'DRAFT', document: {}, createdBy: 'fin-1', updatedBy: 'fin-1' })).resolves.toBeDefined();
    expect(await dbError(core.db.execute(sql`UPDATE core.pricing_policy_versions SET status = 'APPROVED' WHERE id = 'pp'`))).toMatch(/approved_by/);
    await core.db.execute(sql`UPDATE core.pricing_policy_versions SET status = 'APPROVED', approved_by = 'cfo', approved_at = now() WHERE id = 'pp'`);
    expect(await dbError(core.db.execute(sql`UPDATE core.pricing_policy_versions SET document = '{"x":1}' WHERE id = 'pp'`))).toMatch(/immutable/);
    await core.db.execute(sql`UPDATE core.pricing_policy_versions SET status = 'RETIRED' WHERE id = 'pp'`);
    expect(await dbError(core.db.execute(sql`DELETE FROM core.pricing_policy_versions WHERE id = 'pp'`))).toMatch(/cannot be deleted/);
  });

  it('T21: no second payment attempt while one is live (UNKNOWN included); allowed after a decline', async () => {
    const { orderId, checkoutSessionId, total } = await seedOrder(core);
    const checkout = new CheckoutRepository(core.db);
    const second = { orderId, checkoutSessionId, environment: 'mock' as const, amount: money('EUR', total), gatewayId: 'other-gateway', mode: 'OWN_GATEWAY' as const };
    await core.db.execute(sql`UPDATE core.payment_attempts SET status = 'UNKNOWN' WHERE checkout_session_id = ${checkoutSessionId}`);
    await expect(checkout.startPaymentAttempt({ ...second, idempotencyKey: 'k-2' })).rejects.toBeInstanceOf(PaymentUnresolvedError);
    await core.db.execute(sql`UPDATE core.payment_attempts SET status = 'DECLINED' WHERE checkout_session_id = ${checkoutSessionId}`);
    await expect(checkout.startPaymentAttempt({ ...second, idempotencyKey: 'k-3' })).resolves.toMatch(/[0-9a-f-]{36}/);
  });

  it('T15: sandbox and production records never mix', async () => {
    const { orderId } = await seedOrder(core, undefined, 'sandbox');
    expect(await dbError(core.db.execute(sql`UPDATE core.provider_bookings SET environment = 'production' WHERE order_item_id IN (SELECT id FROM core.order_items WHERE order_id = ${orderId})`))).toMatch(
      /does not match order environment/,
    );
  });

  it('T01: item allocations must equal the order total at commit', async () => {
    const { orderId } = await seedOrder(core);
    expect(await dbError(core.db.execute(sql`UPDATE core.order_items SET charge_allocation_minor = charge_allocation_minor + 1 WHERE order_id = ${orderId} AND position = 0`))).toMatch(
      /do not equal order total/,
    );
  });
});

describe('inbox and idempotency', () => {
  it('T18: a repeated notification is recorded once', async () => {
    const inbox = new InboxRepository(core.db);
    const first = await inbox.record({ source: 'gateway:mock', dedupeKey: 'evt-1', environment: 'mock', rawBody: '{"a":1}' });
    const again = await inbox.record({ source: 'gateway:mock', dedupeKey: 'evt-1', environment: 'mock', rawBody: '{"a":1}' });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
  });

  it('§7 rule 3: same key + different body -> 409; same body -> stored response', async () => {
    const idem = new IdempotencyRepository(core.db);
    expect(await idem.begin('orders', 'key-1', { a: 1, b: 2 }, 3600)).toEqual({ state: 'NEW' });
    expect(await idem.begin('orders', 'key-1', { b: 2, a: 1 }, 3600)).toEqual({ state: 'IN_PROGRESS' });
    await idem.complete('orders', 'key-1', 202, { orderId: 'o-1' });
    expect(await idem.begin('orders', 'key-1', { a: 1, b: 2 }, 3600)).toEqual({ state: 'COMPLETED', status: 202, body: { orderId: 'o-1' } });
    await expect(idem.begin('orders', 'key-1', { a: 1, b: 3 }, 3600)).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
