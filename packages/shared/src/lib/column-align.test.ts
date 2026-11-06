import { describe, expect, it } from 'vitest';
import { columnAlign, isMoneyHeading } from './column-align';

describe('columnAlign (ADR-280)', () => {
  it.each([
    'Item Name',
    'Item Code',
    'SO No.',
    'Customer',
    'Remarks',
    'Operation',
    'Working On',
    'Cost Centre',
    'Rate Source',
    'Report',
  ])('text and codes go left: %s', (heading) => expect(columnAlign({ heading })).toBe('left'));

  it.each(['Order Qty', 'Qty per Set', 'Lead Days', 'Days Open', 'Hours', 'Progress %'])(
    'a count is centred even when not declared numeric: %s',
    (heading) => expect(columnAlign({ heading })).toBe('center'),
  );

  it.each(['Pending', 'Received', 'Ops', 'Balance'])('a numeric column is centred: %s', (heading) =>
    expect(columnAlign({ heading, numeric: true })).toBe('center'),
  );

  it.each([
    'Rate',
    'Amount',
    'Order Value',
    'Total Cost',
    'Subtotal',
    'Grand Total',
    'Taxable',
    'Tax',
    'Hour Rate (₹/hr)',
    'Outstanding Amount',
    'CGST',
    'SGST',
    'IGST',
    'TDS',
    'Paid',
    'Round-off',
    'Invoice Total',
    '0-30',
    '90+',
    'Not Due',
  ])('a numeric money column goes right: %s', (heading) =>
    expect(columnAlign({ heading, numeric: true })).toBe('right'),
  );

  it.each([
    'Due Date',
    'SO Status',
    'UOM',
    'Sr No',
    'POL',
    'Op',
    'Ln',
    'Route Card Rev',
    'Action',
    'Created On',
    'Stop Time',
    'Calibration Due',
  ])('a short fixed value is centred: %s', (heading) =>
    expect(columnAlign({ heading })).toBe('center'),
  );

  it('a date, chip or button column is centred whatever its heading says', () => {
    expect(columnAlign({ heading: 'Last Updated', fixed: true })).toBe('center');
  });

  it('a column can say it is money when its heading does not', () => {
    expect(columnAlign({ heading: 'Total', numeric: true })).toBe('center');
    expect(columnAlign({ heading: 'Total', numeric: true, money: true })).toBe('right');
  });

  it('a percentage is centred even with a money word in its heading', () => {
    expect(columnAlign({ heading: 'GST %', numeric: true })).toBe('center');
    expect(columnAlign({ heading: 'Deviation Rate', numeric: true })).toBe('center');
  });

  it('a heading that merely contains a money word is not money', () => {
    expect(isMoneyHeading('Operation')).toBe(false);
    expect(isMoneyHeading('Priority')).toBe(false);
    expect(isMoneyHeading('Accurate')).toBe(false);
  });

  it('short-value words do not match inside longer words', () => {
    expect(columnAlign({ heading: 'Operator' })).toBe('left');
    expect(columnAlign({ heading: 'Update' })).toBe('left');
    expect(columnAlign({ heading: 'Known Drawing Revs' })).toBe('left');
  });
});
