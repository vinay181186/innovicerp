import { describe, expect, it } from 'vitest';
import {
  isQcUntouched,
  pgrnQcLabel,
  pgrnQcState,
  pgrnQcStateOfGrn,
  qcPendingQtyOf,
} from './qc-state';

const line = (
  acceptedQty: number,
  rejectedQty: number,
  qcPendingQty: number,
  qcAt: string | null = null,
) => ({ acceptedQty, rejectedQty, qcPendingQty, qcAt });

describe('party GRN QC state', () => {
  it('an untouched line is waiting with the server pending figure', () => {
    const l = line(0, 0, 60);
    expect(qcPendingQtyOf(l)).toBe(60);
    expect(isQcUntouched(l)).toBe(true);
    expect(pgrnQcState(l)).toBe('waiting');
  });

  it('60 received, 6 inspected = Part QC with 54 pending', () => {
    const l = line(5, 1, 54, '2026-10-31T05:00:00Z');
    expect(qcPendingQtyOf(l)).toBe(54);
    expect(isQcUntouched(l)).toBe(false);
    expect(pgrnQcState(l)).toBe('partial');
    expect(pgrnQcLabel('partial', 54)).toBe('Part QC · 54 pending');
  });

  it('reads the server figure, never re-derives it', () => {
    // A cancelled GRN: the server zeroes QC Pending even with pieces uninspected.
    expect(qcPendingQtyOf(line(5, 1, 0, '2026-10-31T05:00:00Z'))).toBe(0);
    expect(pgrnQcState(line(5, 1, 0, '2026-10-31T05:00:00Z'))).toBe('done');
  });

  it('a fully inspected line is done; a legacy split with no QC stamp is done too', () => {
    expect(pgrnQcState(line(58, 2, 0, '2026-10-31T05:00:00Z'))).toBe('done');
    expect(pgrnQcState(line(60, 0, 0, null))).toBe('done');
    expect(isQcUntouched(line(60, 0, 0, null))).toBe(false);
  });

  it('a QC stamp alone makes the line touched (not editable)', () => {
    expect(isQcUntouched(line(0, 0, 60, '2026-10-31T05:00:00Z'))).toBe(false);
  });

  it('receipt state from the server totals', () => {
    const g = { totalReceivedQty: 60, qcPendingLines: 1, totalQcPendingQty: 60 };
    expect(pgrnQcStateOfGrn(g)).toBe('waiting');
    expect(pgrnQcStateOfGrn({ ...g, totalQcPendingQty: 54 })).toBe('partial');
    expect(pgrnQcStateOfGrn({ ...g, qcPendingLines: 0, totalQcPendingQty: 0 })).toBe('done');
    expect(pgrnQcLabel('waiting', 60)).toBe('Waiting QC');
    expect(pgrnQcLabel('done', 0)).toBe('QC done');
  });
});
