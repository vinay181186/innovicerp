// Supply Chain Dashboard — the three grouped summary tables (Vendor-wise Open
// PO, SO / JW-wise Open PO, Complete Purchase Summary), paged on the server
// (ADR-201). They were capped at 50 / 50 / 100 rows; now every group is
// reachable page by page and `total` / the Grand Total cover every row.
// Each grouped query is wrapped as subquery `t` so Sort & Filter reads the
// grouped figures (see sf-columns.ts).

import type {
  ScPoSummaryPage,
  ScPoSummaryRow,
  ScSoPage,
  ScTableQuery,
  ScVendorPage,
} from '@innovic/shared';
import { scTableQuerySchema } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';
import { poLinePendingRaw } from '../../lib/po-pending';
import { requireCompany, scShowMoney } from './pending';
import { SC_PO_SUMMARY_SF_COLUMNS, SC_SO_SF_COLUMNS, SC_VENDOR_SF_COLUMNS } from './sf-columns';

type Num = string | number;
const n = (v: Num | null | undefined): number => Number(v) || 0;

/** One page + the count of a grouped query `inner` (aliased `t`). */
async function pageOf<R>(
  user: AuthContext,
  inner: SQL,
  map: SfColumnMap,
  input: { sf?: string | undefined; limit: number; offset: number },
  fallback: SQL,
  canSeePrice: boolean,
  extraAgg: SQL = sql``,
): Promise<{ rows: R[]; total: number; agg: Record<string, Num> }> {
  const sf = readSf(input.sf);
  const opts = { canSeePrice };
  const from = sql`FROM (${inner}) t WHERE TRUE ${sfWhere(map, sf, opts)}`;
  const order = sfOrderBy(map, sf, fallback, opts);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT t.* ${from} ORDER BY ${order} LIMIT ${input.limit} OFFSET ${input.offset}`,
    )) as unknown as R[];
    const [agg] = (await tx.execute(
      sql`SELECT COUNT(*)::int AS c ${extraAgg} ${from}`,
    )) as unknown as Array<Record<string, Num>>;
    return { rows, total: n(agg?.['c']), agg: agg ?? {} };
  });
}

const OPEN_PO = sql`po.status IN ('open', 'partial', 'qc_pending')`;
const PEND_VAL = sql.raw(`COALESCE(SUM(${poLinePendingRaw('pol', 'po')} * pol.rate), 0)`);

type GroupRow = {
  lines: number;
  total_qty: Num;
  received_qty: Num;
  total_val: Num;
  pending_val: Num;
};

export async function listScVendors(user: AuthContext, raw: ScTableQuery): Promise<ScVendorPage> {
  const input = scTableQuerySchema.parse(raw);
  const companyId = requireCompany(user);
  const showMoney = await scShowMoney(user);
  const inner = sql`
    SELECT
      po.vendor_id, po.vendor_code_text AS vct,
      COALESCE(v.code, vt.code, po.vendor_code_text) AS vendor_code,
      COALESCE(v.name, vt.name, po.vendor_code_text) AS vendor_name,
      COUNT(pol.id)::int AS lines,
      COUNT(DISTINCT pol.item_id)::int AS unique_items,
      COALESCE(SUM(pol.qty), 0) AS total_qty,
      COALESCE(SUM(pol.received_qty), 0) AS received_qty,
      COALESCE(SUM(pol.qty * pol.rate), 0) AS total_val,
      ${PEND_VAL} AS pending_val
    FROM purchase_orders po
    JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN vendors vt ON vt.code = po.vendor_code_text AND vt.company_id = po.company_id AND vt.deleted_at IS NULL
    WHERE po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL AND ${OPEN_PO}
    GROUP BY po.vendor_id, v.code, v.name, po.vendor_code_text, vt.code, vt.name`;
  type VRow = GroupRow & {
    vendor_id: string | null;
    vendor_code: string | null;
    vendor_name: string | null;
    unique_items: number;
  };
  const { rows, total } = await pageOf<VRow>(
    user,
    inner,
    SC_VENDOR_SF_COLUMNS,
    input,
    sql`t.pending_val DESC, t.vendor_code NULLS LAST, t.vendor_id NULLS LAST, t.vct NULLS LAST`,
    showMoney,
  );
  return {
    items: rows.map((r) => ({
      vendorId: r.vendor_id,
      vendorCode: r.vendor_code,
      vendorName: r.vendor_name,
      lines: n(r.lines),
      uniqueItems: n(r.unique_items),
      totalQty: n(r.total_qty),
      receivedQty: n(r.received_qty),
      totalVal: showMoney ? n(r.total_val) : null,
      pendingVal: showMoney ? n(r.pending_val) : null,
    })),
    total,
    priceVisible: showMoney,
  };
}

export async function listScSos(user: AuthContext, raw: ScTableQuery): Promise<ScSoPage> {
  const input = scTableQuerySchema.parse(raw);
  const companyId = requireCompany(user);
  const showMoney = await scShowMoney(user);
  const inner = sql`
    SELECT
      so.id AS so_ref_id, so.code AS so_code,
      COUNT(pol.id)::int AS lines,
      COUNT(DISTINCT po.vendor_id)::int AS unique_vendors,
      COALESCE(SUM(pol.qty), 0) AS total_qty,
      COALESCE(SUM(pol.received_qty), 0) AS received_qty,
      COALESCE(SUM(pol.qty * pol.rate), 0) AS total_val,
      ${PEND_VAL} AS pending_val
    FROM purchase_orders po
    JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN sales_order_lines sol ON sol.id = pol.source_so_line_id
    LEFT JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL AND ${OPEN_PO}
    GROUP BY so.id, so.code`;
  type SRow = GroupRow & {
    so_ref_id: string | null;
    so_code: string | null;
    unique_vendors: number;
  };
  const { rows, total } = await pageOf<SRow>(
    user,
    inner,
    SC_SO_SF_COLUMNS,
    input,
    sql`t.pending_val DESC, t.so_code NULLS LAST, t.so_ref_id NULLS LAST`,
    showMoney,
  );
  return {
    items: rows.map((r) => ({
      soRefId: r.so_ref_id,
      soCode: r.so_code,
      lines: n(r.lines),
      uniqueVendors: n(r.unique_vendors),
      totalQty: n(r.total_qty),
      receivedQty: n(r.received_qty),
      totalVal: showMoney ? n(r.total_val) : null,
      pendingVal: showMoney ? n(r.pending_val) : null,
    })),
    total,
    priceVisible: showMoney,
  };
}

export async function listScPoSummary(
  user: AuthContext,
  raw: ScTableQuery,
): Promise<ScPoSummaryPage> {
  const input = scTableQuerySchema.parse(raw);
  const companyId = requireCompany(user);
  const showMoney = await scShowMoney(user);
  // Tax as the screen always showed it: IGST on an igst PO, else SGST + CGST
  // (a missing tax type reads as sgst_cgst, a missing percentage as 0).
  const inner = sql`
    WITH po_agg AS (
      SELECT
        po.id, po.code, po.po_date, po.status, po.vendor_id, po.vendor_code_text,
        po.sgst_pct, po.cgst_pct, po.igst_pct, po.tax_type,
        COUNT(pol.id)::int AS lines,
        COALESCE(SUM(pol.qty), 0) AS total_qty,
        COALESCE(SUM(pol.received_qty), 0) AS received_qty,
        COALESCE(SUM(pol.qty * pol.rate), 0) AS total_val
      FROM purchase_orders po
      LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
      WHERE po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL AND po.status <> 'cancelled'
      GROUP BY po.id
    ),
    grn_agg AS (
      SELECT purchase_order_id, COUNT(*)::int AS c
      FROM goods_receipt_notes
      WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      GROUP BY purchase_order_id
    ),
    taxed AS (
      SELECT p.*,
        CASE WHEN COALESCE(p.tax_type::text, 'sgst_cgst') = 'igst'
             THEN p.total_val * COALESCE(p.igst_pct, 0) / 100
             ELSE p.total_val * COALESCE(p.sgst_pct, 0) / 100 + p.total_val * COALESCE(p.cgst_pct, 0) / 100
        END AS tax_amount
      FROM po_agg p
    )
    SELECT
      p.id AS po_id, p.code AS po_no, p.po_date,
      COALESCE(v.name, vt.name, p.vendor_code_text) AS vendor_name,
      COALESCE(v.code, vt.code, p.vendor_code_text) AS vendor_code,
      so.code AS so_code,
      p.lines, p.total_qty, p.received_qty, p.total_val, p.tax_amount,
      p.total_val + p.tax_amount AS grand_total,
      p.status::text AS status,
      COALESCE(g.c, 0) AS grn_count
    FROM taxed p
    LEFT JOIN vendors v ON v.id = p.vendor_id
    LEFT JOIN vendors vt ON vt.code = p.vendor_code_text AND vt.company_id = ${companyId}::uuid AND vt.deleted_at IS NULL
    LEFT JOIN purchase_order_lines pl0 ON pl0.purchase_order_id = p.id AND pl0.line_no = 1
    LEFT JOIN sales_order_lines sol ON sol.id = pl0.source_so_line_id
    LEFT JOIN sales_orders so ON so.id = sol.sales_order_id
    LEFT JOIN grn_agg g ON g.purchase_order_id = p.id`;
  type PRow = {
    po_id: string;
    po_no: string;
    po_date: string;
    vendor_name: string | null;
    vendor_code: string | null;
    so_code: string | null;
    lines: number;
    total_qty: Num;
    received_qty: Num;
    total_val: Num;
    tax_amount: Num;
    grand_total: Num;
    status: string;
    grn_count: number;
  };
  const { rows, total, agg } = await pageOf<PRow>(
    user,
    inner,
    SC_PO_SUMMARY_SF_COLUMNS,
    input,
    sql`t.po_date DESC, t.po_no DESC, t.po_id`,
    showMoney,
    sql`, COALESCE(SUM(t.grand_total), 0) AS grand`,
  );
  const items: ScPoSummaryRow[] = rows.map((r) => ({
    poId: r.po_id,
    poNo: r.po_no,
    poDate: r.po_date,
    vendorName: r.vendor_name,
    vendorCode: r.vendor_code,
    soCode: r.so_code,
    lines: n(r.lines),
    totalQty: n(r.total_qty),
    receivedQty: n(r.received_qty),
    totalVal: showMoney ? n(r.total_val) : null,
    taxAmount: showMoney ? n(r.tax_amount) : null,
    grandTotal: showMoney ? n(r.grand_total) : null,
    status: r.status,
    grnCount: n(r.grn_count),
  }));
  return {
    items,
    total,
    grandTotal: showMoney ? n(agg['grand']) : null,
    priceVisible: showMoney,
  };
}
