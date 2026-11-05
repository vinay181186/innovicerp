import type { RelatedItem } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { distinctItems } from './related-items';
import { buildTimeline, itemSection, masterSection, section, type RelatedRow } from './traceability';

const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';
const ID_C = '00000000-0000-4000-8000-00000000000c';

const item = (over: Partial<RelatedItem> = {}): RelatedItem => ({
  lineId: ID_A,
  itemId: ID_B,
  itemCode: '15992516',
  itemRevision: '0',
  itemName: 'MACHINING OF SUPPORT-15992516',
  clientPoLineNo: '50',
  ...over,
});
const row = (id: string, code: string, date: string | null = '2026-10-28'): RelatedRow => ({
  id,
  code,
  status: 'open',
  date,
  linkId: null,
  label: null,
});

describe('section', () => {
  it('attaches each row its own items and reads as a documents tab', () => {
    const s = section('jw', 'Job Work Order', '', 'job-work-order', [row(ID_A, 'IN-JW-00021')], {
      items: new Map([[ID_A, [item()]]]),
    });
    expect(s.itemMode).toBe('documents');
    expect(s.items[0]?.items).toEqual([item()]);
  });

  it('a document whose lines were not found still appears, with no items', () => {
    const s = section('jw', 'Job Work Order', '', null, [row(ID_A, 'IN-JW-00021')], {
      items: new Map(),
    });
    expect(s.count).toBe(1);
    expect(s.items[0]?.items).toEqual([]);
  });

  it('a party tab states no item, with its own headings', () => {
    const s = section('v', 'Vendor', '', 'vendor', [row(ID_A, 'VND-1', null)], {
      noItems: 'party',
      codeHeading: 'Vendor Code',
      labelHeading: 'Vendor Name',
    });
    expect(s.itemMode).toBe('none');
    expect(s.codeHeading).toBe('Vendor Code');
    expect(s.labelHeading).toBe('Vendor Name');
  });
});

describe('itemSection', () => {
  it('writes the code CODE/REV and links by the item', () => {
    const s = itemSection('item', 'Item', '', [item()]);
    expect(s.itemMode).toBe('items');
    expect(s.items[0]?.code).toBe('15992516/0');
    expect(s.items[0]?.label).toBe('MACHINING OF SUPPORT-15992516');
    expect(s.items[0]?.linkId).toBe(ID_B);
  });

  it('keeps a free-text line, with no link', () => {
    const s = itemSection('item', 'Item', '', [
      item({ itemId: null, itemCode: 'TYPED-1', itemRevision: null }),
    ]);
    expect(s.count).toBe(1);
    expect(s.items[0]?.code).toBe('TYPED-1');
    expect(s.items[0]?.linkId).toBeNull();
  });

  it('lists one item on two lines once, but two Revs of it twice', () => {
    const s = itemSection('item', 'Item', '', [
      item({ lineId: ID_A }),
      item({ lineId: ID_B }),
      item({ lineId: ID_C, itemRevision: '1' }),
    ]);
    expect(s.items.map((d) => d.code)).toEqual(['15992516/0', '15992516/1']);
  });
});

describe('distinctItems', () => {
  it('drops exact repeats and keeps line order', () => {
    const rows = [
      item({ lineId: ID_A, itemCode: 'B' }),
      item({ lineId: ID_B, itemCode: 'A', itemId: ID_C }),
      item({ lineId: ID_C, itemCode: 'B' }),
    ];
    expect(distinctItems(rows).map((r) => r.itemCode)).toEqual(['B', 'A']);
  });

  it('keeps the same item under two POLs apart', () => {
    const rows = [item({ clientPoLineNo: '10' }), item({ clientPoLineNo: '20' })];
    expect(distinctItems(rows)).toHaveLength(2);
  });
});

describe('buildTimeline', () => {
  it('names the first item and counts the rest', () => {
    const s = section('so', 'Sales Order', '', 'sales-order', [row(ID_A, 'IN-SO-1')], {
      items: new Map([[ID_A, [item(), item({ itemCode: 'X' }), item({ itemCode: 'Y' })]]]),
    });
    const [e] = buildTimeline(null, [s]);
    expect(e?.item?.itemCode).toBe('15992516');
    expect(e?.moreItems).toBe(2);
  });

  it("names the anchor's own item on its event", () => {
    const [e] = buildTimeline(
      {
        ts: '2026-11-04',
        label: 'Plan created',
        code: 'PLN-0189',
        routeKind: 'plan',
        linkId: ID_A,
        items: [item()],
      },
      [],
    );
    expect(e?.item?.itemCode).toBe('15992516');
    expect(e?.moreItems).toBe(0);
  });

  it('an event with no item carries none', () => {
    const s = section('c', 'CAPA', '', null, [row(ID_A, 'CAPA-1')], { noItems: 'free text' });
    const [e] = buildTimeline(null, [s]);
    expect(e?.item).toBeNull();
    expect(e?.moreItems).toBe(0);
  });
});

describe('masterSection', () => {
  it('keeps the true total above the row cap and attaches items', () => {
    const s = masterSection(
      'so',
      'Sales Orders',
      '',
      'sales-order',
      [{ id: ID_A, code: 'IN-SO-1', status: 'open', date: '2026-10-01', label: null, total: 73 }],
      { items: new Map([[ID_A, [item()]]]) },
    );
    expect(s.count).toBe(73);
    expect(s.items[0]?.items).toHaveLength(1);
  });
});
