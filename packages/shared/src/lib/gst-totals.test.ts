import { describe, expect, it } from 'vitest';
import { computeGstTotals, halfGstRate } from './gst-totals';

describe('computeGstTotals (ADR-243)', () => {
  it('in Gujarat: CGST + SGST, round-off to the rupee', () => {
    const t = computeGstTotals({ subtotal: 10000.55, gstPercent: 18, taxType: 'sgst_cgst' });
    expect(t).toMatchObject({
      gstTotal: 1800.1,
      sgst: 900.05,
      cgst: 900.05,
      igst: 0,
      roundOff: 0.35,
      grandTotal: 11801,
    });
  });
  it('out of Gujarat: IGST only', () => {
    const t = computeGstTotals({ subtotal: 10000.55, gstPercent: 18, taxType: 'igst' });
    expect(t).toMatchObject({ igst: 1800.1, cgst: 0, sgst: 0, roundOff: 0.35, grandTotal: 11801 });
  });
  it('odd paisa goes to CGST (same as the GST Sales Register)', () => {
    const t = computeGstTotals({ subtotal: 55.61, gstPercent: 18, taxType: 'sgst_cgst' });
    // 55.61 × 18% = 10.0098 → 10.01
    expect(t.gstTotal).toBe(10.01);
    expect(t.cgst).toBe(5.01);
    expect(t.sgst).toBe(5);
  });
  it('paise maths does not drift (2.01 → 1.01 + 1.00)', () => {
    // 2.01 / 2 in floats is 1.00499…; whole paise give 1.01.
    const t = computeGstTotals({ subtotal: 11.17, gstPercent: 18, taxType: 'sgst_cgst' });
    expect(t.gstTotal).toBe(2.01);
    expect(t.cgst).toBe(1.01);
    expect(t.sgst).toBe(1);
  });
  it('round-off down', () => {
    const t = computeGstTotals({ subtotal: 100.2, gstPercent: 0, taxType: 'igst' });
    expect(t.roundOff).toBe(-0.2);
    expect(t.grandTotal).toBe(100);
  });
  it('exactly .50 rounds up', () => {
    const t = computeGstTotals({ subtotal: 100.5, gstPercent: 0, taxType: 'sgst_cgst' });
    expect(t.roundOff).toBe(0.5);
    expect(t.grandTotal).toBe(101);
  });
  it('unknown state: worked out as SGST + CGST, tax type stays null', () => {
    const t = computeGstTotals({ subtotal: 1000, gstPercent: 18, taxType: null });
    expect(t.taxType).toBeNull();
    expect(t.sgst + t.cgst).toBe(180);
  });
  it('zero subtotal', () => {
    const t = computeGstTotals({ subtotal: 0, gstPercent: 18, taxType: 'igst' });
    expect(t.grandTotal).toBe(0);
    expect(t.roundOff).toBe(0);
  });
  it('half rate label', () => {
    expect(halfGstRate(18)).toBe(9);
    expect(halfGstRate(5)).toBe(2.5);
  });
});
