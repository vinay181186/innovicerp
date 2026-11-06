// Owner rules 2-Nov-2026 — decision notes to the raiser, self-decisions,
// "material can be sent" only for a PO that sends material out, new-work
// notes gated by rights. No database: SQL is rendered, reads use a fake tx.
// Run via `pnpm --filter @innovic/api test:unit`.

import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { dash, ev, perms } from './test-fixtures';

vi.mock('../../../db/client', () => ({ db: {} }));
vi.mock('../../access-control/service', () => ({ getMyAccess: vi.fn() }));
vi.mock('../../purchase-requests/service', () => ({ orderedQtySql: () => sql`0` }));
const logError = vi.fn();
vi.mock('../../../lib/logger', () => ({ logger: { error: logError } }));

const notes = await import('./notifications');
const rules = await import('./note-rules');
const dec = await import('./decision-notes');
const work = await import('./work-notes');
const srcs = await import('./note-sources');

const render = (q: SQL) => new PgDialect().sqlToQuery(q);
const rule = (open: string) => notes.NOTE_RULES.find((r) => r.open === open)!;
const po = { entity: 'PurchaseOrder', refId: 'IN-PO-1', entityId: 'po1' };

const COMBINED = 'SELECT (SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.';

/** A tx whose execute answers by the table the statement reads; a nested
 *  transaction (savepoint) runs on the same fake. The combined note-source
 *  statement (note-sources.ts) is answered source by source like Postgres
 *  would: one JSON column per sub-select, and the whole statement fails when
 *  one sub-select does. `seen` = each source's text; `statements` = what was
 *  actually sent. */
