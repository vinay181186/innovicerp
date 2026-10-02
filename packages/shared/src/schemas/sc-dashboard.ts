// Supply Chain Dashboard shared schemas.
//
// Mirror of legacy renderSCDashboard (L16790). Aggregates open POs by
// vendor + by SO, lists active-PO totals with tax, surfaces recent GRN,
// and lists pending PO lines for drill-down filtering.

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

export const scVendorRowSchema = z.object({
  vendorId: z.string().uuid().nullable(),
  vendorCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  lines: z.number().int().nonnegative(),
  uniqueItems: z.number().int().nonnegative(),
  totalQty: z.number().nonnegative(),
  receivedQty: z.number().nonnegative(),
  totalVal: z.number().nonnegative().nullable(),
  pendingVal: z.number().nonnegative().nullable(),
});
export type ScVendorRow = z.infer<typeof scVendorRowSchema>;

export const scSoRowSchema = z.object({
  soRefId: z.string().uuid().nullable(),
  soCode: z.string().nullable(),
  lines: z.number().int().nonnegative(),
  uniqueVendors: z.number().int().nonnegative(),
  totalQty: z.number().nonnegative(),
  receivedQty: z.number().nonnegative(),
  totalVal: z.number().nonnegative().nullable(),
  pendingVal: z.number().nonnegative().nullable(),
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
  totalVal: z.number().nonnegative().nullable(),
  taxAmount: z.number().nonnegative().nullable(),
  grandTotal: z.number().nonnegative().nullable(),
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
  /** The customer's drawing revision for this line, read off the SO line the
   *  purchase order line was raised against
   *  (purchase_order_lines.source_so_line_id → sales_order_lines.revision).
   *  Null whenever the PO line has no SO behind it — a stock-replenishment or
   *  consumable line is bought against no customer drawing — and null must
   *  render as the bare item code, never as a trailing slash. It is never
   *  items.revision, which describes the item master and means something
   *  else entirely. */
  itemRevision: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  qty: z.number().nonnegative(),
  receivedQty: z.number().nonnegative(),
  pendingQty: z.number().nonnegative(),
  rate: z.number().nonnegative().nullable(),
  pendingVal: z.number().nonnegative().nullable(),
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

// ADR-201 (2026-10-02): the five tables page at 25 rows. GET /sc-dashboard
// carries only the KPI strip + the Pending PO Tracker filter picklists; each
// table has its own paged endpoint (limit / offset / sf) whose `total` and
// totals are worked out on the server over EVERY matching row.
export const scDashboardResponseSchema = z.object({
  summary: z.object({
    openPos: z.number().int().nonnegative(),
    partialPos: z.number().int().nonnegative(),
    closedPos: z.number().int().nonnegative(),
    cancelledPos: z.number().int().nonnegative(),
    totalOrderVal: z.number().nonnegative().nullable(),
    totalRecvVal: z.number().nonnegative().nullable(),
    pendingVal: z.number().nonnegative().nullable(),
    grnCount: z.number().int().nonnegative(),
    todayGrn: z.number().int().nonnegative(),
  }),
  /** Pending PO Tracker picklists, over ALL pending lines (not one page). */
  filterOptions: z.object({
    vendors: z.array(z.string()),
    items: z.array(z.string()),
    sos: z.array(z.string()),
  }),
  /** Told, not inferred. The server strips money it may not send and states it
   *  here, so a client never has to guess from a null value. A null money field
   *  also means "no value yet", and probing it made one unpriced row hide the
   *  money columns from a user fully entitled to see them. */
  priceVisible: z.boolean(),
});
export type ScDashboardResponse = z.infer<typeof scDashboardResponseSchema>;

/** One page of a Supply Chain Dashboard table. */
export const scTableQuerySchema = z.object({
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ScTableQuery = z.input<typeof scTableQuerySchema>;

/** Pending PO Tracker: the Vendor / Item Code / SO-JWSO boxes (contains, any case). */
export const scPendingQuerySchema = scTableQuerySchema.extend({
  vendor: z.string().trim().max(200).optional(),
  item: z.string().trim().max(200).optional(),
  so: z.string().trim().max(200).optional(),
});
export type ScPendingQuery = z.input<typeof scPendingQuerySchema>;

export const scPendingPageSchema = z.object({
  items: z.array(scPendingLineSchema),
  total: z.number().int().nonnegative(),
  /** Over every filtered line, not the page. */
  totalPendingQty: z.number(),
  totalPendingVal: z.number().nullable(),
  priceVisible: z.boolean(),
});
export type ScPendingPage = z.infer<typeof scPendingPageSchema>;

export const scVendorPageSchema = z.object({
  items: z.array(scVendorRowSchema),
  total: z.number().int().nonnegative(),
  priceVisible: z.boolean(),
});
export type ScVendorPage = z.infer<typeof scVendorPageSchema>;

export const scSoPageSchema = z.object({
  items: z.array(scSoRowSchema),
  total: z.number().int().nonnegative(),
  priceVisible: z.boolean(),
});
export type ScSoPage = z.infer<typeof scSoPageSchema>;

export const scPoSummaryPageSchema = z.object({
  items: z.array(scPoSummaryRowSchema),
  total: z.number().int().nonnegative(),
  /** Sum of Grand Total over every matching PO (null when prices are hidden). */
  grandTotal: z.number().nullable(),
  priceVisible: z.boolean(),
});
export type ScPoSummaryPage = z.infer<typeof scPoSummaryPageSchema>;

export const scRecentGrnPageSchema = z.object({
  items: z.array(scRecentGrnSchema),
  total: z.number().int().nonnegative(),
});
export type ScRecentGrnPage = z.infer<typeof scRecentGrnPageSchema>;
