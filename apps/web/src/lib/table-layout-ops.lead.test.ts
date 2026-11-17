import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CreatedOnCell,
  LEAD_COLUMN_IDS,
  createdByColumn,
  createdOnColumn,
  leadColumns,
  lockedLeadIds,
  srNoColumn,
} from '@/ui/data/lead-columns';
import { colLabel } from '@/ui/data/data-table-cells';

import { applyLayoutOp, type LayoutShape } from './table-layout-ops';
import { normalize } from './use-table-layout';

// use-table-layout's network side reads the VITE_* env on import; `normalize` needs neither.
vi.mock('./api', () => ({ ApiError: class {}, apiFetch: vi.fn() }));
vi.mock('./session', () => ({ useSession: vi.fn() }));

// ADR-261 rev 3 (owner 2026-11-15) — Sr No · own No. · Created On (time under
// it) · SO No. · POL · Item Code · Item Name are one fixed (ADR-306: no separate
// Internal SO No. — the SO No. is the one number)
// block at the front of every SO list (a row that IS the order: Sr No · SO No. ·
// Created On · …); Created By is last. No Created Time column. Created On is
// shown by default and each user may hide it, but it stays in place: no move,
// no pin (ADR-286).
const LEAD = [...LEAD_COLUMN_IDS];
const HIDEABLE = ['created_on'];
const FULLY_LOCKED = LEAD.filter((id) => !HIDEABLE.includes(id));
const ORDER = [...LEAD, 'jc_no', 'qty', 'status'];
const defaults = { order: ORDER, pins: [], hidden: [] };
const state = { order: ORDER, pins: [], hidden: [] };

/** The Created On cell as plain text: "date|time" ("date|" with no time). */
const cellText = (v: string | null): string => {
  const html = renderToStaticMarkup(CreatedOnCell({ value: v }));
  const parts = [...html.matchAll(/>([^<]+)</g)].map((m) => m[1]);
  return `${parts[0] ?? ''}|${parts[1] ?? ''}`;
};

describe('lead block lock', () => {
  it('a lead column cannot move or pin; only Created On can hide', () => {
    for (const id of LEAD) {
      expect(applyLayoutOp(state, { type: 'move', id, dir: 1 }, LEAD, defaults, HIDEABLE)).toBe(
        state,
      );
      expect(applyLayoutOp(state, { type: 'pin', id }, LEAD, defaults, HIDEABLE)).toBe(state);
    }
    for (const id of FULLY_LOCKED) {
      expect(applyLayoutOp(state, { type: 'hide', id }, LEAD, defaults, HIDEABLE)).toBe(state);
    }
  });

  it('without a hideable list every lead column still refuses hide', () => {
    for (const id of LEAD) {
      expect(applyLayoutOp(state, { type: 'hide', id }, LEAD, defaults)).toBe(state);
    }
  });

  it('no column can move into the block', () => {
    const next = applyLayoutOp(state, { type: 'move', id: 'jc_no', dir: -1 }, LEAD, defaults);
    expect(next).toBe(state);
    const moved = applyLayoutOp(state, { type: 'move', id: 'qty', dir: -1 }, LEAD, defaults);
    expect(moved.order.slice(0, LEAD.length)).toEqual(LEAD);
    expect(moved.order.slice(LEAD.length)).toEqual(['qty', 'jc_no', 'status']);
  });

  it('a re-shown column goes back to its own slot, not the end', () => {
    const hidden = applyLayoutOp(state, { type: 'hide', id: 'jc_no' }, LEAD, defaults);
    const shown = applyLayoutOp(hidden, { type: 'show', id: 'jc_no' }, LEAD, defaults);
    expect(shown.order).toEqual(ORDER);
  });

  it('old single-column lock still works', () => {
    const next = applyLayoutOp(state, { type: 'move', id: 'so_no', dir: -1 }, 'sr_no', defaults);
    expect(next).toBe(state);
  });
});

