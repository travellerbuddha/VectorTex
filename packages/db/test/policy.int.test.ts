import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { StaffActor } from '@texholiday/contracts';
import { PolicyRepository, PolicyValidationError, type CoreDatabase } from '../src/index';
import { dbError, freshDatabase } from './support/db';

let core: CoreDatabase;
let repo: PolicyRepository;

const finance: StaffActor = { kind: 'STAFF', id: 'staff-finance-1', roles: ['FINANCE'] };
const finance2: StaffActor = { kind: 'STAFF', id: 'staff-finance-2', roles: ['FINANCE'] };
const approver: StaffActor = { kind: 'STAFF', id: 'staff-approver-1', roles: ['FINANCE_APPROVER'] };
const viewer: StaffActor = { kind: 'STAFF', id: 'staff-viewer-1', roles: ['VIEWER'] };

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

  it('enforces roles and four-eyes approval', async () => {
    await expect(repo.createDraft('PRICING', 'b2c', pricingDoc(1), viewer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const v = await repo.createDraft('PRICING', 'b2c', pricingDoc(1100), finance);
    await expect(repo.approve('PRICING', 'b2c', v.version, finance2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const both: StaffActor = { kind: 'STAFF', id: 'staff-finance-1', roles: ['FINANCE', 'FINANCE_APPROVER'] };
    await expect(repo.approve('PRICING', 'b2c', v.version, both)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The database refuses self-approval even if application code were bypassed.
    expect(await dbError(core.db.execute(sql`UPDATE core.pricing_policy_versions SET status = 'APPROVED', approved_by = 'staff-finance-1', approved_at = now() WHERE id = 'b2c' AND version = ${v.version}`))).toMatch(/four_eyes|one_approved/);
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
