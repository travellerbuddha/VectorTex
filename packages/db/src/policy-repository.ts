import { and, desc, eq, max, sql } from 'drizzle-orm';
import { DomainError, riskPolicyDocumentSchema, type Permission, type RiskPolicyVersion, type StaffActor } from '@texholiday/contracts';
import { pricingPolicyDocumentSchema, type PricingPolicyVersion } from '@texholiday/pricing';
import type { CoreDb } from './client';
import { activePermissions } from './permission-repository';
import { auditLogs, pricingPolicyVersions, riskPolicyVersions } from './schema';

export type PolicyKind = 'PRICING' | 'RISK';

const TABLE = { PRICING: pricingPolicyVersions, RISK: riskPolicyVersions } as const;
const SCHEMA = { PRICING: pricingPolicyDocumentSchema, RISK: riskPolicyDocumentSchema } as const;

/** Permissions per policy kind (ADR-0007); assigned to people on the permissions screen. */
const PERMISSION = {
  PRICING: { edit: 'pricing_policy.edit', approve: 'pricing_policy.approve', approveOwn: 'pricing_policy.approve_own' },
  RISK: { edit: 'risk_policy.edit', approve: 'risk_policy.approve', approveOwn: 'risk_policy.approve_own' },
} as const satisfies Record<PolicyKind, Record<'edit' | 'approve' | 'approveOwn', Permission>>;

export interface PolicyValidationIssue {
  path: string;
  message: string;
}

export class PolicyValidationError extends DomainError {
  readonly issues: readonly PolicyValidationIssue[];
  constructor(issues: readonly PolicyValidationIssue[]) {
    super('VALIDATION_FAILED', 'Policy document is invalid', { httpStatus: 422, action: 'FIX_FIELDS' });
    this.issues = issues;
  }
}

export interface PolicyVersionRow {
  kind: PolicyKind;
  id: string;
  version: number;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  document: unknown;
  createdBy: string;
  updatedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalMode: 'FOUR_EYES' | 'SELF' | null;
  changeNote: string | null;
  updatedAt: string;
}

const forbidden = (message: string) => new DomainError('FORBIDDEN', message, { httpStatus: 403 });

/**
 * Business-editable pricing and risk policies (G06). Values are entered by authorized staff, never shipped as
 * defaults. Every change is a versioned DRAFT. Another person holding `<kind>.approve` approves it (FOUR_EYES);
 * the author may approve alone only if they were given `<kind>.approve_own` (SELF, ADR-0007). The previously active
 * version is retired in the same transaction. Approved versions are immutable (DB trigger), and quotes keep the
 * version they were priced with. Authority comes from the person's active grants, never from the caller.
 */
export class PolicyRepository {
  constructor(private readonly db: CoreDb) {}

