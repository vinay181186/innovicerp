import { describe, expect, it } from 'vitest';

import {
  LEAD_COLUMN_IDS,
  createdByColumn,
  leadColumns,
  lockedLeadIds,
} from '@/ui/data/lead-columns';
import { colLabel } from '@/ui/data/data-table-cells';

import { applyLayoutOp } from './table-layout-ops';

// ADR-261 rev (owner 2026-11-02) — Sr No · SO No. · Internal SO No. · POL ·
// Item Code · Item Name · own No. · Created On · Created Time are one fixed
// block at the front of every SO list (Created Time locked + shown, owner
// 2026-11-03); Created By is last.
const LEAD = [...LEAD_COLUMN_IDS];
const ORDER = [...LEAD, 'jc_no', 'qty', 'status'];
const defaults = { order: ORDER, pins: [], hidden: [] };
const state = { order: ORDER, pins: [], hidden: [] };

describe('lead block lock', () => {
  it('a lead column cannot move, hide or pin', () => {
    for (const id of LEAD) {
      expect(applyLayoutOp(state, { type: 'move', id, dir: 1 }, LEAD, defaults)).toBe(state);
      expect(applyLayoutOp(state, { type: 'hide', id }, LEAD, defaults)).toBe(state);
      expect(applyLayoutOp(state, { type: 'pin', id }, LEAD, defaults)).toBe(state);
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
    internalSoNo: () => null,
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

  it('gives the block in the fixed order, all locked, Created Time included', () => {
    const cols = leadColumns<Row>(spec);
    expect(cols.map((c, i) => colLabel(c, i))).toEqual([
      'Sr No',
      'SO No.',
      'Internal SO No.',
      'POL',
      'Item Code',
      'Item Name',
      'Created On',
      'Created Time',
    ]);
    const ids = cols.map((c) => c.id ?? '');
    expect(lockedLeadIds(cols, ids)).toEqual(LEAD);
    const time = cols[cols.length - 1];
    expect(time?.lead).toBe(true);
    expect(time?.hiddenByDefault).toBeFalsy();
  });

  it('Sr No continues from the page offset; Created Time is the India-time 12-hour clock', () => {
    const cols = leadColumns<Row>(spec);
    expect(cols[0]?.render?.(row, 0)).toBe(26);
    expect(cols[0]?.render?.(row, 4)).toBe(30);
    expect(cols[cols.length - 1]?.render?.(row, 0)).toBe('02:35 PM');
  });

  it('own doc no. sits between Item Name and Created On, locked', () => {
    const cols = leadColumns<Row>({ ...spec, doc: { id: 'plan_no', header: 'Plan No.' } });
    const ids = cols.map((c) => c.id ?? '');
    const block = [...LEAD.slice(0, 6), 'plan_no', 'created_on', 'created_time'];
    expect(ids).toEqual(block);
    expect(lockedLeadIds(cols, ids)).toEqual(block);
  });

  it('Created Time cannot be hidden, moved or pinned', () => {
    const ids = [...LEAD, 'qty', 'created_by'];
    const st = { order: ids, pins: [], hidden: [] };
    expect(applyLayoutOp(st, { type: 'hide', id: 'created_time' }, LEAD, st)).toBe(st);
    expect(applyLayoutOp(st, { type: 'pin', id: 'created_time' }, LEAD, st)).toBe(st);
    expect(applyLayoutOp(st, { type: 'move', id: 'created_time', dir: -1 }, LEAD, st)).toBe(st);
  });

  it('two-line headings; Columns ▾ still reads the plain names', () => {
    const cols = leadColumns<Row>(spec);
    const on = cols.find((c) => c.id === 'created_on');
    const time = cols.find((c) => c.id === 'created_time');
    expect(on?.label).toBe('Created On');
    expect(time?.label).toBe('Created Time');
    expect(typeof on?.header).not.toBe('string');
    expect(typeof time?.header).not.toBe('string');
  });

  it('12-hour clock edges: midnight, noon, morning', () => {
    const time = leadColumns<Row>(spec).find((c) => c.id === 'created_time');
    const at = (iso: string) => time?.render?.({ ...row, cr: iso }, 0);
    expect(at('2026-11-02T18:30:00Z')).toBe('12:00 AM'); // 00:00 IST
    expect(at('2026-11-02T06:30:00Z')).toBe('12:00 PM'); // 12:00 IST
    expect(at('2026-11-02T03:40:00Z')).toBe('09:10 AM');
    expect(at('')).toBe('—');
    expect(at('2026-11-02')).toBe('—'); // date only: no invented time
    expect(at('2026-11-03 06:38:40.753832+00')).toBe('12:08 PM'); // Postgres text form
  });

  it('JWSO list: JWSO No. and no Internal SO No. column', () => {
    const jw = { ...spec, so: 'jwso' as const, internalSoNo: undefined };
    const cols = leadColumns<Row>(jw);
    expect(cols.map((c, i) => colLabel(c, i))).toEqual([
      'Sr No',
      'JWSO No.',
      'POL',
      'Item Code',
      'Item Name',
      'Created On',
      'Created Time',
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
