// Outsource op links — the ONE SQL definition of each:
//   liveOspPrForOpSql — "a live outsource PR raised for this op";
//   opPoLineIdsSql    — "the PO lines covering this op";
//   ospOpHasPurchaseSql — "the op has a live PR or a PO line" (both above +
//                       the op's stamped outsource_pr_id).
//
// "A live outsource PR raised for this op":
//
// A PR belongs to an outsource op through purchase_requests.source_jc_op_id
// (ADR-015 #5) with PR Type jw_osp; it is live while not deleted and not
// cancelled. The Outsource-balance action (jc-ops/outsource-balance.ts) reads
// the op's live PRs by it, and the home's Purchase check pur_osp_no_pr asks
// "is there none?" with it — so the two can never disagree.
//
// Columns are written as Drizzle column refs, so they render qualified by the
// table name ("purchase_requests"."…"): use it where purchase_requests is in
// the FROM clause WITHOUT an alias.

import { sql, type SQL } from 'drizzle-orm';
import { purchaseRequests } from '../db/schema';

/** Boolean (no leading AND) over the unaliased purchase_requests row. `opId`
 *  is the op's id as SQL — a column (`sql\`o.id\``) or a typed param. */
export function liveOspPrForOpSql(opId: SQL): SQL {
  return sql`(${purchaseRequests.sourceJcOpId} = ${opId}
    AND ${purchaseRequests.prType} = 'jw_osp'
    AND ${purchaseRequests.deletedAt} IS NULL
    AND ${purchaseRequests.status} <> 'cancelled')`;
}

/** The PO lines covering an outsource op, as a subquery of `po_line_id`: the
 *  op's outsource_po_line_id UNION every live jc_op_po_lines row for it (0118)
 *  — the same link rule v_osp_wip's op_po_lines CTE (0130) and
 *  lib/osp-accepted.ts use. `opId` is the op's id as SQL (e.g. a column). */
export function opPoLineIdsSql(opId: SQL): SQL {
  return sql`(
    SELECT o_pl.outsource_po_line_id AS po_line_id
      FROM public.jc_ops o_pl
     WHERE o_pl.id = ${opId} AND o_pl.deleted_at IS NULL
       AND o_pl.outsource_po_line_id IS NOT NULL
    UNION
    SELECT l_pl.purchase_order_line_id
      FROM public.jc_op_po_lines l_pl
     WHERE l_pl.jc_op_id = ${opId} AND l_pl.deleted_at IS NULL)`;
}

/** "This outsource op already has its purchase paperwork" (boolean, no
 *  leading AND) over the jc_ops row `opAlias`: a live outsource PR raised for
 *  it (liveOspPrForOpSql), OR its stamped outsource_pr_id names a live PR, OR
 *  a PO line covers it (opPoLineIdsSql — outsource_po_line_id or
 *  jc_op_po_lines). The home's Purchase check pur_osp_no_pr asks NOT of it. */
export function ospOpHasPurchaseSql(opAlias = 'o'): SQL {
  const o = sql.identifier(opAlias);
  return sql`(
    EXISTS (SELECT 1 FROM public.purchase_requests WHERE ${liveOspPrForOpSql(sql`${o}.id`)})
    OR EXISTS (SELECT 1 FROM public.purchase_requests
               WHERE ${purchaseRequests.id} = ${o}.outsource_pr_id
                 AND ${purchaseRequests.deletedAt} IS NULL
                 AND ${purchaseRequests.status} <> 'cancelled')
    OR EXISTS ${opPoLineIdsSql(sql`${o}.id`)})`;
}