  private validate(kind: PolicyKind, document: unknown): Record<string, unknown> {
    const parsed = SCHEMA[kind].safeParse(document);
    if (!parsed.success) {
      throw new PolicyValidationError(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    return parsed.data as Record<string, unknown>;
  }

  private async audit(tx: CoreDb, kind: PolicyKind, id: string, version: number, action: string, actor: StaffActor, detail: Record<string, unknown>) {
    await tx.insert(auditLogs).values({ entityType: `policy:${kind}`, entityId: `${id}@${version}`, action, actor: actor.id, detail });
  }

  private async require(kind: PolicyKind, actor: StaffActor, action: 'edit' | 'approve'): Promise<Set<Permission>> {
    const held = await activePermissions(this.db, actor.id);
    if (!held.has(PERMISSION[kind][action])) throw forbidden(`Missing permission ${PERMISSION[kind][action]}`);
    return held;
  }

  /** Starts a new DRAFT version (optionally copying the active one so users only change what they need). */
  async createDraft(kind: PolicyKind, id: string, document: unknown, actor: StaffActor, changeNote: string | null = null): Promise<{ id: string; version: number }> {
    await this.require(kind, actor, 'edit');
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) throw new PolicyValidationError([{ path: 'id', message: 'lowercase letters, digits and dashes' }]);
    const doc = this.validate(kind, document);
    const table = TABLE[kind];
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`policy:${kind}:${id}`}))`);
      const [row] = await tx.select({ v: max(table.version) }).from(table).where(eq(table.id, id));
      const version = (row?.v ?? 0) + 1;
      await tx.insert(table).values({ id, version, status: 'DRAFT', document: doc, createdBy: actor.id, updatedBy: actor.id, changeNote });
      await this.audit(tx as unknown as CoreDb, kind, id, version, 'policy.draft_created', actor, { changeNote });
      return { id, version };
    });
  }

  async updateDraft(kind: PolicyKind, id: string, version: number, document: unknown, actor: StaffActor, changeNote: string | null = null): Promise<void> {
    await this.require(kind, actor, 'edit');
    const doc = this.validate(kind, document);
    const table = TABLE[kind];
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(table)
        .set({ document: doc, updatedBy: actor.id, changeNote, updatedAt: sql`now()` as unknown as string })
        .where(and(eq(table.id, id), eq(table.version, version), eq(table.status, 'DRAFT')))
        .returning({ id: table.id });
      if (rows.length === 0) throw new DomainError('VERSION_CONFLICT', 'Only DRAFT versions can be edited', { httpStatus: 409 });
      await this.audit(tx as unknown as CoreDb, kind, id, version, 'policy.draft_updated', actor, { changeNote });
    });
  }

  /**
   * Approves a DRAFT; the previously active version is retired atomically. Someone else's draft needs
   * `<kind>.approve` (FOUR_EYES); the author's or last editor's own draft needs `<kind>.approve_own` (SELF).
   */
  async approve(kind: PolicyKind, id: string, version: number, actor: StaffActor, note: string | null = null): Promise<{ approvalMode: 'FOUR_EYES' | 'SELF' }> {
    const held = await activePermissions(this.db, actor.id);
    const table = TABLE[kind];
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`policy:${kind}:${id}`}))`);
      const [draft] = await tx.select().from(table).where(and(eq(table.id, id), eq(table.version, version)));
      if (!draft || draft.status !== 'DRAFT') throw new DomainError('VERSION_CONFLICT', 'Only a DRAFT version can be approved', { httpStatus: 409 });
      const own = draft.createdBy === actor.id || draft.updatedBy === actor.id;
      const needed = own ? PERMISSION[kind].approveOwn : PERMISSION[kind].approve;
      if (!held.has(needed)) {
        throw forbidden(own ? `The author or last editor needs ${needed} to approve alone; otherwise another approver must approve` : `Missing permission ${needed}`);
      }
      const approvalMode = own ? 'SELF' : 'FOUR_EYES';
      this.validate(kind, draft.document);
      await tx.update(table).set({ status: 'RETIRED' }).where(and(eq(table.id, id), eq(table.status, 'APPROVED')));
      await tx
        .update(table)
        .set({ status: 'APPROVED', approvedBy: actor.id, approvedAt: sql`now()` as unknown as string, approvalMode })
        .where(and(eq(table.id, id), eq(table.version, version)));
      await this.audit(tx as unknown as CoreDb, kind, id, version, 'policy.approved', actor, { note, approvalMode, permission: needed });
      return { approvalMode };
    });
  }

  /** Stops using a policy. With no approved version, routes depending on it close (no fallback values). */
  async retire(kind: PolicyKind, id: string, version: number, actor: StaffActor, note: string | null = null): Promise<void> {
    await this.require(kind, actor, 'approve');
    const table = TABLE[kind];
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(table)
        .set({ status: 'RETIRED' })
        .where(and(eq(table.id, id), eq(table.version, version), eq(table.status, 'APPROVED')))
        .returning({ id: table.id });
      if (rows.length === 0) throw new DomainError('VERSION_CONFLICT', 'Only the APPROVED version can be retired', { httpStatus: 409 });
      await this.audit(tx as unknown as CoreDb, kind, id, version, 'policy.retired', actor, { note });
    });
  }

  async versions(kind: PolicyKind, id: string): Promise<PolicyVersionRow[]> {
    const table = TABLE[kind];
    const rows = await this.db.select().from(table).where(eq(table.id, id)).orderBy(desc(table.version));
    return rows.map((r) => ({ kind, ...r, approvedAt: r.approvedAt, updatedAt: r.updatedAt }));
  }

  async activePricing(id: string): Promise<PricingPolicyVersion | null> {
    const [r] = await this.db.select().from(pricingPolicyVersions).where(and(eq(pricingPolicyVersions.id, id), eq(pricingPolicyVersions.status, 'APPROVED')));
    if (!r) return null;
    const doc = pricingPolicyDocumentSchema.parse(r.document);
    return { ...doc, id: r.id, version: r.version, status: 'APPROVED', approvedBy: r.approvedBy, approvedAt: r.approvedAt };
  }

  async activeRisk(id: string): Promise<RiskPolicyVersion | null> {
    const [r] = await this.db.select().from(riskPolicyVersions).where(and(eq(riskPolicyVersions.id, id), eq(riskPolicyVersions.status, 'APPROVED')));
    if (!r) return null;
    const doc = riskPolicyDocumentSchema.parse(r.document);
    return { ...doc, id: r.id, version: r.version, status: 'APPROVED', approvedBy: r.approvedBy, approvedAt: r.approvedAt };
  }
}