describe('leadColumns builder', () => {
  type Row = { so: string; cr: string; code: string; rev: string | null; name: string };
  const spec = {
    firstRowNo: 26,
    soNo: (r: Row) => r.so,
    pol: () => '10',
    createdOn: (r: Row) => r.cr,
    itemCode: (r: Row) => r.code,
    itemRev: (r: Row) => r.rev,
    itemName: (r: Row) => r.name,
  };
  const row: Row = {
    so: 'IN-SO-1',
    cr: '2026-11-02T09:05:00Z',
    code: 'A1',
    rev: null,
    name: 'Shaft',
  };

  it('row IS the order: Sr No · SO No. · Created On · … all locked, no Created Time', () => {
    const cols = leadColumns<Row>(spec);
    expect(cols.map((c, i) => colLabel(c, i))).toEqual([
      'Sr No',
      'SO No.',
      'Created On',
      'POL',
      'Item Code',
      'Item Name',
    ]);
    const ids = cols.map((c) => c.id ?? '');
    expect(ids).toEqual(LEAD);
    expect(lockedLeadIds(cols, ids)).toEqual(LEAD);
    expect(cols.every((c) => c.lead && !c.hiddenByDefault)).toBe(true);
  });

  it('own doc no. sits right after Sr No, then Created On, then SO No.', () => {
    const cols = leadColumns<Row>({ ...spec, doc: { id: 'plan_no', header: 'Plan No.' } });
    const ids = cols.map((c) => c.id ?? '');
    const block = [
      'sr_no',
      'plan_no',
      'created_on',
      'so_no',
      'client_po_line_no',
      'item_code',
      'item_name',
    ];
    expect(ids).toEqual(block);
    expect(lockedLeadIds(cols, ids)).toEqual(block);
  });

  it('Sr No continues from the page offset', () => {
    const cols = leadColumns<Row>(spec);
    expect(cols[0]?.render?.(row, 0)).toBe(26);
    expect(cols[0]?.render?.(row, 4)).toBe(30);
    expect(srNoColumn<Row>(1).render?.(row, 0)).toBe(1);
    expect(srNoColumn<Row>(1).filterable).toBe(false);
  });

  it('leadColumns marks only Created On as hideable', () => {
    const cols = leadColumns<Row>({ ...spec, doc: { id: 'plan_no', header: 'Plan No.' } });
    expect(cols.filter((c) => c.leadHideable).map((c) => c.id)).toEqual(HIDEABLE);
  });

  it('Created On can hide and show but not move or pin', () => {
    const ids = [...LEAD, 'qty', 'created_by'];
    const st = { order: ids, pins: [], hidden: [] };
    const id = 'created_on';
    const hid = applyLayoutOp(st, { type: 'hide', id }, LEAD, st, HIDEABLE);
    expect(hid.hidden).toEqual([id]);
    expect(applyLayoutOp(hid, { type: 'show', id }, LEAD, st, HIDEABLE).hidden).toEqual([]);
    expect(applyLayoutOp(st, { type: 'pin', id }, LEAD, st, HIDEABLE)).toBe(st);
    expect(applyLayoutOp(st, { type: 'unpin', id }, LEAD, st, HIDEABLE)).toBe(st);
    expect(applyLayoutOp(st, { type: 'move', id, dir: -1 }, LEAD, st, HIDEABLE)).toBe(st);
    expect(applyLayoutOp(hid, { type: 'move', id, dir: -1 }, LEAD, st, HIDEABLE)).toBe(hid);
  });

  it('show returns a hidden Created On to its own slot', () => {
    const op = (st: LayoutShape, type: 'hide' | 'show', id: string) =>
      applyLayoutOp(st, { type, id }, LEAD, defaults, HIDEABLE);
    const shownOf = (st: LayoutShape) => st.order.filter((k) => !st.hidden.includes(k));
    expect(shownOf(op(op(state, 'hide', 'created_on'), 'show', 'created_on'))).toEqual(ORDER);
  });

  it('normalize: an old saved layout (Created Time, old order) lands on the new block', () => {
    const d = { locked: LEAD, hideable: HIDEABLE };
    // Saved before 15-Nov: Created Time present + hidden + pinned, old lead order.
    const n = normalize(
      {
        order: ['jc_no', 'created_time', 'qty', 'status', ...FULLY_LOCKED, 'created_on'],
        pins: ['created_time', 'so_no', 'qty'],
        hidden: ['created_time', 'so_no'],
      },
      ORDER,
      d,
    );
    expect(n.order).toEqual([...LEAD, 'jc_no', 'qty', 'status']);
    expect(n.hidden).toEqual([]);
    expect(n.pins).toEqual(['qty']);
    // A user who hid Created On keeps it hidden.
    const hidOn = normalize({ order: ORDER, pins: [], hidden: ['created_on'] }, ORDER, d);
    expect(hidOn.hidden).toEqual(['created_on']);
    // A table that does not name any hideable: the old rule, hidden is dropped.
    const old = normalize({ order: ORDER, pins: [], hidden: ['created_on'] }, ORDER, {
      locked: LEAD,
    });
    expect(old.hidden).toEqual([]);
  });

  it('normalize: list with an own No. — doc in the block, saved old order lands on the new one', () => {
    const block = ['sr_no', 'jc_no', 'created_on', 'so_no', 'item_code'];
    const ids = [...block, 'qty', 'status'];
    const d = { locked: block, hideable: HIDEABLE };
    const n = normalize(
      {
        // Saved under the 3-Nov order: SO block first, own No. + Created On/Time after.
        order: [
          'sr_no',
          'so_no',
          'item_code',
          'jc_no',
          'created_on',
          'created_time',
          'status',
          'qty',
        ],
        pins: ['sr_no', 'status'],
        hidden: ['created_on'],
      },
      ids,
      d,
    );
    expect(n.order).toEqual([...block, 'status', 'qty']);
    expect(n.hidden).toEqual(['created_on']);
    expect(n.pins).toEqual(['status']);
  });

  it('normalize: Sr No new at column 0 — the old first column loses its automatic pin', () => {
    // Saved before Sr No existed: column 0 (code) was stored pinned by the save.
    const ids = ['sr_no', 'code', 'name', 'qty'];
    const n = normalize(
      { order: ['code', 'qty', 'name'], pins: ['code', 'qty'], hidden: [] },
      ids,
      {},
    );
    expect(n.order).toEqual(['sr_no', 'code', 'qty', 'name']);
    expect(n.pins).toEqual(['qty']);
    // An already-current layout keeps every pin the user chose.
    const same = normalize({ order: ids, pins: ['name'], hidden: [] }, ids, {});
    expect(same.pins).toEqual(['name']);
    // A column the code itself pins keeps its pin.
    const coded = normalize({ order: ['code', 'qty', 'name'], pins: ['code'], hidden: [] }, ids, {
      pins: ['code'],
    });
    expect(coded.pins).toEqual(['code']);
  });

  it('two-line heading; Columns ▾ still reads the plain name', () => {
    const on = leadColumns<Row>(spec).find((c) => c.id === 'created_on');
    expect(on?.label).toBe('Created On');
    expect(typeof on?.header).not.toBe('string');
    expect(createdOnColumn<Row>((r) => r.cr).label).toBe('Created On');
  });

  it('Created On cell: date, then the India-time 12-hour clock under it', () => {
    expect(cellText('2026-11-02T09:05:00Z')).toBe('02-11-2026|02:35 PM');
    expect(cellText('2026-11-02T18:30:00Z')).toBe('03-11-2026|12:00 AM'); // 00:00 IST
    expect(cellText('2026-11-02T06:30:00Z')).toBe('02-11-2026|12:00 PM'); // 12:00 IST
    expect(cellText('2026-11-02T03:40:00Z')).toBe('02-11-2026|09:10 AM');
    expect(cellText('2026-11-03 06:38:40.753832+00')).toBe('03-11-2026|12:08 PM'); // Postgres text
    expect(cellText('2026-11-02')).toBe('02-11-2026|'); // date only: no invented time
  });

  it('JWSO list: JWSO No. in the SO slot', () => {
    const jw = { ...spec, so: 'jwso' as const };
    const cols = leadColumns<Row>(jw);
    expect(cols.map((c, i) => colLabel(c, i))).toEqual([
      'Sr No',
      'JWSO No.',
      'Created On',
      'POL',
      'Item Code',
      'Item Name',
    ]);
  });

  it('Created By shows the short name, full name on hover, — when unknown', () => {
    const c = createdByColumn<{ n: string | null }>({ createdByName: (r) => r.n });
    expect(c.header).toBe('Created By');
    expect(c.render?.({ n: 'Jinal Rakesh Patel' }, 0)).toBe('Jinal P.');
    expect(c.title?.({ n: 'Jinal Rakesh Patel' })).toBe('Jinal Rakesh Patel');
    expect(c.render?.({ n: null }, 0)).toBe('—');
  });

  it('a table without lead columns locks column 0 only', () => {
    expect(lockedLeadIds([{ header: 'A' }, { header: 'B' }], ['a', 'b'])).toEqual(['a']);
  });
});
