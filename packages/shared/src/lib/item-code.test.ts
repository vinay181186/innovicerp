import { describe, expect, it } from 'vitest';
import { docItemsSummary, itemLineLabel } from './item-code';

const a = { clientPoLineNo: '10', itemCode: 'ABC', itemRevision: '1', itemName: 'Shaft 50mm' };
const b = { clientPoLineNo: '20', itemCode: 'DEF', itemRevision: '2', itemName: 'Flange' };
const c = { clientPoLineNo: null, itemCode: 'GHI', itemRevision: null, itemName: 'Bolt' };

describe('itemLineLabel', () => {
  it('writes POL, CODE/REV and name', () => {
    expect(itemLineLabel(a)).toBe('POL 10 · ABC/1 · Shaft 50mm');
  });

  it('drops an empty part: no bare POL, no trailing slash', () => {
    expect(itemLineLabel(c)).toBe('GHI · Bolt');
    expect(itemLineLabel({ itemName: 'Typed part' })).toBe('Typed part');
    expect(itemLineLabel({ clientPoLineNo: ' ', itemCode: ' ' })).toBe('');
  });
});

describe('docItemsSummary', () => {
  it('has nothing to say for no lines', () => {
    expect(docItemsSummary([])).toEqual({ label: '', searchText: '' });
  });

  it('reads one item in full', () => {
    expect(docItemsSummary([a]).label).toBe('POL 10 · ABC/1 · Shaft 50mm');
  });

  it('counts two items with no "more"', () => {
    expect(docItemsSummary([a, b]).label).toBe('2 items: ABC/1, DEF/2');
  });

  it('shortens many items but keeps every line searchable', () => {
    const s = docItemsSummary([a, b, c]);
    expect(s.label).toBe('3 items: ABC/1, DEF/2 +1 more');
    expect(s.searchText).toContain('GHI');
    expect(s.searchText).toContain('Bolt');
  });
});
