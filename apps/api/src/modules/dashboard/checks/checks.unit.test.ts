// ADR-264 — department checks without a database: who sees which check, the
// IST week / month windows, row and check colours. Run via
// `pnpm --filter @innovic/api test:unit`.

import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dash, perms, raw } from '../personal/test-fixtures';

vi.mock('../../../db/client', () => ({ db: {} }));
vi.mock('../../access-control/service', () => ({ getMyAccess: vi.fn() }));
vi.mock('../../purchase-requests/service', () => ({ orderedQtySql: () => sql`0` }));
vi.mock('../../party-grn/service', () => ({ partyCommittedQtySql: () => sql`0` }));
// service.ts logs a failing check; the real logger reads env.ts, which exits
// without a database env — the unit config runs with none.
vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

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
    expect(k).toEqual(['sales_overdue', 'sales_due_week', 'sales_due_month', 'sales_so_draft']);
    expect(k.some((x) => x.startsWith('pur_'))).toBe(false);
  });

  it('the department tier decides, not the View-all page', () => {
    // Production tier alone: every Production check shows, including the
    // plan checks whose View-all page (Plans) is a Planning page — the web
    // renders that link as plain text.
    const prodKeys = svc.CHECK_DEFS.filter((d) => d.dept === 'production').map((d) => d.key);
    expect(keys(dash({ departments: { production: 'L3' } }))).toEqual(prodKeys);
    // A per-page Hide on Production Orders does not remove its check either.
    expect(
      keys(
        dash({
          departments: { production: 'L3' },
          forms: { prodorder_create: perms({ viewOff: true }) },
        }),
      ),
    ).toEqual(prodKeys);
  });

  it('no tier in a department: none of its checks', () => {
    const k = keys(dash({ departments: { store: 'L1' } }));
    expect(k.length).toBeGreaterThan(0);
    expect(k.every((x) => x.startsWith('store_'))).toBe(true);
    expect(keys(dash({ departments: {} }))).toEqual([]);
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
      statusLabel: 'Due 30-10',
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

// ── ADR-264 phase 2 — every department ──

describe('phase 2 departments', () => {
  const deptOf = (key: string) => svc.CHECK_DEFS.find((d) => d.key === key)?.dept;

  it('every contract key has exactly one check, and nothing else', async () => {
    const { DASH_CHECK_KEYS } = await import('@innovic/shared');
    const mine = svc.CHECK_DEFS.map((d) => d.key);
    expect(new Set(mine).size).toBe(mine.length);
    expect([...mine].sort()).toEqual([...DASH_CHECK_KEYS].sort());
  });

  it('department blocks come out in menu order', async () => {
    const { DASH_CHECK_DEPTS } = await import('@innovic/shared');
    const all = svc.CHECK_DEFS.map((d) => ({
      key: d.key,
      dept: d.dept,
      count: 1,
      label: d.label,
      tone: 'ok' as const,
      head: d.head,
      rows: [],
      href: d.href,
    }));
    // Shuffled input — the blocks still follow DASH_CHECK_DEPTS.
    const out = svc.toDeptBlocks([...all].reverse());
    expect(out.depts.map((b) => b.dept)).toEqual([...DASH_CHECK_DEPTS]);
    expect([...DASH_CHECK_DEPTS]).toEqual([
      'sales',
      'design',
      'planning',
      'production',
      'purchase',
      'store',
      'qc',
      'finance',
    ]);
  });

  it('a QC-only user sees only QC checks; finance-only only finance', () => {
    const qc = keys(dash({ departments: { qc: 'L2' } }));
    expect(qc.length).toBe(8);
    expect(qc.every((k) => deptOf(k) === 'qc')).toBe(true);
    const fin = keys(dash({ departments: { finance: 'L1' } }));
    expect(fin).toEqual(['fin_jw_not_invoiced', 'fin_invoice_overdue']);
    const des = keys(dash({ departments: { design: 'L1' } }));
    expect(des).toEqual([
      'des_bom_pending',
      'des_projects',
      'des_tracker',
      'des_issues',
      'des_dcr',
    ]);
  });

  it('prod_rc_pending moved to Planning, after plan_rc_approval', () => {
    expect(deptOf('prod_rc_pending')).toBe('planning');
    const plan = keys(dash({ departments: { planning: 'L1' } }));
    expect(plan).toEqual(['plan_so_unplanned', 'plan_rc_approval', 'prod_rc_pending']);
    expect(keys(dash({ departments: { production: 'L3' } }))).not.toContain('prod_rc_pending');
  });

  it('store_party_qc is gone; its rows are QC incoming', () => {
    expect(svc.CHECK_DEFS.some((d) => (d.key as string) === 'store_party_qc')).toBe(false);
    expect(deptOf('qc_incoming')).toBe('qc');
    expect(keys(dash({ departments: { store: 'L1' } }))).toEqual([
      'store_jwso_grn',
      'store_po_grn',
      'store_po_dc',
      'store_tools_out',
      'store_count_approval',
    ]);
  });

  it('every check has a View-all page and a document link', () => {
    for (const d of svc.CHECK_DEFS) {
      expect(d.href.startsWith('/')).toBe(true);
      expect(d.docHref(raw({ x1: 'x', x2: 'y' })).startsWith('/')).toBe(true);
    }
  });
});

describe('money checks', () => {
  const inv = () => svc.CHECK_DEFS.find((d) => d.key === 'fin_invoice_overdue')!;
  const res = {
    rows: [raw({ qty: 12500, uom: '₹', dueDate: '2026-10-01', isLate: true })],
    total: 1,
    lateTotal: 1,
    dueTodayTotal: 0,
  };
  const c = { cid: 'c1', today: '2026-10-27' };
  const run = async () => res;

  it('fin_invoice_overdue is priced on Invoices', () => {
    expect(inv().priceForm).toBe('invoice_create');
  });

  it('a caller without the Price right gets qty null; with it, the balance', async () => {
    const noPrice = dash({
      departments: { finance: 'L1' },
      forms: { invoice_create: perms({ view: true, price: false }) },
    });
    const withPrice = dash({
      departments: { finance: 'L1' },
      forms: { invoice_create: perms({ view: true, price: true }) },
    });
    const hidden = await svc.buildChecks([inv()], c, noPrice, run);
    expect(hidden[0]!.rows[0]!.qty).toBeNull();
    expect(hidden[0]!.rows[0]!.uom).toBeNull();
    expect(hidden[0]!.count).toBe(1);
    const shown = await svc.buildChecks([inv()], c, withPrice, run);
    expect(shown[0]!.rows[0]!.qty).toBe(12500);
    const admin = await svc.buildChecks([inv()], c, dash({}, true), run);
    expect(admin[0]!.rows[0]!.qty).toBe(12500);
  });

  it('a check with no priceForm is never masked', () => {
    const plain = svc.CHECK_DEFS.find((d) => d.key === 'pur_po_overdue')!;
    expect(t.toCheck(plain, res, '2026-10-27', false).rows[0]!.qty).toBe(12500);
    expect(t.toCheck(inv(), res, '2026-10-27', false).rows[0]!.qty).toBeNull();
  });
});

describe('one transaction per check, guarded', () => {
  const c = { cid: 'c1', today: '2026-10-27' };
  const ok = { rows: [raw()], total: 1, lateTotal: 0, dueTodayTotal: 0 };

  it('a failing check is dropped; the others still build, in registry order', async () => {
    const defs = svc.CHECK_DEFS.filter((d) =>
      ['sales_overdue', 'sales_due_week', 'sales_due_month'].includes(d.key),
    );
    const ran: string[] = [];
    const out = await svc.buildChecks(defs, c, dash({}, true), async (d) => {
      ran.push(d.key);
      if (d.key === 'sales_due_week') throw new Error('boom');
      return ok;
    });
    expect(ran).toHaveLength(3);
    expect(out.map((x) => x.key)).toEqual(['sales_overdue', 'sales_due_month']);
  });

  it('a check whose query cannot even be built is dropped too', async () => {
    const bad = {
      ...svc.CHECK_DEFS[0]!,
      query: () => {
        throw new Error('bad def');
      },
    };
    const out = await svc.buildChecks([bad], c, dash({}, true), async (d) => {
      d.query(c);
      return ok;
    });
    expect(out).toEqual([]);
  });

  it('runs at most 4 checks at once', async () => {
    let live = 0;
    let peak = 0;
    await svc.buildChecks(svc.CHECK_DEFS, c, dash({}, true), async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
      return ok;
    });
    expect(peak).toBe(4);
  });
});

describe('phase 2 fragments render', () => {
  const c = { cid: 'c1', today: '2026-10-27' };
  const find = (key: string) => svc.CHECK_DEFS.find((d) => d.key === key)!;

  it('every check query renders, with the list columns', () => {
    for (const d of svc.CHECK_DEFS) {
      const q = render(d.query(c)).sql;
      for (const col of ['row_key', 'is_late', 'x3']) expect(q).toContain(col);
      expect(q).not.toContain('CURRENT_DATE');
    }
  });

  it('pur_osp_no_pr: no live PR (either link), no PO line, op not complete', async () => {
    const { ospOpsNoPrSql } = await import('./purchase');
    const q = render(ospOpsNoPrSql(c)).sql;
    expect(q).toContain('"purchase_requests"."source_jc_op_id" = "o".id');
    expect(q).toContain(`"purchase_requests"."pr_type" = 'jw_osp'`);
    expect(q).toContain('"purchase_requests"."id" = "o".outsource_pr_id');
    expect(q).toContain('public.jc_op_po_lines');
    expect(q).toContain('o_pl.outsource_po_line_id IS NOT NULL');
    expect(q).toContain("vs.computed_status <> 'complete'");
    expect(q).toContain('jc.closed_at IS NULL');
    expect(q).toContain('AND NOT (');
  });

  it('qc_incoming lists only the Incoming QC GRN Types (Direct Purchase + Party GRN)', () => {
    const q = render(find('qc_incoming').query(c));
    expect(q.sql).toContain('x.kind = ANY(');
    expect(q.params).toContainEqual(['purchase', 'party_grn']);
  });

  it('qc_calibration has the same 7-day window as AL-020 / the register', async () => {
    const { calibrationDueSql, CALIBRATION_LEAD_DAYS } = await import('../../instruments/common');
    expect(CALIBRATION_LEAD_DAYS).toBe(7);
    expect(find('qc_calibration').label).toBe('Instrument calibration due (next 7 days)');
    const q = render(find('qc_calibration').query(c)).sql;
    expect(q).toContain('.calibration_due_on <= ($');
    expect(q).toContain(') + 7');
    expect(render(calibrationDueSql(sql`x`, 'overdue')).sql).toContain('calibration_due_on < x');
  });

  it('qc_inprocess / qc_final split on the last live op', async () => {
    const qc = await import('./qc');
    expect(render(qc.qcInprocessSql(c)).sql).toContain('AND NOT (vos.op_seq');
    expect(render(qc.qcFinalSql(c)).sql).not.toContain('AND NOT (vos.op_seq');
    expect(render(qc.qcTpiSql(c)).sql).toContain(`LIKE '%TPI%'`);
  });

  it('invoice overdue = the strip rule alone; qty = balance', async () => {
    const { invoiceOverdueCheckSql } = await import('./finance');
    const q = render(invoiceOverdueCheckSql(c));
    expect(q.params).toContain('2026-10-27');
    expect(q.sql).toContain('"inv".grand_total - "inv".total_paid - "inv".total_tds');
    expect(q.sql).not.toContain('b.balance > 0');
  });
});

// ── Fast path: every visible check in ONE statement ──

describe('fast path', () => {
  const c = { cid: 'c1', today: '2026-10-27' };
  beforeEach(() => svc.resetCheckQuarantine());
  const summary = {
    total: 3,
    late: 1,
    dueToday: 1,
    rows: [
      {
        row_key: 'l1',
        id: 'so-1',
        code: 'SO-1',
        kind: 'so',
        doc_date: '2026-10-01',
        due_date: '2026-10-20',
        sort_key: '2026-10-20',
        party: 'Acme',
        item_code: 'ITM-1',
        item_name: 'Shaft',
        qty: 12.5,
        uom: 'NOS',
        amount: null,
        created_by: 'u1',
        is_late: 1,
        x1: 'CPO-9',
        x2: null,
        x3: null,
      },
      { row_key: 'l2', id: 'so-2', code: 'SO-2', due_date: '2026-10-27', qty: '4', is_late: 0 },
    ],
  };

  it('builds ONE statement naming every visible check key', () => {
    const defs = svc.visibleChecks(dash({}, true));
    const q = render(svc.fastChecksSql(defs, c));
    expect(q.sql.startsWith('SELECT jsonb_build_object(')).toBe(true);
    for (const d of defs) expect(q.params).toContain(d.key);
    // Each key appears once, as its own `::text` key param.
    expect(q.sql.match(/::text, \(WITH x AS/g)).toHaveLength(defs.length);
    // 40 checks at most per jsonb_build_object (100-argument limit).
    expect(q.sql.split('jsonb_build_object(').length - 1).toBe(Math.ceil(defs.length / 40));
    // Late first, then oldest — the one ordering, inside every check.
    expect(q.sql).toContain('r.is_late DESC, r.sort_key ASC NULLS LAST, r.code ASC, r.row_key ASC');
  });

  it('only the caller’s visible keys go into the statement', () => {
    const defs = svc.visibleChecks(dash({ departments: { finance: 'L1' } }));
    const q = render(svc.fastChecksSql(defs, c));
    expect(q.params).toContain('fin_invoice_overdue');
    expect(q.params).not.toContain('sales_overdue');
  });

  it('runCheck and the fast path read the same summary into the same checks', async () => {
    const defs = svc.CHECK_DEFS.filter((d) =>
      ['sales_overdue', 'fin_invoice_overdue'].includes(d.key),
    );
    const a = dash({}, true);
    const viaFast = await svc.loadChecks(defs, c, a, {
      fast: async () => Object.fromEntries(defs.map((d) => [d.key, summary])),
      one: async () => {
        throw new Error('must not run');
      },
    });
    const fakeTx = { execute: async () => [{ j: JSON.stringify(summary) }] };
    const viaOne = await svc.buildChecks(defs, c, a, (d) =>
      t.runCheck(fakeTx as never, d.query(c), c.today),
    );
    expect(viaFast).toEqual(viaOne);
    expect(viaFast[0]!.count).toBe(3);
    expect(viaFast[0]!.tone).toBe('late');
    expect(viaFast[0]!.rows.map((r) => r.qty)).toEqual([12.5, 4]);
  });

  it('when the single statement throws: logged once, then every check runs alone', async () => {
    const { logger } = await import('../../../lib/logger');
    vi.mocked(logger.error).mockClear();
    const defs = svc.CHECK_DEFS.filter((d) =>
      ['sales_overdue', 'sales_due_week', 'sales_due_month'].includes(d.key),
    );
    const ran: string[] = [];
    const out = await svc.loadChecks(defs, c, dash({}, true), {
      fast: async () => {
        throw new Error('one broken check');
      },
      one: async (d) => {
        ran.push(d.key);
        if (d.key === 'sales_due_week') throw new Error('this one is broken');
        return t.parseCheckSummary(summary);
      },
    });
    expect(ran).toHaveLength(3);
    expect(out.map((x) => x.key)).toEqual(['sales_overdue', 'sales_due_month']);
    const msgs = vi.mocked(logger.error).mock.calls.map((x) => x[1]);
    expect(msgs.filter((m) => m === 'dashboard checks fast path failed')).toHaveLength(1);
    expect(msgs.filter((m) => m === 'dashboard check failed')).toHaveLength(1);
  });

  it('a check whose SQL cannot be built sends the request down the fallback', async () => {
    const bad = {
      ...svc.CHECK_DEFS[0]!,
      query: () => {
        throw new Error('bad def');
      },
    };
    const good = svc.CHECK_DEFS[1]!;
    const out = await svc.loadChecks([bad, good], c, dash({}, true), {
      fast: async (defs) => {
        svc.fastChecksSql(defs, c);
        return {};
      },
      one: async (d) => {
        d.query(c);
        return t.parseCheckSummary(summary);
      },
    });
    expect(out.map((x) => x.key)).toEqual([good.key]);
  });

  it('a summary that is not one never reads as 0', () => {
    expect(() => t.parseCheckSummary(undefined)).toThrow();
    expect(() => t.parseCheckSummary({ total: 0 })).toThrow();
    expect(t.parseCheckSummary({ total: 0, late: 0, dueToday: 0, rows: [] }).total).toBe(0);
  });

  it('runCheck sends one statement: the shared summary over the check', async () => {
    const seen: string[] = [];
    const fakeTx = {
      execute: async (q: ReturnType<typeof sql>) => {
        seen.push(render(q).sql);
        return [{ j: summary }];
      },
    };
    await t.runCheck(fakeTx as never, sql`SELECT 1`, c.today);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('(WITH x AS (SELECT 1)');
    expect(seen[0]).toContain("'dueToday'");
  });

  it('a missing / malformed key in a good fast result is retried alone, dropped only if that fails', async () => {
    const defs = svc.CHECK_DEFS.filter((d) =>
      ['sales_overdue', 'sales_due_week', 'sales_due_month'].includes(d.key),
    );
    const ran: string[] = [];
    const out = await svc.loadChecks(defs, c, dash({}, true), {
      // sales_due_week missing, sales_due_month malformed.
      fast: async () => ({ sales_overdue: summary, sales_due_month: { total: 2 } }),
      one: async (d) => {
        ran.push(d.key);
        if (d.key === 'sales_due_month') throw new Error('still broken alone');
        return t.parseCheckSummary(summary);
      },
    });
    expect(ran.sort()).toEqual(['sales_due_month', 'sales_due_week']);
    expect(out.map((x) => x.key)).toEqual(['sales_overdue', 'sales_due_week']);
  });

  it('a check broken alone is remembered 10 min: kept out of the fast statement, run alone, logged once', async () => {
    const { logger } = await import('../../../lib/logger');
    const defs = svc.CHECK_DEFS.filter((d) =>
      ['sales_overdue', 'sales_due_week', 'sales_due_month'].includes(d.key),
    );
    const t0 = 1_000_000;
    const fastSaw: string[][] = [];
    const aloneSaw: string[][] = [];
    const readers = (fastFails: boolean) => {
      const solo: string[] = [];
      aloneSaw.push(solo);
      return {
        fast: async (fd: readonly { key: string }[]) => {
          fastSaw.push(fd.map((d) => d.key));
          if (fastFails) throw new Error('big statement failed');
          return Object.fromEntries(fd.map((d) => [d.key, summary]));
        },
        one: async (d: { key: string }) => {
          solo.push(d.key);
          if (d.key === 'sales_due_week') throw new Error('broken check');
          return t.parseCheckSummary(summary);
        },
      };
    };
    const failLogs = () =>
      vi.mocked(logger.error).mock.calls.filter((x) => x[1] === 'dashboard check failed').length;
    vi.mocked(logger.error).mockClear();

    // 1st request: the big statement fails, every check runs alone, the broken
    // one is logged and remembered.
    await svc.loadChecks(defs, c, dash({}, true), readers(true) as never, t0);
    expect(fastSaw[0]).toHaveLength(3);
    expect(failLogs()).toBe(1);

    // 5 min later: it is left out of the fast statement and runs alone; the
    // others come from the fast statement. Not logged again.
    const out = await svc.loadChecks(
      defs,
      c,
      dash({}, true),
      readers(false) as never,
      t0 + 5 * 60_000,
    );
    expect(fastSaw[1]).toEqual(['sales_overdue', 'sales_due_month']);
    expect(aloneSaw[1]).toEqual(['sales_due_week']);
    expect(out.map((x) => x.key)).toEqual(['sales_overdue', 'sales_due_month']);
    expect(failLogs()).toBe(1);

    // After the 10-minute window it rejoins the fast statement.
    await svc.loadChecks(defs, c, dash({}, true), readers(false) as never, t0 + 11 * 60_000);
    expect(fastSaw[2]).toHaveLength(3);
    expect(aloneSaw[2]).toEqual([]);
  });

  it('a remembered check that works alone is still shown', async () => {
    const defs = svc.CHECK_DEFS.filter((d) => ['sales_overdue', 'sales_due_week'].includes(d.key));
    let broken = true;
    const readers = {
      fast: async () => {
        throw new Error('big statement failed');
      },
      one: async (d: { key: string }) => {
        if (broken && d.key === 'sales_due_week') throw new Error('broken');
        return t.parseCheckSummary(summary);
      },
    };
    await svc.loadChecks(defs, c, dash({}, true), readers as never, 0);
    broken = false;
    const out = await svc.loadChecks(defs, c, dash({}, true), readers as never, 60_000);
    expect(out.map((x) => x.key)).toEqual(['sales_overdue', 'sales_due_week']);
  });
});
