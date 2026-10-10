import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { StaffActor } from '@texholiday/contracts';
import { PermissionRepository, PolicyRepository, PolicyValidationError, type CoreDatabase } from '../src/index';
import { dbError, freshDatabase } from './support/db';

let core: CoreDatabase;
let repo: PolicyRepository;

const owner: StaffActor = { kind: 'STAFF', id: 'staff-owner-1' };
const finance: StaffActor = { kind: 'STAFF', id: 'staff-finance-1' };
const finance2: StaffActor = { kind: 'STAFF', id: 'staff-finance-2' };
const approver: StaffActor = { kind: 'STAFF', id: 'staff-approver-1' };
const viewer: StaffActor = { kind: 'STAFF', id: 'staff-viewer-1' };
let permissions: PermissionRepository;

// Values below are test inputs typed by a "user"; the product ships no defaults.
const pricingDoc = (bp: number) => ({
  rounding: 'HALF_EVEN',
  rules: [
    { productType: 'HOTEL', paymentMode: 'OWN_GATEWAY', application: 'LOCAL', kind: 'PERCENT_OF_NET', basisPoints: bp },
    { productType: 'HOTEL', paymentMode: 'PROVIDER_MANAGED', application: 'PROVIDER_API', kind: 'PERCENT_OF_NET', basisPoints: bp },
  ],
  serviceFees: [{ code: 'SERVICE_FEE', label: { tr: 'Hizmet bedeli', en: 'Service fee' }, scope: 'PACKAGE', kind: 'FIXED', amounts: { EUR: '500', TRY: '15000' } }],
  fx: { source: 'tcmb-efektif-satis', maxRateAgeSeconds: 3600, rounding: 'HALF_UP' },
  allowBelowSspInOpaquePackage: false,
});

beforeAll(async () => {
  core = await freshDatabase();
  repo = new PolicyRepository(core.db);
  // Authority comes from grants made on the permissions screen (ADR-0007).
  permissions = new PermissionRepository(core.db);
  await permissions.bootstrapManager(owner.id);
  await permissions.grantRole(finance.id, 'FINANCE', owner);
  await permissions.grantRole(finance2.id, 'FINANCE', owner);
  await permissions.grantRole(approver.id, 'FINANCE_APPROVER', owner);
  await permissions.grantRole(viewer.id, 'VIEWER', owner);
});
afterAll(async () => {
  await core?.close();
});

