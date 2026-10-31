import { describe, expect, it } from 'vitest';
import {
  isQcUntouched,
  pgrnQcLabel,
  pgrnQcState,
  pgrnQcStateOfGrn,
  qcPendingQtyOf,
} from './qc-state';

const line = (acceptedQty: number, rejectedQty: number, qcAt: string | null = null) => ({
  receivedQty: 60,
  acceptedQty,
  rejectedQty,
  qcAt,
});

describe('party GRN QC state', () => {
  it('an untouched line is waiting with everything pending', () => {
    const l = line(0, 0);
    expect(qcPendingQtyOf(l)).toBe(60);
    expect(isQcUntouched(l)).toBe(true);
    expect(pgrnQcState(l)).toBe('waiting');
  });

  it('60 received, 6 inspected = partial with 54 pending', () => {
    const l = line(5, 1, '2026-10-31T05:00:00Z');
    expect(qcPendingQtyOf(l)).toBe(54);
    expect(isQcUntouched(l)).toBe(false);
    expect(pgrnQcState(l)).toBe('partial');
    expect(pgrnQcLabel('partial', 54)).toBe('Partial · 54 pending');
  });

  it('a fully inspected line is done; a legacy split with no QC stamp is done too', () => {
    expect(pgrnQcState(line(58, 2, '2026-10-31T05:00:00Z'))).toBe('done');
    expect(pgrnQcState(line(60, 0, null))).toBe('done');
    expect(isQcUntouched(line(60, 0, null))).toBe(false);
  });

  it('a QC stamp alone makes the line touched (not editable)', () => {
    expect(isQcUntouched(line(0, 0, '2026-10-31T05:00:00Z'))).toBe(false);
  });

  it('receipt state from list totals', () => {
    const g = { totalReceivedQty: 60, qcPendingLines: 1, totalQcPendingQty: 60 };
    expect(pgrnQcStateOfGrn(g)).toBe('waiting');
    expect(pgrnQcStateOfGrn({ ...g, totalQcPendingQty: 54 })).toBe('partial');
    expect(pgrnQcStateOfGrn({ ...g, qcPendingLines: 0, totalQcPendingQty: 0 })).toBe('done');
    // An older server without totalQcPendingQty (defaults 0) still reads waiting.
    expect(pgrnQcStateOfGrn({ ...g, totalQcPendingQty: 0 })).toBe('waiting');
  });
});
