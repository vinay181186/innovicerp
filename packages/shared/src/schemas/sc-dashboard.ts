// Supply Chain Dashboard shared schemas.
//
// Mirror of legacy renderSCDashboard (L16790). Aggregates open POs by
// vendor + by SO, lists active-PO totals with tax, surfaces recent GRN,
// and lists pending PO lines for drill-down filtering.

import { z } from 'zod';

export const scVendorRowSchema = z.object({
  vendorId: z.string().uuid().nullable(),
  vendorCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  lines: z.number().int().nonnegative(),
  uniqueItems: z.number().int().nonnegative(),
  totalQty: z.number().nonnegative(),
  receivedQty: z.number().nonnegative(),
  totalVal: z.number().nonnegative(),
  pendingVal: z.number().nonnegative(),
});
export type ScVendorRow = z.infer<typeof scVendorRowSchema>;

export const scSoRowSchema = z.object({
  soRefId: z.string().uuid().nullable(),
  soCode: z.string().nullable(),
  lines: z.number().int().nonnegative(),
  uniqueVendors: z.number().int().nonnegative(),
  totalQty: z.number().nonnegative(),
  receivedQty: z.number().nonnegative(),
  totalVal: z.number().nonnegative(),
  pendingVal: z.number().nonnegative(),
});
export type ScSoRow = z.infer<typeof scSoRowSchema>;

export const scPoSummaryRowSchema = z.object({
  poId: z.string().uuid(),
  poNo: z.string(),
  poDate: z.string(),
  vendorName: z.string().nullable(),
  vendorCode: z.string().nullable(),
  soCode: z.string().nullable(),
  lines: z.number().int().nonnegative(),
  totalQty: z.number().nonnegative(),
  receivedQty: z.number().nonnegative(),
  totalVal: z.number().nonnegative(),
  taxAmount: z.number().nonnegative(),
  grandTotal: z.number().nonnegative(),
  status: z.string(),
  grnCount: z.number().int().nonnegative(),
});
export type ScPoSummaryRow = z.infer<typeof scPoSummaryRowSchema>;

export const scPendingLineSchema = z.object({
  poId: z.string().uuid(),
  poNo: z.string(),
  lineNo: z.number().int(),
  poDate: z.string(),
  vendorCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  qty: z.number().nonnegative(),
  receivedQty: z.number().nonnegative(),
  pendingQty: z.number().nonnegative(),
  rate: z.number().nonnegative(),
  pendingVal: z.number().nonnegative(),
  status: z.string(),
});
export type ScPendingLine = z.infer<typeof scPendingLineSchema>;

export const scRecentGrnSchema = z.object({
  grnNo: z.string(),
  grnDate: z.string(),
  poNo: z.string().nullable(),
  vendorCode: z.string().nullable(),
  vendorName: z.string().nullable(),
});
export type ScRecentGrn = z.infer<typeof scRecentGrnSchema>;

export const scDashboardResponseSchema = z.object({
  summary: z.object({
    openPos: z.number().int().nonnegative(),
    partialPos: z.number().int().nonnegative(),
    closedPos: z.number().int().nonnegative(),
    cancelledPos: z.number().int().nonnegative(),
    totalOrderVal: z.number().nonnegative(),
    totalRecvVal: z.number().nonnegative(),
    pendingVal: z.number().nonnegative(),
    grnCount: z.number().int().nonnegative(),
    todayGrn: z.number().int().nonnegative(),
  }),
  byVendor: z.array(scVendorRowSchema),
  bySo: z.array(scSoRowSchema),
  poSummary: z.array(scPoSummaryRowSchema),
  pendingLines: z.array(scPendingLineSchema),
  recentGrn: z.array(scRecentGrnSchema),
});
export type ScDashboardResponse = z.infer<typeof scDashboardResponseSchema>;
