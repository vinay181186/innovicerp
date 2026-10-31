// ADR-262 — department checks without a database: who sees which check, the
// IST week / month windows, row and check colours. Run via
// `pnpm --filter @innovic/api test:unit`.

import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { dash, perms, raw } from '../personal/test-fixtures';

vi.mock('../../../db/client', () => ({ db: {} }));
vi.mock('../../access-control/service', () => ({ getMyAccess: vi.fn() }));
vi.mock('../../purchase-requests/service', () => ({ orderedQtySql: () => sql`0` }));
vi.mock('../../party-grn/service', () => ({ partyCommittedQtySql: () => sql`0` }));

const svc = await import('./service');
const t = await import('./types');
const { salesLinesSql } = await import('./sales');

const keys = (a: ReturnType<typeof dash>) => svc.visibleChecks(a).map((d) => d.key);
const render = (q: ReturnType<typeof sql>) => new PgDialect().sqlToQuery(q);

describe('check access', () => {
  it('admin sees every check', () => {
    expect(keys(dash({}, true))).toHaveLength(svc.CHECK_DEFS.length);
  });

  it('Full Access sees every check', () => {
    expect(keys(dash({ fullAccess: true }))).toHaveLength(svc.CHECK_DEFS.length);
  });

  it('a department with no tier is hidden', () => {
    const k = keys(dash({ departments: { sales: 'L1' } }));
    expect(k).toEqual(['sales_overdue', 'sales_due_week', 'sales_due_month']);
    expect(k.some((x) => x.startsWith('pur_'))).toBe(false);
  });

  it('a check is hidden when its View-all page does not open', () => {
    // Production tier alone: Production Orders opens, Plans (a Planning
    // page) does not — the plan checks stay hidden.
    expect(keys(dash({ departments: { production: 'L3' } }))).toEqual(['prod_due_week']);
    // A per-page Hide on Production Orders removes that check too.
    expect(
      keys(
        dash({
          departments: { production: 'L3' },
          forms: { prodorder_create: perms({ viewOff: true }) },
        }),
      ),
    ).toEqual([]);
  });

  it('planning + production tiers show the plan checks', () => {
    const k = keys(dash({ departments: { production: 'L3', planning: 'L3' } }));
    expect(k).toEqual(
      expect.arrayContaining([
        'prod_plans_available',
        'prod_plans_overdue',
        'prod_due_week',
        'prod_rc_pending',
        'plan_so_unplanned',
        'plan_rc_approval',
      ]),
    );
  });

  it('empty departments are omitted and totals add up', () => {
    const check = (key: string, dept: string, count: number) =>
      ({
        key,
        dept,
        count,
        label: '',
        tone: 'ok',
        head: ['', '', ''],
        rows: [],
        href: '',
      }) as never;
    const out = svc.toDeptBlocks([
      check('sales_overdue', 'sales', 2),
      check('sales_due_week', 'sales', 3),
      check('store_po_grn', 'store', 0),
    ]);
    expect(out.depts.map((d) => [d.dept, d.total])).toEqual([
      ['sales', 5],
      ['store', 0],
    ]);
  });
});

describe('IST windows', () => {
  it('week ends on Sunday (Monday-start), month on its last day', () => {
    expect(t.weekEnd('2026-10-27')).toBe('2026-11-01'); // Tuesday → Sunday
    expect(t.weekEnd('2026-11-01')).toBe('2026-11-01'); // Sunday → itself
    expect(t.weekEnd('2026-11-02')).toBe('2026-11-08'); // Monday
    expect(t.monthEnd('2026-10-31')).toBe('2026-10-31');
    expect(t.monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(t.monthEnd('2028-02-10')).toBe('2028-02-29');
  });

  it('week / month windows start today, so overdue lines are excluded', () => {
    const c = { cid: 'c1', today: '2026-10-27' };
    const week = render(salesLinesSql(c, 'week'));
    expect(week.sql).toContain('sol.due_date BETWEEN');
    expect(week.sql).toContain('jwl.due_date BETWEEN');
    expect(week.params).toEqual(expect.arrayContaining(['2026-10-27', '2026-11-01']));
    const month = render(salesLinesSql(c, 'month'));
    expect(month.params).toEqual(expect.arrayContaining(['2026-10-27', '2026-10-31']));
    const overdue = render(salesLinesSql(c, 'overdue'));
    expect(overdue.sql).toContain('sol.due_date <');
    expect(overdue.sql).not.toContain('BETWEEN');
  });

  it('pending = order − dispatched (SO) / order − returned (JWSO); cancelled and short-closed out', () => {
    const q = render(salesLinesSql({ cid: 'c1', today: '2026-10-27' }, 'overdue')).sql;
    expect(q).toContain('sol.order_qty > sol.dispatched_qty');
    expect(q).toContain('jwl.order_qty > jwl.returned_qty');
    expect(q).toContain('sol.short_closed_at IS NULL');
    expect(q).toContain("so.status = 'open'");
  });
});

describe('row and check colours', () => {
  const dated = { dated: true } as const;
  const today = '2026-10-27';

  it('late / due today / ok by the deadline', () => {
    expect(t.rowStatus(dated, raw({ dueDate: '2026-10-24', isLate: true }), today)).toEqual({
      statusLabel: '3 days late',
      tone: 'late',
    });
    expect(t.rowStatus(dated, raw({ dueDate: today }), today)).toEqual({
      statusLabel: 'Due today',
      tone: 'due',
    });
    expect(t.rowStatus(dated, raw({ dueDate: '2026-10-30' }), today)).toEqual({
      statusLabel: 'Due 30-Oct',
      tone: 'ok',
    });
  });

  it('an undated check reads the age of the document', () => {
    expect(
      t.rowStatus({ dated: false }, raw({ docDate: '2026-10-25', dueDate: today }), today),
    ).toEqual({ statusLabel: 'Waiting 2 days', tone: 'ok' });
  });

  it('fixed status words keep the date colour', () => {
    const d = { dated: true, statusText: () => 'No Route Card' };
    expect(t.rowStatus(d, raw({ dueDate: '2026-10-20', isLate: true }), today)).toEqual({
      statusLabel: 'No Route Card',
      tone: 'late',
    });
  });

  it('check tone: late beats due beats ok', () => {
    expect(t.checkTone(1, 5)).toBe('late');
    expect(t.checkTone(0, 2)).toBe('due');
    expect(t.checkTone(0, 0)).toBe('ok');
  });

  it('every check names its columns (no bare "Date")', () => {
    for (const d of svc.CHECK_DEFS) {
      expect(d.head[2]).not.toBe('Date');
      expect(d.head[2].length).toBeGreaterThan(4);
    }
  });
});
