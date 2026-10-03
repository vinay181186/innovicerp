// Supply Chain Dashboard — Pending PO Tracker + Recent GRN, paged on the
// server (ADR-201: 25 rows a page, filters / Sort & Filter over EVERY row, the
// Pending Qty / Pending Value line summed over every filtered line).

import type {
  ScPendingLine,
  ScPendingPage,
  ScPendingQuery,
  ScRecentGrnPage,
  ScTableQuery,
} from '@innovic/shared';
import { scPendingQuerySchema, scTableQuerySchema } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import {
  PENDING_ITEM_SQL,
  PENDING_SO_SQL,
  PENDING_VENDOR_SQL,
  SC_GRN_SF_COLUMNS,
  SC_PENDING_SF_COLUMNS,
} from './sf-columns';

export const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** The dashboard rides the Purchase price permission (po_create). */
export const scShowMoney = (user: AuthContext): Promise<boolean> =>
  canSeeFormPrice(user, 'po_create');

/** `AND expr ILIKE %term%` (any case, LIKE characters literal) — or nothing. */
function contains(expr: SQL, term: string | undefined): SQL {
  const t = term?.trim();
  if (!t) return sql``;
  return sql`AND ${expr} ILIKE ${`%${likeEscape(t)}%`} ESCAPE '\\'`;
}

/** FROM + WHERE of the pending lines — shared by the page, the count and the picklists. */
export function pendingFrom(companyId: string): SQL {
  return sql`
    FROM purchase_orders po
    JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
    LEFT JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN vendors vt ON vt.code = po.vendor_code_text AND vt.company_id = po.company_id AND vt.deleted_at IS NULL
    LEFT JOIN items i ON i.id = pol.item_id
    LEFT JOIN sales_order_lines sol ON sol.id = pol.source_so_line_id
    LEFT JOIN sales_orders so ON so.id = sol.sales_order_id
    -- JWSO fallback for the drawing revision: PO line -> JC op -> job card ->
    -- job-work line. Each hop is a single-row FK, so lines are never multiplied.
    LEFT JOIN jc_ops rev_op ON rev_op.id = pol.source_jc_op_id AND rev_op.deleted_at IS NULL
    LEFT JOIN job_cards rev_jc ON rev_jc.id = rev_op.job_card_id AND rev_jc.deleted_at IS NULL
    LEFT JOIN job_work_order_lines rev_jwl ON rev_jwl.id = rev_jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
    WHERE po.company_id = ${companyId}::uuid
      AND po.deleted_at IS NULL
      AND po.status IN ('open', 'partial', 'qc_pending')`;
}

type PendRow = {
  po_id: string;
  po_no: string;
  line_no: number;
  po_date: string;
  vendor_code: string | null;
  vendor_name: string | null;
  so_code: string | null;
  so_internal_no: string | null;
  item_code: string | null;
  item_revision: string | null;
  item_name: string | null;
  qty: string | number;
  received_qty: string | number;
  rate: string | number;
  pending_qty: string | number;
  pending_val: string | number;
  status: string;
};

