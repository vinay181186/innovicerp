// ADR-250 — the per-person home's rules, without a database. Run via
// `pnpm --filter @innovic/api test:unit`.

import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { type Dash, dash, ev, perms, raw, rowCtx } from './test-fixtures';

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
    { id: 'u-a', name: 'Asha', isAdmin: false, role: 'manager', opensTaskBoard: true },
    { id: 'u-b', name: 'Bharat', isAdmin: false, role: 'manager', opensTaskBoard: true },
    { id: 'u-c', name: 'Chetan', isAdmin: false, role: 'manager', opensTaskBoard: true },
  ]),
}));

const lists = await import('./lists');
const { orderByDept, resolveMainDept } = await import('./main-dept');
const notes = await import('./notifications');
const blocks = await import('./blocks');
const util = await import('./util');
const { buildCues } = await import('./summary');

const keys = (a: Dash) => lists.visibleListDefs(a).map((d) => d.key);

describe('list gating per tier', () => {
  it('L1 Viewer: look-only lists, no create action', () => {
    const a = dash({ departments: { purchase: 'L1' } });
    expect(keys(a)).toContain('po_overdue');
    expect(keys(a)).not.toContain('pr_to_po');
    expect(keys(a)).not.toContain('po_to_dc');
    const d = lists.listDef('po_overdue')!;
    const row = lists.toDashRow(d, raw(), rowCtx(a));
    expect(row.actions.map((x) => x.kind)).toEqual(['open']);
    expect(row.amount).toBeNull(); // no price right
  });

  it('L4 Approver: approvals block, but no Entry list', () => {
    const a = dash({ departments: { purchase: 'L4' } });
    expect(lists.holdsAnyApprove(a)).toBe(true);
    expect(keys(a)).not.toContain('pr_to_po');
    expect(keys(a)).toContain('po_overdue');
  });

  it('L2 Entry gets the create list and its create link', () => {
    const a = dash({ departments: { purchase: 'L2' } });
    expect(keys(a)).toEqual(expect.arrayContaining(['pr_to_po', 'po_to_dc', 'po_overdue']));
    const row = lists.toDashRow(lists.listDef('pr_to_po')!, raw(), rowCtx(a, ['pr_create']));
    expect(row.actions).toEqual([
      expect.objectContaining({
        kind: 'create',
        href: `/purchase-orders/from-pr?prId=${raw().id}`,
      }),
    ]);
    expect(row.amount).toBe(5000);
  });

  it('a per-page "No create" removes the list', () => {
    const a = dash({
      departments: { purchase: 'L3' },
      forms: { po_create: perms({ entryOff: true }) },
    });
    expect(keys(a)).not.toContain('pr_to_po');
    expect(keys(a)).toContain('po_overdue');
  });

  it('a per-page Hide removes the link to that page', () => {
    const qc = dash({ departments: { qc: 'L2' } });
    const d = lists.listDef('grn_qc')!;
    const party = raw({ kind: 'party_grn', code: 'IN-PGRN-1' });
    // ADR-251: Party GRN and Against-PO calls are inspected on Incoming QC.
    expect(lists.toDashRow(d, party, rowCtx(qc)).actions.map((x) => x.href)).toEqual([
      '/incoming-qc?search=IN-PGRN-1',
    ]);
    const osp = raw({ kind: 'job_work_return', x1: 'line-2' });
    expect(lists.toDashRow(d, osp, rowCtx(qc)).actions.map((x) => x.href)).toEqual([
      '/qc-call-register?line=line-2',
    ]);
    // QC Call Register hidden: the OSP-return Inspect goes, Incoming QC's stay.
    const hidden = dash({
      departments: { qc: 'L2' },
      forms: { qc_submit: perms({ viewOff: true }) },
    });
    expect(lists.toDashRow(d, osp, rowCtx(hidden)).actions).toEqual([]);
    expect(lists.toDashRow(d, party, rowCtx(hidden)).actions.map((x) => x.href)).toEqual([
      '/incoming-qc?search=IN-PGRN-1',
    ]);
    const grn = raw({ kind: 'purchase', x1: 'line-1' });
    expect(lists.toDashRow(d, grn, rowCtx(hidden)).actions.map((x) => x.href)).toEqual([
      '/incoming-qc?line=line-1',
    ]);
  });

  it('CAPA list needs CAPA edit AND NC Register view', () => {
    expect(keys(dash({ departments: { qc: 'L3' } }))).toContain('capa_mine');
    expect(keys(dash({ departments: { qc: 'L2' } }))).not.toContain('capa_mine');
  });

  it('admin sees every list', () => {
    expect(keys(dash({}, true))).toHaveLength(lists.LIST_DEFS.length);
  });

  it('a remind (no href) survives the link filter', () => {
    const a = dash({});
    const ref = {
      type: 'purchase_request',
      id: raw().id,
      display: 'IN-PR-1',
      navPage: '/purchase-requests/x',
    };
    const remind = blocks.remindAction(
      [{ id: 'u2', name: 'Jinal', isAdmin: false, role: 'manager', opensTaskBoard: true }],
      'me',
      ref,
    );
    expect(remind?.taskFor?.userId).toBe('u2');
    expect(lists.filterActions(a, [remind!])).toHaveLength(1);
    // Only admins hold it, or only the caller: nobody to remind.
    expect(
      blocks.remindAction(
        [{ id: 'u3', name: 'Admin', isAdmin: true, role: 'manager', opensTaskBoard: true }],
        'me',
        ref,
      ),
    ).toBeNull();
    expect(
      blocks.remindAction(
        [{ id: 'me', name: 'Me', isAdmin: false, role: 'manager', opensTaskBoard: true }],
        'me',
        ref,
      ),
    ).toBeNull();
    // ADR-257: skip a holder whose Task Board is hidden; remind the next one.
    const next = blocks.remindAction(
      [
        { id: 'u4', name: 'Hidden', isAdmin: false, role: 'manager', opensTaskBoard: false },
        { id: 'u5', name: 'Rakesh', isAdmin: false, role: 'manager', opensTaskBoard: true },
      ],
      'me',
      ref,
    );
    expect(next?.taskFor?.userId).toBe('u5');
  });
});

