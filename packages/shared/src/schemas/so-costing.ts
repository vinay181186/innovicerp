// SO Costing shared schemas. Mirror of legacy renderSOCosting (L17249) +
// _soCostDetail (L17310). Per SO: Material (PO with-material), Outsource (PO
// job-work / OSP), Machine-Time (cycle_min/60 × completed × machine.hour_rate).
// Read-only.

import { z } from 'zod';

export const soCostingRowSchema = z.object({
  soId: z.string().uuid(),
  soNo: z.string(),
  customer: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  soValue: z.number().nonnegative(),
  costCenter: z.string().nullable(),
  costCenterName: z.string().nullable(),
  materialCost: z.number().nonnegative(),
  outsourceCost: z.number().nonnegative(),
  machineTimeCost: z.number().nonnegative(),
  totalCost: z.number().nonnegative(),
});
export type SoCostingRow = z.infer<typeof soCostingRowSchema>;

export const listSoCostingResponseSchema = z.object({
  rows: z.array(soCostingRowSchema),
});
export type ListSoCostingResponse = z.infer<typeof listSoCostingResponseSchema>;

// Detail view — per-line breakdown with op rows.
export const soCostingOpRowSchema = z.object({
  jcNo: z.string(),
  opSeq: z.number().int(),
  operation: z.string(),
  opType: z.string(),
  machineCode: z.string().nullable(),
  outsourceCost: z.number().nonnegative(),
  machineTimeCost: z.number().nonnegative(),
  qty: z.number().int().nonnegative(),
  cycleTimeMin: z.number().nonnegative(),
});
export type SoCostingOpRow = z.infer<typeof soCostingOpRowSchema>;

export const soCostingLineSchema = z.object({
  salesOrderLineId: z.string().uuid(),
  lineNo: z.number().int(),
  itemCode: z.string().nullable(),
  itemName: z.string(),
  orderQty: z.number().int().nonnegative(),
  materialCost: z.number().nonnegative(),
  outsourceCost: z.number().nonnegative(),
  machineTimeCost: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
  ops: z.array(soCostingOpRowSchema),
});
export type SoCostingLine = z.infer<typeof soCostingLineSchema>;

export const soCostingDetailSchema = z.object({
  soId: z.string().uuid(),
  soNo: z.string(),
  customer: z.string().nullable(),
  costCenter: z.string().nullable(),
  costCenterName: z.string().nullable(),
  grandMaterial: z.number().nonnegative(),
  grandOutsource: z.number().nonnegative(),
  grandMachineTime: z.number().nonnegative(),
  grandTotal: z.number().nonnegative(),
  lines: z.array(soCostingLineSchema),
});
export type SoCostingDetail = z.infer<typeof soCostingDetailSchema>;
