// ADR-296 — only the document number opens a list row.
import { createElement, isValidElement } from 'react';
import { describe, expect, it } from 'vitest';

import { openCell, openerIndex } from './data-table-cells';
import type { DataTableColumn } from './data-table-types';

type Row = Record<string, unknown>;
const col = (c: Partial<DataTableColumn<Row>>): DataTableColumn<Row> => ({ header: 'x', ...c });

describe('openerIndex', () => {
  it('skips Sr No (any id spelling) and picks the first code column', () => {
    expect(openerIndex([col({ id: 'sr_no', kind: 'num' }), col({ id: 'doc' })])).toBe(1);
    expect(openerIndex([col({ id: 'srNo', kind: 'code' }), col({ id: 'user' })])).toBe(1);
  });
  it('skips dates, numbers and badges', () => {
    const cols = [col({ id: 'd', kind: 'date' }), col({ id: 'q', kind: 'num' }), col({ id: 'n' })];
    expect(openerIndex(cols)).toBe(2);
  });
  it('a column marked opensRow wins, whatever its kind', () => {
    expect(openerIndex([col({ id: 'a' }), col({ id: 'd', kind: 'date', opensRow: true })])).toBe(1);
  });
  it('returns -1 when nothing qualifies (the table then keeps the whole-row click)', () => {
    expect(openerIndex([col({ id: 'q', kind: 'num' })])).toBe(-1);
  });
});

describe('openCell', () => {
  const open = (): void => undefined;
  it('wraps a number in the opener span', () => {
    const out = openCell('IN-SO-00012', open);
    expect(isValidElement(out) && (out.props as { className?: string }).className).toBe('dt-open');
  });
  it('leaves a blank or dash cell unclickable', () => {
    expect(openCell('—', open)).toBe('—');
    expect(openCell('', open)).toBe('');
    expect(openCell(null, open)).toBe(null);
  });
  it('keeps a cell that is already a link', () => {
    const link = createElement('a', { href: '/x' }, 'IN-SO-00012');
    expect(openCell(link, open)).toBe(link);
  });
  it('wraps a component cell even though it has no text children', () => {
    const comp = createElement(() => null, {});
    const out = openCell(comp, open);
    expect(isValidElement(out) && (out.props as { className?: string }).className).toBe('dt-open');
  });
});
