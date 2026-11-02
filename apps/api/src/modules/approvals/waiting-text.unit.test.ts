// ADR-265 — the pure text / order helpers of the Approvals waiting list.
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_TYPE_ORDER,
  cancelRequestText,
  dayLogRequestText,
  fieldsChangedText,
  formatRupees,
  orderedCounts,
  poRequestText,
  sortOldestFirst,
  timeChangeRequestText,
  toIso,
  typeLabelOf,
} from './waiting-text';

describe('approval request texts', () => {
  it('PO: amount only when the caller may see it, Indian grouping', () => {
    expect(poRequestText(null)).toBe('Release PO');
    expect(poRequestText(120000)).toBe('Release PO · ₹ 1,20,000');
    expect(formatRupees(1234567.6)).toBe('₹ 12,34,568');
  });

  it('edit: singular and plural', () => {
    expect(fieldsChangedText(1)).toBe('1 field changed');
    expect(fieldsChangedText(3)).toBe('3 fields changed');
  });

  it('cancel: document label and reason', () => {
    expect(cancelRequestText('purchase_order', 'wrong vendor')).toBe(
      'Cancel Purchase Order · wrong vendor',
    );
  });

  it('day log: only the parts that differ', () => {
    const cur = { fromTime: '09:00', toTime: '17:30', description: 'x', orderCode: 'SO-1' };
    expect(dayLogRequestText(cur, { ...cur, toTime: '18:15' })).toBe('Stop 17:30 → 18:15');
    expect(dayLogRequestText(cur, { ...cur, fromTime: '08:30', orderCode: null })).toBe(
      'Start 09:00 → 08:30 · SO SO-1 → —',
    );
    // Nothing differs → says so.
    expect(dayLogRequestText(cur, cur)).toBe('No change');
    expect(dayLogRequestText({ ...cur, toTime: null }, cur)).toBe('Stop — → 17:30');
  });

  it('labels', () => {
    expect(typeLabelOf('po')).toBe('PO');
    expect(typeLabelOf('rc')).toBe('Route Card (New)');
    expect(typeLabelOf('logEntry')).toBe('Op Entry time change');
    expect(typeLabelOf('cancel')).toBe('Cancel Request');
    expect(typeLabelOf('dayLog')).toBe('Day Log edit');
    expect(typeLabelOf('edit:Item')).toBe('Item change');
    expect(typeLabelOf('edit:PurchaseOrder')).toBe('PO change');
  });
});

describe('counts and order', () => {
  it('counts follow menu order and drop zero types', () => {
    const counts = orderedCounts(
      new Map([
        ['dayLog', 2],
        ['cancel', 0],
        ['edit:Vendor', 1],
        ['edit:PurchaseOrder', 4],
        ['po', 3],
      ]),
    );
    expect(counts.map((c) => c.typeKey)).toEqual([
      'po',
      'edit:PurchaseOrder',
      'edit:Vendor',
      'dayLog',
    ]);
    expect(counts.every((c) => c.n > 0)).toBe(true);
    expect(APPROVAL_TYPE_ORDER.indexOf('edit:PurchaseOrder')).toBeLessThan(
      APPROVAL_TYPE_ORDER.indexOf('edit:Vendor'),
    );
  });

  it('oldest first, id breaks ties', () => {
    const rows = [
      { id: 'b', raisedAt: '2026-10-02T00:00:00.000Z' },
      { id: 'c', raisedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'a', raisedAt: '2026-10-02T00:00:00.000Z' },
    ];
    expect(sortOldestFirst(rows).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('toIso reads Date, ISO and Postgres text', () => {
    expect(toIso(new Date('2026-10-31T10:00:00Z'))).toBe('2026-10-31T10:00:00.000Z');
    expect(toIso('2026-10-31 10:00:00.123456+00')).toBe('2026-10-31T10:00:00.123Z');
  });
  it('timeChangeRequestText names the time asked for and why', () => {
    const t = {
      prevLogDate: '2026-10-31',
      prevStartTime: '08:00:00',
      requestedLogDate: '2026-10-31',
      requestedStartTime: '06:30:00',
      reason: ' forgot to log ',
    };
    expect(timeChangeRequestText(t)).toBe('Start 08:00 → 06:30 · forgot to log');
    expect(timeChangeRequestText({ ...t, requestedLogDate: '2026-10-30', reason: null })).toBe(
      '31-Oct-2026 08:00 → 30-Oct-2026 06:30',
    );
  });
});
