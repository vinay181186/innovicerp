// Sort & Filter (ADR-200) column maps for the five Supply Chain Dashboard
// tables (ADR-201 — each pages at 25 on the server). Every expression is the
// SAME one the table's SELECT shows, valid in both its page and count query.
// The three summary tables (vendor / SO / complete PO) are grouped, so their
// maps read the grouped output through the subquery alias `t`.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

/** Vendor as the cells print it: name, else code (both fall back to the typed text). */
export const PENDING_VENDOR_SQL = sql`COALESCE(v.name, vt.name, po.vendor_code_text)`;
/** CODE/REV as printed (itemCodeWithRev): the SO / JWSO line's drawing revision after a slash. */
export const PENDING_ITEM_SQL = sql`(btrim(i.code) || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), ''))`;

/** ADR-207 — SO No. as shown, "IN-SO-00786 · SO-2401" (Internal SO No. read
 *  live); the SO picklist lists these and its filter matches the same text. */
export const PENDING_SO_SQL = sql`(so.code || COALESCE(' · ' || NULLIF(btrim(so.internal_so_no), ''), ''))`;

export const SC_PENDING_SF_COLUMNS: SfColumnMap = {
  poNo: { sql: sql`po.code`, type: 'text' },
  lineNo: { sql: sql`pol.line_no`, type: 'num' },
  poDate: { sql: sql`po.po_date`, type: 'date' },
  vendor: { sql: PENDING_VENDOR_SQL, type: 'text' },
  soCode: { sql: sql`so.code`, type: 'text' },
  // ADR-207 — the Internal SO No., off the `so` join pendingFrom makes (shared
  // by the page, the count and the picklists).
  soInternalNo: { sql: sql`so.internal_so_no`, type: 'text' },
  itemCode: { sql: PENDING_ITEM_SQL, type: 'text' },
  itemName: { sql: sql`COALESCE(i.name, pol.item_name)`, type: 'text' },
  qty: { sql: sql`pol.qty`, type: 'num' },
  receivedQty: { sql: sql`pol.received_qty`, type: 'num' },
  pendingQty: { sql: sql`GREATEST(0, pol.qty - pol.received_qty)`, type: 'num' },
  rate: { sql: sql`pol.rate`, type: 'num', price: true },
  pendingVal: {
    sql: sql`GREATEST(0, (pol.qty - pol.received_qty) * pol.rate)`,
    type: 'num',
    price: true,
  },
  status: { sql: sql`po.status::text`, type: 'list' },
};

export const SC_VENDOR_SF_COLUMNS: SfColumnMap = {
  vendorName: { sql: sql`COALESCE(t.vendor_name, t.vendor_code)`, type: 'text' },
  vendorCode: { sql: sql`t.vendor_code`, type: 'text' },
  lines: { sql: sql`t.lines`, type: 'num' },
  uniqueItems: { sql: sql`t.unique_items`, type: 'num' },
  totalQty: { sql: sql`t.total_qty`, type: 'num' },
  receivedQty: { sql: sql`t.received_qty`, type: 'num' },
  pendingQty: { sql: sql`(t.total_qty - t.received_qty)`, type: 'num' },
  totalVal: { sql: sql`t.total_val`, type: 'num', price: true },
  pendingVal: { sql: sql`t.pending_val`, type: 'num', price: true },
};

export const SC_SO_SF_COLUMNS: SfColumnMap = {
  soCode: { sql: sql`t.so_code`, type: 'text' },
  // ADR-207 — the Internal SO No., a grouped column of the same subquery
  // (listScSos GROUPs BY it, so one value per row).
  soInternalNo: { sql: sql`t.so_internal_no`, type: 'text' },
  lines: { sql: sql`t.lines`, type: 'num' },
  uniqueVendors: { sql: sql`t.unique_vendors`, type: 'num' },
  totalQty: { sql: sql`t.total_qty`, type: 'num' },
  receivedQty: { sql: sql`t.received_qty`, type: 'num' },
  pendingQty: { sql: sql`(t.total_qty - t.received_qty)`, type: 'num' },
  totalVal: { sql: sql`t.total_val`, type: 'num', price: true },
  pendingVal: { sql: sql`t.pending_val`, type: 'num', price: true },
};

export const SC_PO_SUMMARY_SF_COLUMNS: SfColumnMap = {
  poNo: { sql: sql`t.po_no`, type: 'text' },
  poDate: { sql: sql`t.po_date`, type: 'date' },
  vendor: { sql: sql`COALESCE(t.vendor_name, t.vendor_code)`, type: 'text' },
  soCode: { sql: sql`t.so_code`, type: 'text' },
  // ADR-207 — the Internal SO No., the same subquery column the row shows.
  soInternalNo: { sql: sql`t.so_internal_no`, type: 'text' },
  lines: { sql: sql`t.lines`, type: 'num' },
  totalQty: { sql: sql`t.total_qty`, type: 'num' },
  receivedQty: { sql: sql`t.received_qty`, type: 'num' },
  pendingQty: { sql: sql`(t.total_qty - t.received_qty)`, type: 'num' },
  totalVal: { sql: sql`t.total_val`, type: 'num', price: true },
  taxAmount: { sql: sql`t.tax_amount`, type: 'num', price: true },
  grandTotal: { sql: sql`t.grand_total`, type: 'num', price: true },
  grnCount: { sql: sql`t.grn_count`, type: 'num' },
  status: { sql: sql`t.status`, type: 'list' },
};

export const SC_GRN_SF_COLUMNS: SfColumnMap = {
  grnNo: { sql: sql`grn.code`, type: 'text' },
  grnDate: { sql: sql`grn.grn_date`, type: 'date' },
  poNo: { sql: sql`po.code`, type: 'text' },
  vendor: { sql: sql`COALESCE(v.name, vt.name, grn.vendor_code_text)`, type: 'text' },
};