export async function listScPending(
  user: AuthContext,
  raw: ScPendingQuery,
): Promise<ScPendingPage> {
  const input = scPendingQuerySchema.parse(raw);
  const companyId = requireCompany(user);
  const showMoney = await scShowMoney(user);
  const sf = readSf(input.sf);
  const opts = { canSeePrice: showMoney };
  const where = sql`${pendingFrom(companyId)}
    ${contains(PENDING_VENDOR_SQL, input.vendor)}
    ${contains(PENDING_ITEM_SQL, input.item)}
    ${contains(PENDING_SO_SQL, input.so)}
    ${sfWhere(SC_PENDING_SF_COLUMNS, sf, opts)}`;
  const order = sfOrderBy(
    SC_PENDING_SF_COLUMNS,
    sf,
    sql`po.po_date DESC, po.code, pol.line_no, pol.id`,
    opts,
  );

  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT
        po.id AS po_id, po.code AS po_no, pol.line_no, po.po_date,
        COALESCE(v.code, vt.code, po.vendor_code_text) AS vendor_code,
        COALESCE(v.name, vt.name, po.vendor_code_text) AS vendor_name,
        so.code AS so_code, so.internal_so_no AS so_internal_no,
        i.code AS item_code, COALESCE(i.name, pol.item_name) AS item_name,
        -- The customer's drawing revision off the SO line (else the JWSO line),
        -- never items.revision. Cast to text: the column is text only after 0119.
        COALESCE(sol.revision::text, rev_jwl.revision::text) AS item_revision,
        pol.qty, pol.received_qty, pol.rate,
        GREATEST(0, pol.qty - pol.received_qty) AS pending_qty,
        GREATEST(0, (pol.qty - pol.received_qty) * pol.rate) AS pending_val,
        po.status
      ${where}
      ORDER BY ${order}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as PendRow[];
    const [agg] = (await tx.execute(sql`
      SELECT COUNT(*)::int AS c,
             COALESCE(SUM(GREATEST(0, pol.qty - pol.received_qty)), 0) AS qty,
             COALESCE(SUM(GREATEST(0, (pol.qty - pol.received_qty) * pol.rate)), 0) AS val
      ${where}
    `)) as unknown as Array<{ c: number; qty: string | number; val: string | number }>;

    const items: ScPendingLine[] = rows.map((r) => ({
      poId: r.po_id,
      poNo: r.po_no,
      lineNo: Number(r.line_no) || 0,
      poDate: r.po_date,
      vendorCode: r.vendor_code,
      vendorName: r.vendor_name,
      soCode: r.so_code,
      soInternalNo: r.so_internal_no,
      itemCode: r.item_code,
      itemRevision: r.item_revision,
      itemName: r.item_name,
      qty: Number(r.qty) || 0,
      receivedQty: Number(r.received_qty) || 0,
      pendingQty: Number(r.pending_qty) || 0,
      rate: showMoney ? Number(r.rate) || 0 : null,
      pendingVal: showMoney ? Number(r.pending_val) || 0 : null,
      status: r.status,
    }));
    return {
      items,
      total: Number(agg?.c) || 0,
      totalPendingQty: Number(agg?.qty) || 0,
      totalPendingVal: showMoney ? Number(agg?.val) || 0 : null,
      priceVisible: showMoney,
    };
  });
}

type GrnRow = {
  grn_no: string;
  grn_date: string;
  po_no: string | null;
  vendor_code: string | null;
  vendor_name: string | null;
};

export async function listScRecentGrn(
  user: AuthContext,
  raw: ScTableQuery,
): Promise<ScRecentGrnPage> {
  const input = scTableQuerySchema.parse(raw);
  const companyId = requireCompany(user);
  const sf = readSf(input.sf);
  const where = sql`
    FROM goods_receipt_notes grn
    LEFT JOIN purchase_orders po ON po.id = grn.purchase_order_id
    LEFT JOIN vendors v ON v.id = grn.vendor_id
    LEFT JOIN vendors vt ON vt.code = grn.vendor_code_text AND vt.company_id = grn.company_id AND vt.deleted_at IS NULL
    WHERE grn.company_id = ${companyId}::uuid
      AND grn.deleted_at IS NULL
      ${sfWhere(SC_GRN_SF_COLUMNS, sf)}`;
  const order = sfOrderBy(
    SC_GRN_SF_COLUMNS,
    sf,
    sql`grn.grn_date DESC, grn.created_at DESC, grn.id DESC`,
  );
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT grn.code AS grn_no, grn.grn_date,
             po.code AS po_no,
             COALESCE(v.code, vt.code, grn.vendor_code_text) AS vendor_code,
             COALESCE(v.name, vt.name, grn.vendor_code_text) AS vendor_name
      ${where}
      ORDER BY ${order}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as GrnRow[];
    const [cnt] = (await tx.execute(sql`SELECT COUNT(*)::int AS c ${where}`)) as unknown as Array<{
      c: number;
    }>;
    return {
      items: rows.map((r) => ({
        grnNo: r.grn_no,
        grnDate: r.grn_date,
        poNo: r.po_no,
        vendorCode: r.vendor_code,
        vendorName: r.vendor_name,
      })),
      total: Number(cnt?.c) || 0,
    };
  });
}