const fakeTx = (answer: (text: string) => Array<Record<string, unknown>>) => {
  const seen: string[] = [];
  const statements: string[] = [];
  const tx = {
    execute: async (q: SQL) => {
      const text = render(q).sql;
      statements.push(text);
      if (text.startsWith(COMBINED)) {
        const pieces = text.split(/\) x\) AS s\d+/).slice(0, -1);
        seen.push(...pieces);
        const row: Record<string, unknown> = {};
        pieces.forEach((piece, i) => {
          row[`s${i}`] = answer(piece);
        });
        return [row];
      }
      seen.push(text);
      return answer(text);
    },
    transaction: async <T>(fn: (sp: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
  return { seen, statements, tx: tx as never };
};

describe('raiser-only decision notes (PO / PR / RC / Stock Count / Day Log)', () => {
  it('a PO rejection reaches only the raiser, not every po_create entry holder', () => {
    const buyer = dash({ forms: { po_create: perms({ view: true, entry: true }) } });
    const rejected = ev({ ...po, id: 'r1', action: 'REJECT', reason: 'Wrong rate' });
    // The activity read found po1 is NOT this caller's: no raiser rule key.
    const notMine = notes.candidates([{ ...rejected, ruleKeys: [] }], notes.rulesFor(buyer), 'me');
    expect(notMine).toEqual([]);
    // The raiser: the read matched the raiser rule.
    const mine = notes.candidates(
      [{ ...rejected, ruleKeys: [rules.ruleId(rule('raiser_po'))] }],
      notes.rulesFor(buyer),
      'me',
    );
    expect(mine.map((m) => m.rule.open)).toEqual(['raiser_po']);
    const text = notes.noteText(mine[0]!.ev, mine[0]!.rule, true);
    expect(text.map((p) => ('text' in p ? p.text : p.code)).join('')).toBe(
      'Rakesh rejected IN-PO-1 — your PO · Wrong rate',
    );
  });

  it('the raiser condition is the document creator = caller, and keeps own events', () => {
    const q = render(rules.ruleCond(rule('raiser_po'), 'c1', 'me'));
    expect(q.sql).toMatch(/FROM public\.purchase_orders rd/);
    expect(q.sql).toMatch(/rd\.created_by = \$\d+::uuid/);
    expect(q.sql).toMatch(/a\.changes @> \$\d+::jsonb/); // not a staged edit's REJECT
    expect(q.sql).not.toMatch(/a\.user_id <>/);
    expect(q.params).toContain('me');
    // A work rule skips the caller's own events.
    expect(render(rules.ruleCond(rule('pr_to_po'), 'c1', 'me')).sql).toMatch(/a\.user_id <>/);
    const dl = render(rules.ruleCond(rule('raiser_day_log'), 'c1', 'me')).sql;
    expect(dl).toMatch(/FROM public\.daily_reports rd/);
    expect(dl).toMatch(/rd\.user_id = /);
  });

  it('self-approval: the raiser who approved their own PO still gets the decision note', () => {
    const a = dash({ forms: { po_create: perms({ view: true, entry: true, approve: true }) } });
    const own = ev({
      ...po,
      id: 'a1',
      action: 'APPROVE',
      userId: 'me',
      actor: 'Me',
      ruleKeys: [rules.ruleId(rule('raiser_po_approved'))],
    });
    const got = notes.candidates([own], notes.rulesFor(a), 'me');
    expect(got.map((g) => g.key)).toEqual(['a1:raiser_po_approved']);
    // …but never a work note for one's own action.
    const ownCreate = ev({ ...po, id: 'c1', action: 'CREATE', userId: 'me' });
    expect(notes.candidates([ownCreate], notes.rulesFor(a), 'me')).toEqual([]);
  });

  it('decision notes need no department right (Day Log excepted: page hidden = none)', () => {
    const nobody = dash({});
    const opens = notes.rulesFor(nobody).map((r) => r.open);
    expect(opens).toEqual(
      expect.arrayContaining([
        'raiser_pr',
        'raiser_po',
        'raiser_po_approved',
        'raiser_rc',
        'raiser_rc_approved',
        'raiser_stock_count',
      ]),
    );
    expect(opens).not.toContain('raiser_day_log');
    expect(opens).not.toContain('pr_to_po');
  });

  it('the activity read: own events allowed only through raiser rules, one statement', () => {
    const q = render(
      notes.activityReadSql(notes.rulesFor(dash({}, true)), 'c1', 'me', sql`now()`, 300),
    );
    expect(q.sql).toMatch(/array_remove\(ARRAY\[/);
    expect(q.sql).toMatch(/cardinality\(k\.rule_keys\) > 0/);
    expect(q.sql).not.toMatch(/AND a\.user_id IS NOT NULL AND a\.user_id <>/);
    expect(q.sql.split(';')).toHaveLength(1);
  });
});

describe('"material can be sent" only for a PO that sends material out', () => {
  it('the rule reads the PO type (job work / service), never a plain material PO', () => {
    const q = render(rules.ruleCond(rule('po_to_dc'), 'c1', 'me'));
    expect(q.sql).toMatch(/spo\.po_type::text = ANY\(\$\d+::text\[\]\)/);
    const types = q.params.find((p) => Array.isArray(p)) as string[];
    expect(types.sort()).toEqual(['job_work', 'service']);
    expect(types).not.toContain('standard');
  });

  it('a standard PO approval (read gave no po_to_dc key) is no note for DC people', () => {
    const dcMan = dash({ forms: { ospdc_create: perms({ view: true, entry: true }) } });
    const approved = ev({ ...po, id: 'p1', action: 'APPROVE' });
    expect(notes.candidates([{ ...approved, ruleKeys: [] }], notes.rulesFor(dcMan), 'me')).toEqual(
      [],
    );
    const jw = notes.candidates(
      [{ ...approved, ruleKeys: [rules.ruleId(rule('po_to_dc'))] }],
      notes.rulesFor(dcMan),
      'me',
    );
    expect(jw.map((g) => g.rule.tail)).toEqual([' — material can be sent']);
  });
});

describe('new-work notes are gated by the next-step right', () => {
  it('NC raised → nc_dispose advance; RTV → ospdc_create entry; Stock Count → approve', () => {
    const opensOf = (forms: Record<string, ReturnType<typeof perms>>) =>
      notes.rulesFor(dash({ forms })).map((r) => r.open);
    expect(opensOf({ nc_dispose: perms({ view: true, advance: true }) })).toContain('nc_dispose');
    expect(opensOf({ nc_dispose: perms({ view: true, entry: true }) })).not.toContain('nc_dispose');
    expect(opensOf({ ospdc_create: perms({ view: true, entry: true }) })).toContain('nc_rtv_dc');
    expect(opensOf({ stockcount_create: perms({ view: true, approve: true }) })).toContain(
      'stock_count_approve',
    );
    expect(opensOf({ stockcount_create: perms({ view: true, entry: true }) })).not.toContain(
      'stock_count_approve',
    );
    expect(notes.noteRuleFor('NonConformance', 'DISPOSE')?.changesHas).toContain(
      'Return to Vendor',
    );
  });

  it('work notes: design reads only for the tick holder; a CAPA reaches its Responsible', async () => {
    const { tx, seen } = fakeTx((text) =>
      text.includes('capa_records')
        ? [
            {
              id: 'k1',
              code: 'CAPA-0012',
              project_id: null,
              actor: 'Rakesh',
              ts: '2026-11-01T05:00:00Z',
              open: true,
              mine: true,
            },
          ]
        : [],
    );
    const got = await srcs.readSources(tx, work.workSources(dash({}), 'c1', 'me', sql`now()`));
    expect(seen.some((s) => s.includes('design_issues'))).toBe(false);
    expect(seen.some((s) => s.includes('design_dcrs'))).toBe(false);
    expect(got.map((n) => n.key)).toEqual(['work:capa:k1']);
    expect(got[0]!.text.map((p) => ('text' in p ? p.text : p.code)).join('')).toBe(
      'Rakesh made you Responsible for CAPA-0012 — CAPA to work on',
    );
    // Without the CAPA Edit tick, an unassigned CAPA is not read for them.
    expect(seen[0]).not.toMatch(/OR NOT EXISTS \(SELECT 1 FROM public\.users ru/);
    const holder = fakeTx(() => []);
    await srcs.readSources(
      holder.tx,
      work.workSources(
        dash({ forms: { dsnissue_create: perms({ view: true, edit: true }) } }),
        'c1',
        'me',
        sql`now()`,
      ),
    );
    expect(holder.seen.some((s) => s.includes('design_issues'))).toBe(true);
  });
});

describe('edit / cancel / time-change decisions → requester AND creator', () => {
  const row = (over: Partial<Parameters<typeof dec.decisionNote>[0]> = {}) => ({
    kind: 'edit' as const,
    id: 'req1',
    status: 'approved' as const,
    docCode: 'IN-SO-00042',
    docHref: '/sales-orders/so1',
    approvedN: 2,
    totalN: 2,
    docLabel: null,
    requestedBy: 'asker',
    creator: 'creator',
    askerName: 'Parth',
    creatorName: 'Rakesh',
    decidedBy: 'boss',
    decider: 'Jinal',
    decidedAt: '2026-11-01T06:00:00.000Z',
    reason: null,
    oneStep: false,
    ...over,
  });
  const words = (n: ReturnType<typeof dec.decisionNote>) =>
    n!.text.map((p) => ('text' in p ? p.text : p.code)).join('');

  it('two different people: one note each; anyone else: none', () => {
    const forAsker = dec.decisionNote(row(), 'asker');
    const forCreator = dec.decisionNote(row(), 'creator');
    expect(forAsker!.key).toBe('dec:edit:req1:approved');
    expect(words(forAsker)).toBe('Jinal approved the edit of IN-SO-00042 — your edit');
    expect(words(forCreator)).toBe('Jinal approved the edit of IN-SO-00042 — your document');
    expect(dec.decisionNote(row(), 'someone-else')).toBeNull();
    expect(dec.decisionNote(row(), 'boss')).toBeNull(); // the decider, not theirs
  });

  it('the same person as asker and creator: one note', async () => {
    const { tx } = fakeTx((text) =>
      text.includes('document_edit_requests')
        ? [
            {
              id: 'req1',
              status: 'rejected',
              doc_code: 'IN-PO-7',
              entity: 'PurchaseOrder',
              doc_id: 'po7',
              requested_by: 'me',
              decided_by: 'me', // rule 3: decided it themselves
              decider: 'Me',
              decided_at: '2026-11-01T06:00:00Z',
              reason: 'Typo',
              approved_n: 0,
              total_n: 1,
              creator: 'me',
            },
          ]
        : [],
    );
    const got = await srcs.readSources(tx, dec.decisionSources('c1', 'me', sql`now()`));
    expect(got).toHaveLength(1);
    expect(got[0]!.key).toBe('dec:edit:req1:rejected');
    expect(words(got[0]!)).toBe('Me rejected the edit of IN-PO-7 — your edit · Typo');
    expect(got[0]!.text[1]).toEqual({ code: 'IN-PO-7', href: '/purchase-orders/po7' });
  });

  it('partly approved, cancel and time change wording; keys stay short', () => {
    expect(words(dec.decisionNote(row({ approvedN: 1 }), 'asker'))).toBe(
      'Jinal approved 1 of 2 changes to IN-SO-00042 — your edit',
    );
    const cancel = row({
      kind: 'cancel',
      status: 'rejected',
      docLabel: 'Sales Order',
      reason: 'Dispatch done',
    });
    expect(words(dec.decisionNote(cancel, 'creator'))).toBe(
      'Jinal rejected cancelling IN-SO-00042 — your Sales Order · Dispatch done',
    );
    const time = row({ kind: 'time', docCode: 'IN-JC-1 · Op #20' });
    expect(words(dec.decisionNote(time, 'asker'))).toBe(
      'Jinal approved the time change on IN-JC-1 · Op #20 — your request',
    );
    // One-step PR cancel: the canceller is not "told"; the PR's creator is.
    const oneStep = row({ kind: 'cancel', oneStep: true, docLabel: 'Purchase Request' });
    expect(dec.decisionNote(oneStep, 'asker')).toBeNull();
    expect(words(dec.decisionNote(oneStep, 'creator'))).toBe(
      'Jinal cancelled IN-SO-00042 — your Purchase Request',
    );
    const longest = dec.decisionNote(
      row({ kind: 'cancel', id: '11111111-1111-4111-8111-111111111111' }),
      'asker',
    );
    expect(longest!.key.length).toBeLessThanOrEqual(128);
  });

  it('every read is bounded: company, deleted_at, window, LIMIT, mine', async () => {
    const { tx, seen } = fakeTx(() => []);
    await srcs.readSources(tx, dec.decisionSources('c1', 'me', sql`now()`));
    expect(seen).toHaveLength(3);
    for (const s of seen) {
      expect(s).toMatch(/company_id = \$\d+::uuid/);
      expect(s).toMatch(/deleted_at IS NULL/);
      expect(s).toMatch(/LIMIT \$\d+/);
      expect(s).toMatch(/requested_by = \$\d+/);
    }
    expect(seen[0]).toMatch(
      /WHEN \$\d+::text THEN \(SELECT x\.created_by FROM public\.sales_orders x/,
    );
  });
});

describe('Super Admin / Full Access see every decision (owner rule 1)', () => {
  const admin = dash({}, true);
  const words = (t: ReturnType<typeof notes.noteText>) =>
    t.map((p) => ('text' in p ? p.text : p.code)).join('');

  it("admin gets the decision on someone else's PO, worded with the raiser's name", () => {
    const approved = ev({
      ...po,
      id: 'a9',
      action: 'APPROVE',
      userId: 'boss',
      actor: 'Bharat',
      raiserName: 'Rakesh',
      ruleKeys: [rules.ruleId(rule('raiser_po_approved'))],
    });
    const got = notes.candidates([approved], notes.rulesFor(admin), 'me');
    expect(got.map((g) => g.key)).toEqual(['a9:raiser_po_approved']);
    expect(words(notes.noteText(got[0]!.ev, got[0]!.rule, true))).toBe(
      "Bharat approved IN-PO-1 — Rakesh's PO",
    );
    // Their own PO keeps "your" (the read gives no name when it is theirs).
    expect(words(notes.noteText({ ...approved, raiserName: null }, got[0]!.rule, true))).toBe(
      'Bharat approved IN-PO-1 — your PO',
    );
    const rc = ev({
      entity: 'RouteCard',
      refId: 'IN-RC-9',
      action: 'REJECT',
      reason: 'Wrong machine',
      raiserName: 'Parth',
    });
    expect(words(notes.noteText(rc, rule('raiser_rc'), true))).toBe(
      "Rakesh returned IN-RC-9 — Parth's Route Card · Wrong machine",
    );
  });

  it('admin read: any owner, not their own decision on others, names read; non-admin strict', () => {
    const adminSql = render(rules.ruleCond(rule('raiser_po'), 'c1', 'me', true)).sql;
    expect(adminSql).toMatch(/\(a\.user_id <> \$\d+::uuid OR rd\.created_by = \$\d+::uuid\)/);
    const read = render(
      notes.activityReadSql(notes.rulesFor(admin), 'c1', 'me', sql`now()`, 300, true),
    ).sql;
    expect(read).toMatch(
      /CASE ev\.entity WHEN \$\d+::text THEN \(\s*SELECT CASE WHEN rd\.created_by <>/,
    );
    expect(read).toMatch(/AS raiser_name/);
    const userSql = render(rules.ruleCond(rule('raiser_po'), 'c1', 'me')).sql;
    expect(userSql).toMatch(/AND rd\.created_by = \$\d+::uuid\)\)$/);
    expect(userSql).not.toMatch(/a\.user_id <>/);
    const userRead = render(
      notes.activityReadSql(notes.rulesFor(dash({})), 'c1', 'me', sql`now()`, 300),
    ).sql;
    expect(userRead).toMatch(/NULL::text AS raiser_name/);
  });

  it('a non-admin still gets only their own decision (no name note)', () => {
    const buyer = dash({ forms: { po_create: perms({ view: true, entry: true }) } });
    // The strict read gives no raiser key for someone else's PO.
    const other = ev({ ...po, id: 'x1', action: 'APPROVE', ruleKeys: [] });
    expect(notes.candidates([other], notes.rulesFor(buyer), 'me')).toEqual([]);
  });

  it("edit / cancel / time decisions: one note per decision for the admin, with the asker's name", () => {
    const base = {
      kind: 'edit' as const,
      id: 'req2',
      status: 'rejected' as const,
      docCode: 'IN-SO-42',
      docHref: '/sales-orders/so42',
      approvedN: 0,
      totalN: 1,
      docLabel: null,
      requestedBy: 'parth',
      creator: 'rakesh',
      askerName: 'Parth',
      creatorName: 'Rakesh',
      decidedBy: 'jinal',
      decider: 'Jinal',
      decidedAt: '2026-11-01T06:00:00.000Z',
      reason: 'Wrong qty',
      oneStep: false,
    };
    const n = dec.decisionNote(base, 'me', true);
    expect(n!.key).toBe('dec:edit:req2:rejected');
    expect(n!.text.map((p) => ('text' in p ? p.text : p.code)).join('')).toBe(
      "Jinal rejected the edit of IN-SO-42 — Parth's edit · Wrong qty",
    );
    expect(dec.decisionNote(base, 'me')).toBeNull(); // not an admin
    expect(dec.decisionNote({ ...base, decidedBy: 'me' }, 'me', true)).toBeNull(); // own decision
    // The asker himself (admin or not) keeps "your".
    expect(
      dec.decisionNote(base, 'parth', true)!.text.map((p) => ('text' in p ? p.text : p.code)),
    ).toContain(' — your edit');
    const cancel = dec.decisionNote(
      { ...base, kind: 'cancel', status: 'approved', docLabel: 'Sales Order' },
      'me',
      true,
    );
    expect(cancel!.text.map((p) => ('text' in p ? p.text : p.code)).join('')).toBe(
      "Jinal approved cancelling IN-SO-42 — Parth's cancel request",
    );
  });

  it('admin decision reads drop the "mine" filter but stay bounded', async () => {
    const { tx, seen } = fakeTx(() => []);
    await srcs.readSources(tx, dec.decisionSources('c1', 'me', sql`now()`, true));
    expect(seen).toHaveLength(3);
    for (const s of seen) {
      expect(s).toMatch(/company_id = \$\d+::uuid/);
      expect(s).toMatch(/LIMIT \$\d+/);
      expect(s).not.toMatch(/requested_by = \$\d+/);
      expect(s).toMatch(/AS asker_name/);
    }
  });
});

describe('code review fixes', () => {
  const words = (n: { text: Array<{ text: string } | { code: string }> } | null) =>
    n!.text.map((p) => ('text' in p ? p.text : p.code)).join('');
  const cancelRow = {
    kind: 'cancel' as const,
    id: 'c9',
    status: 'approved' as const,
    docCode: 'IN-PR-0050',
    docHref: null,
    approvedN: 0,
    totalN: 0,
    docLabel: 'Purchase Request',
    requestedBy: 'me',
    creator: 'me',
    askerName: 'Jinal',
    creatorName: 'Jinal',
    decidedBy: 'me',
    decider: 'Jinal',
    decidedAt: '2026-11-01T06:00:00.000Z',
    reason: null,
    oneStep: true,
  };

  it('a one-step cancel by the creator herself is no note to her (admin or not)', () => {
    expect(dec.decisionNote(cancelRow, 'me')).toBeNull();
    expect(dec.decisionNote(cancelRow, 'me', true)).toBeNull();
    // An approve / reject on her own paperwork still notes her (rule 3).
    expect(dec.decisionNote({ ...cancelRow, oneStep: false }, 'me')).not.toBeNull();
  });

  it('a failing source drops only itself; the others still answer and it is logged', async () => {
    logError.mockClear();
    const { tx } = fakeTx((text) => {
      if (text.includes('public.cancel_requests')) throw new Error('permission denied');
      if (text.includes('public.document_edit_requests')) {
        return [
          {
            id: 'e1',
            status: 'approved',
            doc_code: 'IN-SO-1',
            entity: 'SalesOrder',
            doc_id: 'so1',
            requested_by: 'me',
            decided_by: 'boss',
            decider: 'Boss',
            decided_at: '2026-11-01T06:00:00Z',
            reason: null,
            approved_n: 1,
            total_n: 1,
            creator: 'me',
          },
        ];
      }
      return [];
    });
    const got = await srcs.readSources(tx, dec.decisionSources('c1', 'me', sql`now()`));
    expect(got.map((n) => n.key)).toEqual(['dec:edit:e1:approved']);
    // The combined statement failed (logged), then the sources ran one by
    // one and only the cancel source failed again (logged).
    expect(logError.mock.calls.map((c) => (c[0] as { source: string }).source)).toEqual([
      'combined',
      'decision:cancel',
    ]);
  });

  it("Super Admin gets every work note: another login's CAPA reads with that name", async () => {
    const { tx, seen } = fakeTx((text) =>
      text.includes('capa_records')
        ? [
            {
              id: 'k2',
              code: 'CAPA-0012',
              project_id: null,
              actor: 'Rakesh',
              ts: '2026-11-01T05:00:00Z',
              open: true,
              mine: false,
              responsible: 'Parth',
            },
          ]
        : [],
    );
    const got = await srcs.readSources(
      tx,
      work.workSources(dash({}, true), 'c1', 'me', sql`now()`, true),
    );
    expect(words(got[0]!)).toBe('Rakesh made Parth Responsible for CAPA-0012 — CAPA to work on');
    // No "mine / no login" filter for the admin; design sources read too.
    expect(seen[0]).not.toMatch(/AND \(\(\(SELECT lower/);
    expect(seen.some((s) => s.includes('design_issues'))).toBe(true);
    expect(seen.some((s) => s.includes('design_dcrs'))).toBe(true);
    // A non-admin without the CAPA tick still reads only their own.
    const user = fakeTx(() => []);
    await srcs.readSources(user.tx, work.workSources(dash({}), 'c1', 'me', sql`now()`));
    expect(user.seen[0]).toMatch(/AND \(\(\(SELECT lower/);
  });

  it('activity read: window + entity/action pairs in the innermost WHERE, names after LIMIT', () => {
    const q = render(
      notes.activityReadSql(notes.rulesFor(dash({}, true)), 'c1', 'me', sql`now()`, 300, true),
    ).sql;
    const inner = q.slice(q.indexOf('FROM public.activity_log a'));
    const where = inner.slice(inner.indexOf('WHERE a.company_id'), inner.indexOf(') k'));
    expect(where).toMatch(/a\.ts >= now\(\)/);
    expect(where).toMatch(/\(\(a\.entity = \$\d+ AND a\.action = \$\d+\) OR /);
    expect(where).not.toMatch(/EXISTS|CASE/);
    // The per-rule CASE sits in the inner select; the name lookup after LIMIT.
    expect(q.indexOf('array_remove')).toBeLessThan(q.indexOf('FROM public.activity_log a'));
    expect(q.indexOf('LIMIT')).toBeLessThan(q.lastIndexOf(') ev'));
    expect(q.indexOf('AS raiser_name')).toBeLessThan(q.indexOf('SELECT k.*'));
    expect(q).toMatch(/ORDER BY ev\.ts DESC, ev\.id DESC$/);
  });
});

describe('round trips: one statement per step, identical results', () => {
  it('decision + work sources: ONE statement, one JSON column per source', async () => {
    const sources = [
      ...dec.decisionSources('c1', 'me', sql`now()`),
      ...work.workSources(dash({}, true), 'c1', 'me', sql`now()`, true),
    ];
    const q = render(srcs.combinedSourcesSql(sources));
    expect(q.sql.startsWith('SELECT (SELECT COALESCE(json_agg')).toBe(true);
    expect(q.sql.match(/ AS s\d+/g)).toEqual(sources.map((_, i) => ` AS s${i}`));
    const { tx, statements } = fakeTx(() => []);
    await srcs.readSources(tx, sources);
    expect(statements).toHaveLength(1);
  });

  it('combined result = per-source result; a failure falls back source by source', async () => {
    const row = {
      id: 'e1',
      status: 'approved',
      doc_code: 'IN-SO-1',
      entity: 'SalesOrder',
      doc_id: 'so1',
      requested_by: 'me',
      decided_by: 'boss',
      decider: 'Boss',
      decided_at: '2026-11-01T06:00:00.123456+00:00', // json timestamptz text
      reason: null,
      approved_n: 1,
      total_n: 1,
      creator: 'me',
    };
    const answer = (t: string) => (t.includes('document_edit_requests') ? [row] : []);
    const combined = fakeTx(answer);
    const viaOne = await srcs.readSources(combined.tx, dec.decisionSources('c1', 'me', sql`now()`));
    expect(combined.statements).toHaveLength(1);
    // The same rows read one source at a time give the same notes.
    const perSource: Awaited<ReturnType<typeof srcs.readSources>> = [];
    for (const s of dec.decisionSources('c1', 'me', sql`now()`)) {
      perSource.push(...s.toNotes(answer(render(s.query).sql)));
    }
    expect(viaOne).toEqual(perSource);
    expect(viaOne[0]!.ts).toBe('2026-11-01T06:00:00.123Z');
    // A JSON string column is accepted too.
    const asText = await srcs.readSources(
      {
        execute: async () => [{ s0: JSON.stringify([row]) }],
        transaction: async <T>(fn: (sp: unknown) => Promise<T>) =>
          fn({ execute: async () => [{ s0: JSON.stringify([row]) }] }),
      } as never,
      dec.decisionSources('c1', 'me', sql`now()`).slice(0, 1),
    );
    expect(asText.map((n) => n.key)).toEqual(['dec:edit:e1:approved']);
  });

  it('seen time + activity events: ONE statement, JSON rows read back as events', () => {
    const rs = notes.rulesFor(dash({}, true));
    const act = notes.activityReadSql(rs, 'c1', 'me', sql`now()`, 300, true);
    const q = render(notes.seenAndEventsSql('c1', 'me', act)).sql;
    expect(q.split(';')).toHaveLength(1);
    expect(q).toMatch(/FROM public\.user_ui_settings s/);
    expect(q).toMatch(/json_agg\(row_to_json\(e\) ORDER BY e\.ts DESC, e\.id DESC\)/);
    expect(q).toMatch(/FROM public\.activity_log a/);
    expect(render(notes.seenAndEventsSql('c1', 'me', null)).sql).not.toMatch(/activity_log/);
    const evs = notes.eventsOf([
      {
        id: 'a1',
        ts: '2026-11-01T06:00:00.5+00:00',
        entity: 'PurchaseOrder',
        action: 'APPROVE',
        entity_id: 'po1',
        ref_id: 'IN-PO-1',
        user_id: 'u1',
        qty: 20.5,
        op_ref: null,
        reason: null,
        to_pending: false,
        rule_keys: ['PurchaseOrder:APPROVE:raiser_po_approved'],
        actor: 'Bharat',
        raiser_name: 'Rakesh',
      },
    ]);
    expect(evs[0]).toMatchObject({
      id: 'a1',
      entityId: 'po1',
      qty: 20.5,
      raiserName: 'Rakesh',
      ruleKeys: ['PurchaseOrder:APPROVE:raiser_po_approved'],
    });
    expect(evs[0]!.ts.toISOString()).toBe('2026-11-01T06:00:00.500Z');
    expect(notes.seenOf('2026-11-01T06:00:00.000Z')).toBe('2026-11-01T06:00:00.000Z');
    expect(notes.seenOf(null)).toBeNull();
  });

  it('"still open?": every kind in ONE statement; the home inbox needs none', async () => {
    const c = { cid: 'c1', today: '2026-11-02', myName: '' };
    const cand = (open: string, entityId: string) => ({
      ev: ev({ entityId }),
      rule: rule(open),
      key: `${entityId}:${open}`,
    });
    const cands = [
      cand('pr_to_po', 'pr1'),
      cand('raiser_po', 'po1'),
      cand('nc_dispose', 'nc1'),
      cand('approval_rc', 'rc1'),
    ];
    const { tx, statements } = fakeTx(() => [
      { k: 'pr_to_po', id: 'pr1' },
      { k: 'nc_dispose', id: 'nc1' },
    ]);
    const approvals = { counts: {}, pr: [], po: [], logEntry: [], rc: [{ id: 'rc1' }] } as never;
    const sets = await notes.openSets(tx, cands, c, 'me', approvals);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/UNION ALL/);
    expect(statements[0]).not.toMatch(/route_cards/); // approvals inbox, no statement
    expect(notes.isStillOpen(sets, cands[0]!)).toBe(true);
    expect(notes.isStillOpen(sets, cands[1]!)).toBe(false);
    expect(notes.isStillOpen(sets, cands[2]!)).toBe(true);
    expect(notes.isStillOpen(sets, cands[3]!)).toBe(true);
    // The bell's PO inbox rule runs beside the one statement.
    const inbox = vi.fn(async () => new Set(['po9']));
    const bell = fakeTx(() => []);
    const s2 = await notes.openSets(
      bell.tx,
      [cand('approval_po', 'po9'), cand('pr_to_po', 'pr1')],
      c,
      'me',
      null,
      inbox,
    );
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(bell.statements).toHaveLength(1);
    expect(s2.get('approval_po')?.has('po9')).toBe(true);
  });
});

describe('review fixes: still-open ids, no dangling query, stable order', () => {
  const c = { cid: 'c1', today: '2026-11-02', myName: '' };

  it('a list kind asks DISTINCT ids among the ids given, with no arbitrary LIMIT', () => {
    const q = render(notes.openKindSql('ops_ready', ['j1', 'j2'], c, 'me', null, false)!);
    expect(q.sql).toMatch(/^SELECT DISTINCT s\.id::text AS id FROM \(/);
    expect(q.sql).toMatch(/WHERE s\.id::text = ANY\(\$\d+::text\[\]\)$/);
    expect(q.sql).not.toMatch(/LIMIT 1000/);
    expect(q.params).toContainEqual(['j1', 'j2']);
  });

  it('every statement is built before any query starts (no dangling PO inbox read)', async () => {
    const inbox = vi.fn(async () => new Set<string>());
    const bad = { ...rule('pr_to_po'), open: 'no_such_list' as never };
    const { tx, statements } = fakeTx(() => []);
    await expect(
      notes.openSets(
        tx,
        [
          { ev: ev({ entityId: 'po1' }), rule: rule('approval_po'), key: 'a' },
          { ev: ev({ entityId: 'x1' }), rule: bad, key: 'b' },
        ],
        c,
        'me',
        null,
        inbox,
      ),
    ).rejects.toThrow();
    expect(inbox).not.toHaveBeenCalled();
    expect(statements).toHaveLength(0);
  });

  it('combined aggregate repeats each source order (col DESC, id DESC) like its own query', () => {
    const sources = [
      ...dec.decisionSources('c1', 'me', sql`now()`),
      ...work.workSources(dash({}, true), 'c1', 'me', sql`now()`, true),
    ];
    const q = render(srcs.combinedSourcesSql(sources)).sql;
    expect(
      q.match(/json_agg\(row_to_json\(x\) ORDER BY x\.decided_at DESC, x\.id DESC\)/g),
    ).toHaveLength(3);
    expect(q.match(/json_agg\(row_to_json\(x\) ORDER BY x\.ts DESC, x\.id DESC\)/g)).toHaveLength(
      3,
    );
    for (const s of sources) {
      expect(render(s.query).sql).toMatch(/DESC, \w+\.id DESC LIMIT \$\d+$/);
    }
  });
});
