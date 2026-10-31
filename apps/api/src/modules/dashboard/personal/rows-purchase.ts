// ADR-250 — Purchase inner queries for the per-person home (list-query.ts
// shape). Each reuses the rule its owning module already has:
//   pr_to_po   — purchase-requests orderedQtySql (legacy header po_id rule,
//                short-closed PR = nothing left) + purchase-orders'
//                assertPrConvertible (any live PR — owner rule 2026-10-31:
//                PRs have no approval; 'open' and 'approved' both ready).
//   po_to_dc   — approved PO (open / partial — delivery-challans refuses a
//                draft) of a type that sends material out (poSendsMaterialOut),
//                with qty still to send by lib/po-line-sent.ts.
//   po_overdue — issued PO (lib/po-pending PO_OPEN_STATUSES) past its due date
//                (IST); qty = lib/po-pending's Pending (qty − accepted).
//   po_draft   — waiting for approval (Sent for approval block).

import { PO_TYPES, poSendsMaterialOut } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { poLineSentGroupedSql } from '../../../lib/po-line-sent';
import { PO_OPEN_STATUSES, poLinePendingSql } from '../../../lib/po-pending';
import { orderedQtySql } from '../../purchase-requests/service';
import { filterFrag, type ListFilter } from './list-query';

const SEND_OUT_TYPES = PO_TYPES.filter((t) => poSendsMaterialOut(t));

const NO_EXTRA = sql.raw('NULL::text AS x1, NULL::text AS x2, NULL::text AS x3');

/** One PR row (balance qty, PR value of that balance). */
function prSelect(cid: string, today: string, where: SQL, f: ListFilter): SQL {
  const ordered = orderedQtySql({ id: sql`pr.id`, poId: sql`pr.po_id`, qty: sql`pr.qty` });
  return sql`
    SELECT pr.id::text AS row_key, pr.id, pr.code, NULL::text AS kind,
           pr.pr_date::text AS doc_date, pr.required_date::text AS due_date,
           pr.pr_date::text AS sort_key,
           COALESCE(v.name, pr.vendor_code_text)::text AS party,
           COALESCE(i.code, pr.item_code_text)::text AS item_code,
           COALESCE(pr.item_name, i.name)::text AS item_name,
           (pr.qty - b.ordered)::numeric AS qty, i.uom::text AS uom,
           ((pr.qty - b.ordered) * COALESCE(pr.est_cost, 0))::numeric AS amount,
           pr.created_by::text AS created_by,
           (CASE WHEN pr.required_date < ${today}::date THEN 1 ELSE 0 END)::int AS is_late,
           ${NO_EXTRA}
    FROM public.purchase_requests pr
    LEFT JOIN public.vendors v ON v.id = pr.vendor_id
    LEFT JOIN public.items i ON i.id = pr.item_id
    CROSS JOIN LATERAL (SELECT ${ordered}::numeric AS ordered) b
    WHERE pr.company_id = ${cid}::uuid AND pr.deleted_at IS NULL
      ${where}
      ${filterFrag(f, 'pr.id', 'pr.created_by')}`;
}

export function prToPoSql(cid: string, today: string, f: ListFilter): SQL {
  return prSelect(
    cid,
    today,
    sql`AND pr.status <> 'cancelled'
      AND pr.balance_closed_at IS NULL
      AND pr.qty > b.ordered`,
    f,
  );
}

/** One PO row: first line's item, Σ of `qtyExpr` over live lines, PO value
 *  before GST (Σ qty × rate — the approval inbox's figure). */
function poSelect(
  cid: string,
  today: string,
  qtyExpr: SQL,
  where: SQL,
  having: SQL,
  lateExpr: SQL,
  sortKey: SQL,
  f: ListFilter,
  sentJoin: SQL = sql``,
): SQL {
  return sql`
    SELECT po.id::text AS row_key, po.id, po.code, po.po_type::text AS kind,
           po.po_date::text AS doc_date, po.due_date::text AS due_date,
           ${sortKey}::text AS sort_key,
           COALESCE(v.name, po.vendor_code_text)::text AS party,
           (ARRAY_AGG(COALESCE(i.code, pol.item_code_text) ORDER BY pol.line_no))[1]::text AS item_code,
           (ARRAY_AGG(COALESCE(pol.item_name, i.name) ORDER BY pol.line_no))[1]::text AS item_name,
           COALESCE(SUM(${qtyExpr}), 0)::numeric AS qty,
           (ARRAY_AGG(i.uom ORDER BY pol.line_no))[1]::text AS uom,
           COALESCE(SUM(pol.qty * pol.rate), 0)::numeric AS amount,
           po.created_by::text AS created_by,
           (CASE WHEN ${lateExpr} THEN 1 ELSE 0 END)::int AS is_late,
           ${NO_EXTRA}
    FROM public.purchase_orders po
    LEFT JOIN public.vendors v ON v.id = po.vendor_id
    LEFT JOIN public.purchase_order_lines pol
      ON pol.purchase_order_id = po.id AND pol.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = pol.item_id
    ${sentJoin}
    WHERE po.company_id = ${cid}::uuid AND po.deleted_at IS NULL
      ${where}
      ${filterFrag(f, 'po.id', 'po.created_by')}
    GROUP BY po.id, v.name
    ${having}`;
}

export function poToDcSql(cid: string, today: string, f: ListFilter): SQL {
  const pending = sql`GREATEST(pol.qty - COALESCE(s.sent, 0), 0)`;
  return poSelect(
    cid,
    today,
    pending,
    sql`AND po.status IN ('open', 'partial')
        AND po.po_type::text = ANY(${sql.param([...SEND_OUT_TYPES])}::text[])`,
    sql`HAVING COALESCE(SUM(${pending}), 0) > 0`,
    sql`po.due_date < ${today}::date`,
    sql`po.po_date`,
    f,
    sql`LEFT JOIN ${poLineSentGroupedSql(cid)} s ON s.purchase_order_line_id = pol.id`,
  );
}

export function poOverdueSql(cid: string, today: string, f: ListFilter): SQL {
  return poSelect(
    cid,
    today,
    poLinePendingSql('pol', 'po'),
    sql`AND po.status::text = ANY(${sql.param([...PO_OPEN_STATUSES])}::text[])
        AND po.due_date < ${today}::date`,
    sql``,
    sql`true`,
    sql`po.due_date`,
    f,
  );
}

/** POs still waiting for approval (status draft). */
export function poDraftSql(cid: string, today: string, f: ListFilter): SQL {
  return poSelect(
    cid,
    today,
    sql`pol.qty`,
    sql`AND po.status = 'draft'`,
    sql``,
    sql`false`,
    sql`po.po_date`,
    f,
  );
}
