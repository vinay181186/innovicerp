import { describe, expect, it } from 'vitest';
import { diffFields, restoreStamp, softDeleteStamp } from './audit-trail';

describe('diffFields (ADR-197)', () => {
  const fields = [
    { key: 'orderQty', label: 'Order Qty' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'dueDate', label: 'Due Date' },
    { key: 'vendorId', label: 'Vendor', format: (v: unknown) => (v === 'a' ? 'V-001' : 'V-002') },
  ];

  it('returns only changed fields, numbers as numbers', () => {
    const out = diffFields(
      { orderQty: '10.000', remarks: null, dueDate: '2026-10-01', vendorId: 'a' },
      { orderQty: 12, remarks: '', dueDate: '2026-10-05', vendorId: 'b' },
      fields,
    );
    expect(out).toEqual([
      { field: 'orderQty', label: 'Order Qty', before: 10, after: 12 },
      { field: 'dueDate', label: 'Due Date', before: '2026-10-01', after: '2026-10-05' },
      { field: 'vendorId', label: 'Vendor', before: 'V-001', after: 'V-002' },
    ]);
  });

  it('skips a key the patch did not send, and equal numerics', () => {
    expect(diffFields({ orderQty: '5.000', remarks: 'x' }, { orderQty: 5 }, fields)).toEqual([]);
  });
});

describe('softDeleteStamp / restoreStamp', () => {
  it('stamps who and when, and clears both', () => {
    const s = softDeleteStamp({ id: 'u1' });
    expect(s.deletedBy).toBe('u1');
    expect(s.deletedAt).toBeInstanceOf(Date);
    expect(restoreStamp()).toEqual({ deletedAt: null, deletedBy: null });
  });
});