describe('G06: business-editable pricing policy', () => {
  it('finance creates and edits drafts; another person approves; values become active', async () => {
    expect(await repo.activePricing('b2c')).toBeNull(); // no shipped default -> routes stay closed
    const v1 = await repo.createDraft('PRICING', 'b2c', pricingDoc(800), finance, 'initial margins');
    expect(v1.version).toBe(1);
    await repo.updateDraft('PRICING', 'b2c', 1, pricingDoc(900), finance2, 'raise to 9%');
    await repo.approve('PRICING', 'b2c', 1, approver);
    const active = await repo.activePricing('b2c');
    expect(active?.version).toBe(1);
    expect(active?.rules[0]).toMatchObject({ basisPoints: 900 });
    expect(active?.serviceFees[0]?.code).toBe('SERVICE_FEE');
  });

  it('a new version replaces the active one atomically; the old one is retired, not deleted', async () => {
    const v2 = await repo.createDraft('PRICING', 'b2c', pricingDoc(1000), finance, 'season change');
    expect(v2.version).toBe(2);
    expect((await repo.activePricing('b2c'))?.version).toBe(1); // drafts do not affect live prices
    await repo.approve('PRICING', 'b2c', 2, approver, 'ok');
    const versions = await repo.versions('PRICING', 'b2c');
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'APPROVED'],
      [1, 'RETIRED'],
    ]);
    expect((await repo.activePricing('b2c'))?.rules[0]).toMatchObject({ basisPoints: 1000 });
  });

  it('approved versions cannot be edited; changes always go through a new draft', async () => {
    await expect(repo.updateDraft('PRICING', 'b2c', 2, pricingDoc(1), finance)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await dbError(core.db.execute(sql`UPDATE core.pricing_policy_versions SET document = '{}' WHERE id = 'b2c' AND version = 2`))).toMatch(/immutable/);
  });

  it('enforces permissions and, by default, four-eyes approval', async () => {
    await expect(repo.createDraft('PRICING', 'b2c', pricingDoc(1), viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const v = await repo.createDraft('PRICING', 'b2c', pricingDoc(1100), finance);
    await expect(repo.approve('PRICING', 'b2c', v.version, finance2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Holding the approve permission is not enough for one's own draft.
    await permissions.grant(finance.id, 'pricing_policy.approve', owner);
    await expect(repo.approve('PRICING', 'b2c', v.version, finance)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await permissions.revoke(finance.id, 'pricing_policy.approve', owner);
    // The database refuses it even if application code were bypassed: FOUR_EYES needs another person, SELF needs approve_own.
    const approveDirect = (mode: string) =>
      core.db.execute(sql`UPDATE core.pricing_policy_versions SET status = 'APPROVED', approved_by = 'staff-finance-1', approved_at = now(), approval_mode = ${mode} WHERE id = 'b2c' AND version = ${v.version}`);
    expect(await dbError(approveDirect('FOUR_EYES'))).toMatch(/approval_mode|one_approved/);
    expect(await dbError(approveDirect('SELF'))).toMatch(/lacks the permission|one_approved/);
    // An approval without a mode is refused as well.
    expect(await dbError(core.db.execute(sql`UPDATE core.pricing_policy_versions SET approved_by = 'staff-approver-1' WHERE id = 'b2c' AND version = ${v.version}`))).toMatch(/approval_mode/);
    // Editing without the edit permission is refused by the database too.
    expect(await dbError(core.db.execute(sql`UPDATE core.pricing_policy_versions SET document = '{}', updated_by = 'staff-viewer-1' WHERE id = 'b2c' AND version = ${v.version}`))).toMatch(/lacks pricing_policy.edit/);
  });

  it('ADR-0007: a person given approve_own may approve their own change alone; it is recorded as SELF', async () => {
    const own = await repo.createDraft('PRICING', 'b2c', pricingDoc(1200), finance2, 'quick fix');
    await expect(repo.approve('PRICING', 'b2c', own.version, finance2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await permissions.grant(finance2.id, 'pricing_policy.approve_own', owner, 'single approver for weekends');
    expect(await repo.approve('PRICING', 'b2c', own.version, finance2)).toEqual({ approvalMode: 'SELF' });
    const [latest] = await repo.versions('PRICING', 'b2c');
    expect(latest).toMatchObject({ version: own.version, status: 'APPROVED', approvedBy: finance2.id, approvalMode: 'SELF' });
    const audit = await core.db.execute<{ detail: { approvalMode: string; permission: string } }>(
      sql`SELECT detail FROM core.audit_logs WHERE entity_type = 'policy:PRICING' AND action = 'policy.approved' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.rows[0]!.detail).toMatchObject({ approvalMode: 'SELF', permission: 'pricing_policy.approve_own' });
    // Revoking takes effect at once.
    await permissions.revoke(finance2.id, 'pricing_policy.approve_own', owner);
    const next = await repo.createDraft('PRICING', 'b2c', pricingDoc(1300), finance2);
    await expect(repo.approve('PRICING', 'b2c', next.version, finance2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await repo.approve('PRICING', 'b2c', next.version, approver)).toEqual({ approvalMode: 'FOUR_EYES' });
  });

  it('rejects inconsistent documents with field-level messages for the UI', async () => {
    const bad = pricingDoc(500);
    // Provider-managed sales cannot add a local margin (the provider collects); typo-sized margins are refused.
    (bad.rules[1] as Record<string, unknown>).application = 'LOCAL';
    (bad.rules[0] as Record<string, unknown>).basisPoints = 250_000;
    try {
      await repo.createDraft('PRICING', 'b2c', bad, finance);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyValidationError);
      const paths = (err as PolicyValidationError).issues.map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['rules.0.basisPoints', 'rules.1']));
    }
  });

  it('audit trail records every step with the actor', async () => {
    const rows = await core.db.execute<{ action: string; actor: string }>(sql`SELECT action, actor FROM core.audit_logs WHERE entity_type = 'policy:PRICING' ORDER BY id`);
    expect(rows.rows.slice(0, 3)).toEqual([
      { action: 'policy.draft_created', actor: 'staff-finance-1' },
      { action: 'policy.draft_updated', actor: 'staff-finance-2' },
      { action: 'policy.approved', actor: 'staff-approver-1' },
    ]);
  });
});

describe('G06: business-editable risk policy', () => {
  it('drives the orchestration safety margin once approved', async () => {
    expect(await repo.activeRisk('b2c')).toBeNull();
    await repo.createDraft(
      'RISK',
      'b2c',
      { maxUncapturedSupplierExposure: { EUR: '500000' }, authorizationSafetyMarginSeconds: 86_400, allowUnknownAsyncConfirmationBound: false, fundingPreference: ['ACCOUNT_CARD'] },
      finance,
    );
    await repo.approve('RISK', 'b2c', 1, approver);
    expect(await repo.activeRisk('b2c')).toMatchObject({ authorizationSafetyMarginSeconds: 86_400, fundingPreference: ['ACCOUNT_CARD'], status: 'APPROVED', approvedBy: 'staff-approver-1' });
    await expect(
      repo.createDraft('RISK', 'b2c', { maxUncapturedSupplierExposure: {}, authorizationSafetyMarginSeconds: -1, allowUnknownAsyncConfirmationBound: false, fundingPreference: [] }, finance),
    ).rejects.toBeInstanceOf(PolicyValidationError);
  });
});
