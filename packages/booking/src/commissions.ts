import { DomainError, type Permission, type ProviderEnvironment, type StaffActor } from '@texholiday/contracts';
import { activePermissions, CommissionRepository, type CommissionFilter, type CommissionRow, type CoreDb, type PayoutRow } from '@texholiday/db';
import type { ProviderManagedOrchestrator } from '@texholiday/domain';
import type { Money } from '@texholiday/pricing';
import { istanbulDate } from './hotel-lists';

/**
 * Provider commission lifecycle (ADR-0019).
 *
 * - Payout (finance, `commissions.record_payout`): Nuitee pays our commission when it collects the customer's payment
 *   (account owner, 2026-10-10), so a payout usually settles commissions whose stay is not over yet. It is recorded
 *   with its statement reference, the commissions it settles and any it takes back (cancelled after they were paid);
 *   a difference needs a written note.
 * - Earning (worker, hourly): the day after the service ends (hotel check-out, last flight leg; Istanbul date) the
 *   provider is read again; a booking still confirmed earns its commission — paid or not — as revenue. No answer = not
 *   earned now, tried again on the next run (never earned on a guess).
 * - Cancelled after it was paid (stay not over): owed back to the provider until a payout nets it.
 * - Viewing needs `orders.view_financials`.
 *
 * Own-gateway orders (iyzico) are earned with that integration: the provider is read through another path there.
 */
export const COMMISSION_ACTOR = 'system:commission-earning';

export interface EarningRun {
  due: number;
  earned: number;
  /** Provider did not answer, a call for the order was in flight, or the booking is no longer confirmed. */
  skipped: number;
}

export interface CommissionOverview {
  totals: Awaited<ReturnType<CommissionRepository['totals']>>;
  rows: CommissionRow[];
  payouts: PayoutRow[];
}

export interface PayoutRequest {
  providerId: string;
  reference: string;
  amount: Money;
  receivedOn: string;
  note?: string | null;
  commissionIds: readonly string[];
  /** Paid commissions of cancelled bookings the provider takes back in this payout. */
  clawbackIds?: readonly string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REFERENCE = /^[\p{L}\p{N}][\p{L}\p{N} ._/:#-]{0,99}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_PAYOUT = 500;

export class ProviderCommissions {
  private readonly repo: CommissionRepository;
  private readonly clock: () => Date;

  constructor(
    private readonly deps: {
      db: CoreDb;
      environment: ProviderEnvironment;
      /** Reads the provider before earning; null = nothing is earned (no provider configured). */
      orchestrator: ProviderManagedOrchestrator | null;
      clock?: () => Date;
    },
  ) {
    this.repo = new CommissionRepository(deps.db);
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Worker job: earns the commissions whose service has ended, after reading each booking at the provider. */
  async earnDue(limit = 100): Promise<EarningRun> {
    const today = istanbulDate(this.clock());
    const due = await this.repo.due(this.deps.environment, today, 'PROVIDER_MANAGED', limit);
    const run: EarningRun = { due: due.length, earned: 0, skipped: 0 };
    const orchestrator = this.deps.orchestrator;
    for (const c of due) {
      if (!orchestrator) {
        run.skipped += 1;
        continue;
      }
      const check = await orchestrator.checkStatus(c.orderId, COMMISSION_ACTOR).catch(() => null);
      // Cancelled at the provider: the check has already cancelled the order and voided the commission.
      if (!check || !check.providerAnswered || check.busy || (check.bookingStatus !== 'CONFIRMED' && check.bookingStatus !== 'ISSUED')) {
        run.skipped += 1;
        continue;
      }
      if (await this.repo.markEarned(c.id, this.clock(), COMMISSION_ACTOR)) run.earned += 1;
      else run.skipped += 1;
    }
    return run;
  }

  private async require(actor: StaffActor, permission: Permission): Promise<void> {
    if (actor.kind !== 'STAFF' || !(await activePermissions(this.deps.db, actor.id)).has(permission)) {
      throw new DomainError('FORBIDDEN', `Missing permission ${permission}`, { httpStatus: 403 });
    }
  }

  async overview(actor: StaffActor, filter: CommissionFilter = {}): Promise<CommissionOverview> {
    await this.require(actor, 'orders.view_financials');
    const [totals, rows, payouts] = await Promise.all([this.repo.totals(this.deps.environment), this.repo.list(this.deps.environment, filter), this.repo.payouts(this.deps.environment)]);
    return { totals, rows, payouts };
  }

  async recordPayout(actor: StaffActor, req: PayoutRequest): Promise<{ payoutId: string; commissions: Money; clawbacks: Money; difference: Money }> {
    await this.require(actor, 'commissions.record_payout');
    const bad = (m: string) => new DomainError('VALIDATION_FAILED', m, { httpStatus: 422, action: 'FIX_FIELDS' });
    const reference = req.reference.trim();
    if (!REFERENCE.test(reference)) throw bad('Enter the payout reference from the statement (letters, digits, . _ / : # -)');
    // Zero is possible: the refunds deducted can take up the whole payout.
    if (req.amount.minor < 0n) throw bad('The amount received cannot be negative');
    if (!DATE.test(req.receivedOn) || new Date(`${req.receivedOn}T00:00:00Z`).toISOString().slice(0, 10) !== req.receivedOn) throw bad('Enter the date the payout arrived');
    if (req.receivedOn > istanbulDate(this.clock())) throw bad('The payout date cannot be in the future');
    const ids = [...new Set(req.commissionIds)];
    const clawbackIds = [...new Set(req.clawbackIds ?? [])];
    if (ids.length + clawbackIds.length === 0) throw bad('Select the commissions this payout settles');
    if (ids.length + clawbackIds.length > MAX_PER_PAYOUT || [...ids, ...clawbackIds].some((id) => !UUID.test(id))) throw bad(`Select at most ${MAX_PER_PAYOUT} commissions`);
    const note = req.note?.trim() || null;
    if (note && note.length > 500) throw bad('The note is at most 500 characters');
    const r = await this.repo.recordPayout({
      environment: this.deps.environment,
      providerId: req.providerId,
      reference,
      currency: req.amount.currency,
      amountMinor: req.amount.minor,
      receivedOn: req.receivedOn,
      note,
      commissionIds: ids,
      clawbackIds,
      actor: `staff:${actor.id}`,
      at: this.clock(),
    });
    const ccy = req.amount.currency;
    return { payoutId: r.payoutId, commissions: { currency: ccy, minor: r.commissionsMinor }, clawbacks: { currency: ccy, minor: r.clawbacksMinor }, difference: { currency: ccy, minor: r.differenceMinor } };
  }
}