describe('main department', () => {
  it('stored main dept wins', () => {
    expect(resolveMainDept('qc', dash({ departments: { purchase: 'L5' } }))).toBe('qc');
  });
  it('else highest tier, ties by the fixed order', () => {
    expect(resolveMainDept(null, dash({ departments: { sales: 'L2', production: 'L3' } }))).toBe(
      'production',
    );
    expect(resolveMainDept(null, dash({ departments: { qc: 'L2', purchase: 'L2' } }))).toBe(
      'purchase',
    );
  });
  it('admin with no main dept: none (fixed order)', () => {
    expect(resolveMainDept(null, dash({}, true))).toBeNull();
    expect(resolveMainDept(null, dash({ fullAccess: true }))).toBeNull();
  });
  it('orders main dept first, then the fixed order', () => {
    const items = [{ dept: 'sales' }, { dept: 'production' }, { dept: 'purchase' }, { dept: 'qc' }];
    expect(orderByDept(items, 'production').map((i) => i.dept)).toEqual([
      'production',
      'purchase',
      'qc',
      'sales',
    ]);
    expect(orderByDept(items, null).map((i) => i.dept)).toEqual([
      'purchase',
      'qc',
      'production',
      'sales',
    ]);
  });
});

describe('notifications', () => {
  it('maps each event to its next-step right', () => {
    expect(notes.noteRuleFor('PurchaseRequest', 'CREATE')?.right).toEqual(['pr_create', 'approve']);
    expect(notes.noteRuleFor('PurchaseRequest', 'APPROVE')?.right).toEqual(['po_create', 'entry']);
    expect(notes.noteRuleFor('PurchaseOrder', 'APPROVE')?.right).toEqual(['ospdc_create', 'entry']);
    expect(notes.noteRuleFor('PartyGrn', 'CREATE')?.right).toEqual(['qc_incoming', 'entry']);
    expect(notes.noteRuleFor('GoodsReceiptNote', 'CREATE')?.right).toEqual([
      'qc_incoming',
      'entry',
    ]);
    expect(notes.noteRuleFor('SalesOrder', 'CREATE')?.right).toEqual(['plan_create', 'entry']);
    expect(notes.noteRuleFor('Plan', 'CREATE')?.right).toEqual(['prodorder_create', 'entry']);
    expect(notes.noteRuleFor('JobCard', 'QC')?.right).toEqual(['op_entry', 'entry']);
    expect(notes.noteRuleFor('SalesOrder', 'EDIT')).toBeUndefined();
  });

  it('Full Access / admin get none', () => {
    expect(notes.rulesFor(dash({}, true))).toEqual([]);
    expect(notes.rulesFor(dash({ fullAccess: true }))).toEqual([]);
  });

  it('only rules the caller holds; never their own activity', () => {
    const buyer = dash({ departments: { purchase: 'L2' } });
    const rules = notes.rulesFor(buyer);
    const got = notes.candidates(
      [
        ev({ id: 'a' }),
        ev({ id: 'b', userId: 'me' }),
        ev({ id: 'c', entity: 'GoodsReceiptNote', action: 'CREATE' }),
      ],
      rules,
      'me',
    );
    expect(got.map((g) => g.ev.id)).toEqual(['a']);
  });

  it('ADR-253 Route Card: approvers hear a card return to pending; the creator hears the decision', () => {
    const rc = { entity: 'RouteCard', refId: 'IN-RC-00009', entityId: 'rc1' };
    // Approver (planning L4): created, resubmitted (RC Status → Pending Approval) and restored.
    const approverRules = notes.rulesFor(dash({ departments: { planning: 'L4' } }));
    const forApprover = notes.candidates(
      [
        ev({ id: 'new', ...rc, action: 'CREATE' }),
        ev({ id: 'resent', ...rc, action: 'EDIT', toPending: true }),
        ev({ id: 'plain-edit', ...rc, action: 'EDIT', toPending: false }),
        ev({ id: 'restored', ...rc, action: 'RESTORE' }),
      ],
      approverRules,
      'me',
    );
    expect(forApprover.filter((g) => g.rule.open === 'approval_rc').map((g) => g.ev.id)).toEqual([
      'new',
      'resent',
      'restored',
    ]);

    // Creator with only View on Route Card Master: told of the reject (with its
    // reason) and of the approval.
    const viewerRules = notes.rulesFor(dash({ departments: { planning: 'L1' } }));
    const forCreator = notes.candidates(
      [
        ev({ id: 'rej', ...rc, action: 'REJECT', reason: 'Wrong machine' }),
        ev({ id: 'ok', ...rc, action: 'APPROVE' }),
      ],
      viewerRules,
      'me',
    );
    const rej = forCreator.find((g) => g.ev.id === 'rej')!;
    expect(rej.rule.open).toBe('raiser_rc');
    expect(rej.rule.withReason).toBe(true);
    expect(rej.ev.reason).toBe('Wrong machine');
    expect(forCreator.find((g) => g.ev.id === 'ok')!.rule.open).toBe('raiser_rc_approved');
  });
});

