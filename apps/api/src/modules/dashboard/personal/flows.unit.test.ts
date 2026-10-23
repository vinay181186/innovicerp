// ADR-250 — review fixes (capa blank name, PR approval predicate, PO approvers,
// JobCard QC notes, Mine scope, ops_running), without a database. Run via
// `pnpm --filter @innovic/api test:unit`.

import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { type Dash, dash, ev, raw, rowCtx } from './test-fixtures';

vi.mock('../../../db/client', () => ({ db: {} }));
vi.mock('../../access-control/service', () => ({ getMyAccess: vi.fn() }));
vi.mock('../../purchase-requests/service', () => ({ orderedQtySql: () => sql`0` }));
vi.mock('../../party-grn/service', () => ({ PENDING_QC_SQL: sql.raw('true') }));
// PO approver eligibility: u-a may approve up to 10 000, u-b up to 1 000 000,
// u-c holds the tick but is not on the PO approvers list.
const CEILING: Record<string, { isApprover: boolean; approvalCeiling: number }> = {
  'u-a': { isApprover: true, approvalCeiling: 10_000 },
  'u-b': { isApprover: true, approvalCeiling: 1_000_000 },
  'u-c': { isApprover: false, approvalCeiling: 1_000_000 },
};
vi.mock('../../purchase-orders/service', () => ({
  loadApprovalContext: vi.fn(async (_tx: unknown, _c: string, id: string) => ({
    ...CEILING[id]!,
    isAdmin: false,
  })),
}));
vi.mock('../../access-control/users-with-right', () => ({
  listUsersWithRight: vi.fn(async () => [
    { id: 'u-a', name: 'Asha', isAdmin: false, role: 'manager' },
    { id: 'u-b', name: 'Bharat', isAdmin: false, role: 'manager' },
    { id: 'u-c', name: 'Chetan', isAdmin: false, role: 'manager' },
  ]),
}));

const lists = await import('./lists');
const notes = await import('./notifications');
const blocks = await import('./blocks');
const util = await import('./util');
const purchase = await import('./rows-purchase');

const keys = (a: Dash) => lists.visibleListDefs(a).map((d) => d.key);

const render = (q: ReturnType<typeof sql>) => new PgDialect().sqlToQuery(q);
const ctx = { cid: 'c1', today: '2026-10-22', myName: 'Jinal' };

describe('review fixes', () => {
  it('CAPA: a login with no name matches no CAPA', () => {
    const q = render(lists.listDef('capa_mine')!.query({ ...ctx, myName: '' }, {}));
    expect(q.sql).toMatch(/AND btrim\(\$\d+\) <> ''/);
    expect(q.params).toContain('');
  });

  it('Sent for approval PRs = NOT the pr_to_po "past approval" rule — one predicate', () => {
    const past = render(sql`${purchase.prPastApprovalSql('c1')}`).sql;
    const toPo = render(lists.listDef('pr_to_po')!.query(ctx, {})).sql;
    const pending = render(lists.APPROVAL_DEFS.pr_pending.query(ctx, {})).sql;
    const norm = (t: string) => t.replace(/\$\d+/g, '$');
    expect(norm(toPo)).toContain(norm(past));
    expect(norm(pending)).toContain(`AND pr.status = 'open' AND NOT ${norm(past)}`);
  });

  it('draft PO: "with" names and remind follow the approval inbox eligibility', async () => {
    const holders = blocks.makeHolders({} as never, 'c1');
    const small = await holders.poApproversFor(5_000);
    expect(small.map((h) => h.id)).toEqual(['u-a', 'u-b']); // u-c not on the approvers list
    const big = await holders.poApproversFor(50_000);
    expect(big.map((h) => h.id)).toEqual(['u-b']); // over u-a's ceiling
    expect(blocks.withText(big, 'me')).toBe('with Bharat');
    const none = await holders.poApproversFor(5_000_000);
    expect(blocks.withText(none, 'me')).toBe('with an admin');
    expect(
      blocks.remindAction(none, 'me', { type: 't', id: 'x', display: 'd', navPage: '/p' }),
    ).toBeNull();
  });

  it('JobCard QC: only accepted > 0 from the op-entry writer, worded with the qty', () => {
    const op = dash({ departments: { production: 'L2' } });
    const rules = notes.rulesFor(op);
    const qc = { entity: 'JobCard', action: 'QC', refId: 'IN-JC-1' };
    const got = notes.candidates(
      [
        ev({ id: 'ok', ...qc, qty: 20, opRef: 'Op 20 · Turning' }),
        ev({ id: 'zero', ...qc, qty: 0, opRef: 'Op 20 · Turning' }),
        ev({ id: 'nc-final', ...qc, qty: 5, opRef: null }), // NC recovery Final Inspection
      ],
      rules,
      'me',
    );
    expect(got.map((g) => g.ev.id)).toEqual(['ok']);
    expect(notes.noteLead(got[0]!.ev, got[0]!.rule)).toBe('Rakesh accepted 20 on ');
    expect(got[0]!.rule.tail).toBe(' — next op can start');
  });

  it('scope Mine: every list query filters on its own created-by column', () => {
    for (const d of lists.LIST_DEFS) {
      const all = render(d.query(ctx, {})).sql;
      const mine = render(d.query(ctx, { createdBy: 'me' }));
      if (d.key === 'capa_mine') {
        expect(mine.sql).toBe(all); // already the caller's own (Responsible)
        continue;
      }
      expect(mine.sql).toMatch(/created_by = \$\d+::uuid/);
      expect(mine.params).toContain('me');
    }
  });

  it('ops_running: elapsed label, late once over the expected time, open only', () => {
    expect(util.runningStatus(130, false)).toEqual({ statusLabel: 'running 2h 10m', tone: 'ok' });
    expect(util.runningStatus(45, true)).toEqual({ statusLabel: 'running 45m', tone: 'late' });
    const a = dash({ departments: { production: 'L2' } });
    expect(keys(a)).toContain('ops_running');
    const d = lists.listDef('ops_running')!;
    const row = lists.toDashRow(
      d,
      raw({ x1: '130', x2: '2', x3: 'Turning', isLate: true }),
      rowCtx(a),
    );
    expect(row).toMatchObject({ statusLabel: 'running 2h 10m', tone: 'late' });
    expect(row.actions.map((x) => x.kind)).toEqual(['open']);
    expect(row.docHref).toBe(`/job-cards/${raw().id}`);
  });
});
