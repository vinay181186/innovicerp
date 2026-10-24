// ADR-253 — Route Card inner query for the per-person home (list-query.ts
// shape): rc_pending — NEW cards Pending Approval (the Sent for approval
// block, and the "still waiting?" read for the approval_rc notification goes
// through the approvals inbox instead). Same predicate as
// route-cards/approval-inbox.ts: live card, approval_status = 'pending'.

import { type SQL, sql } from 'drizzle-orm';
import { filterFrag, type ListFilter } from './list-query';

export function rcPendingSql(cid: string, f: ListFilter): SQL {
  return sql`
    SELECT rc.id::text AS row_key, rc.id, rc.code, NULL::text AS kind,
           ((rc.created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS doc_date,
           NULL::text AS due_date,
           rc.created_at::text AS sort_key,
           NULL::text AS party,
           i.code::text AS item_code, i.name::text AS item_name,
           COALESCE(op_agg.n, 0)::numeric AS qty, NULL::text AS uom,
           NULL::numeric AS amount,
           rc.created_by::text AS created_by,
           0::int AS is_late,
           NULL::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.route_cards rc
    LEFT JOIN public.items i ON i.id = rc.item_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS n FROM public.route_card_ops o
      WHERE o.route_card_id = rc.id AND o.deleted_at IS NULL
    ) op_agg ON TRUE
    WHERE rc.company_id = ${cid}::uuid AND rc.deleted_at IS NULL
      AND rc.approval_status = 'pending'
      ${filterFrag(f, 'rc.id', 'rc.created_by')}`;
}