describe('seen time', () => {
  it('one statement, never moves back, never past now', () => {
    const q = new PgDialect().sqlToQuery(notes.markSeenSql('c1', 'u1', '2026-10-22T10:00:00Z'));
    expect(q.sql).toMatch(/INSERT INTO public\.user_ui_settings/);
    expect(q.sql).toMatch(
      /ON CONFLICT \(company_id, user_id, setting_key\) WHERE deleted_at IS NULL/,
    );
    expect(q.sql).toMatch(
      /GREATEST\(user_ui_settings\.setting_value::timestamptz,\s+excluded\.setting_value::timestamptz\)/,
    );
    expect(q.sql).toMatch(/LEAST\(\$\d+::timestamptz, now\(\)\)/);
    expect(q.sql.split(';')).toHaveLength(1);
    expect(q.params).toContain('notifications_seen_at');
  });
});

describe('India-time days', () => {
  it('23:50 IST is still today; 00:01 IST is tomorrow', () => {
    expect(util.istDateOf(Date.UTC(2026, 9, 22, 18, 20))).toBe('2026-10-22');
    expect(util.istDateOf(Date.UTC(2026, 9, 22, 18, 31))).toBe('2026-10-23');
  });
  it('task buckets', () => {
    expect(blocks.taskBucket('2026-10-21', '2026-10-22')).toBe('late');
    expect(blocks.taskBucket('2026-10-22', '2026-10-22')).toBe('today');
    expect(blocks.taskBucket('2026-10-23', '2026-10-22')).toBe('planned');
    expect(blocks.taskBucket(null, '2026-10-22')).toBe('planned');
  });
  it('status cell', () => {
    expect(util.statusFor('2026-10-21', null, '2026-10-22')).toEqual({
      statusLabel: '1 day late',
      tone: 'late',
    });
    expect(util.statusFor('2026-10-22', null, '2026-10-22').tone).toBe('due');
    expect(util.statusFor('2026-10-25', null, '2026-10-22')).toEqual({
      statusLabel: 'due 25-Oct',
      tone: 'ok',
    });
    expect(util.statusFor(null, '2026-10-16', '2026-10-22').statusLabel).toBe('6 days');
  });
});

describe('text parts', () => {
  it('done row: the document number becomes a code part', () => {
    expect(blocks.doneText('IN-PR-1 approved by Jinal', 'IN-PR-1', '/purchase-requests/x')).toEqual(
      [{ code: 'IN-PR-1', href: '/purchase-requests/x' }, { text: ' approved by Jinal' }],
    );
    expect(blocks.doneText('x', 'IN-Z-1', null)).toEqual([{ text: 'IN-Z-1' }, { text: ' — x' }]);
  });
  it('"with" names skip admins and the caller', () => {
    expect(blocks.withText([], 'me')).toBe('with an admin');
    expect(
      blocks.withText(
        [
          { id: 'a', name: 'A', isAdmin: false, role: 'manager', opensTaskBoard: true },
          { id: 'me', name: 'Me', isAdmin: false, role: 'manager', opensTaskBoard: true },
        ],
        'me',
      ),
    ).toBe('with A');
  });
});

describe('cues', () => {
  it('a cue count is its list total', () => {
    const list = {
      key: 'pr_to_po' as const,
      title: 'PRs to order',
      dept: 'purchase',
      head: ['a', 'b', 'c', 'd'] as [string, string, string, string],
      total: 40,
      rows: [],
      href: '/purchase-requests',
    };
    const cues = buildCues([{ list, lateTotal: 3 }], null, 2, 5);
    expect(cues[0]).toMatchObject({ key: 'pr_to_po', count: 40, tone: 'late', sub: '3 late' });
    expect(cues.find((c) => c.key === 'waiting')?.count).toBe(2);
    expect(cues.find((c) => c.key === 'done_today')?.count).toBe(5);
  });
});
