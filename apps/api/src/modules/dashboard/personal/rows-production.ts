// ADR-250 — Production inner queries for the per-person home (list-query.ts
// shape).
//   ops_ready  — one row per job-card op ready to run, by ready-ops.ts
//                READY_FROM (the operator home's "Ready for You" rule, so the
//                count here equals GET /dashboard/operator-ready's total).
//                party = machine, x1 = op id, x2 = op seq, x3 = operation.
//   ops_running — ops started and still on the machine (running_ops status
//                'running' — the old operator home's "Running now"). Late once
//                the run has lasted longer than expected: Available × cycle
//                time (the old work-list overrun rule). x1 = minutes running,
//                x2 = op seq, x3 = operation; created_by = who started it.
//   jc_running — open job cards (not closed, an op not complete), late first.
//                x1 = ops still open, x2 = ops on the card.

import { type SQL, sql } from 'drizzle-orm';
import { READY_FROM } from '../ready-ops';
import { filterFrag, type ListFilter } from './list-query';

export function opsReadySql(cid: string, today: string, f: ListFilter): SQL {
  // READY_FROM interpolates the caller's company id (from the auth context,
  // never request input) — the existing ready-ops shape, reused as is.
  return sql`
    SELECT o.id::text AS row_key, jc.id, jc.code, 'op'::text AS kind,
           jc.jc_date::text AS doc_date, jc.due_date::text AS due_date,
           COALESCE(jc.due_date, DATE '9999-12-31')::text AS sort_key,
           m.code::text AS party,
           COALESCE(sol.item_code_text,
                    (SELECT i.code FROM public.items i WHERE i.id = jc.item_id))::text AS item_code,
           COALESCE(sol.part_name,
                    (SELECT i.name FROM public.items i WHERE i.id = jc.item_id))::text AS item_name,
           vs.available::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           jc.created_by::text AS created_by,
           (CASE WHEN jc.due_date < ${today}::date THEN 1 ELSE 0 END)::int AS is_late,
           o.id::text AS x1, o.op_seq::text AS x2, o.operation::text AS x3
    ${sql.raw(READY_FROM(cid))}
    ${filterFrag(f, 'jc.id', 'jc.created_by')}`;
}

export function jcRunningSql(cid: string, today: string, f: ListFilter): SQL {
  return sql`
    SELECT jc.id::text AS row_key, jc.id, jc.code, 'jc'::text AS kind,
           jc.jc_date::text AS doc_date, jc.due_date::text AS due_date,
           jc.jc_date::text AS sort_key, NULL::text AS party,
           i.code::text AS item_code, i.name::text AS item_name,
           jc.order_qty::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           jc.created_by::text AS created_by,
           (CASE WHEN jc.due_date < ${today}::date THEN 1 ELSE 0 END)::int AS is_late,
           st.open_ops::text AS x1, st.total_ops::text AS x2, NULL::text AS x3
    FROM public.job_cards jc
    JOIN (
      SELECT vs.job_card_id,
             COUNT(*) FILTER (WHERE vs.computed_status <> 'complete') AS open_ops,
             COUNT(*) AS total_ops
      FROM public.v_jc_op_status vs
      JOIN public.jc_ops o ON o.id = vs.jc_op_id AND o.deleted_at IS NULL
      WHERE vs.company_id = ${cid}::uuid
      GROUP BY vs.job_card_id
    ) st ON st.job_card_id = jc.id AND st.open_ops > 0
    LEFT JOIN public.items i ON i.id = jc.item_id
    WHERE jc.company_id = ${cid}::uuid AND jc.deleted_at IS NULL AND jc.closed_at IS NULL
      ${filterFrag(f, 'jc.id', 'jc.created_by')}`;
}

export function opsRunningSql(cid: string, f: ListFilter): SQL {
  // start_date + start_time is India wall-clock time (reports/machine-
  // utilisation reads it the same way), so it is placed in IST before now().
  return sql`
    SELECT ro.id::text AS row_key, jc.id, jc.code, 'run'::text AS kind,
           ro.start_date::text AS doc_date, NULL::text AS due_date,
           (ro.start_date + ro.start_time)::text AS sort_key,
           m.code::text AS party,
           i.code::text AS item_code, i.name::text AS item_name,
           vs.completed_qty::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           ro.created_by::text AS created_by,
           (CASE WHEN t.expected_min > 0 AND t.elapsed_min >= t.expected_min
                 THEN 1 ELSE 0 END)::int AS is_late,
           ROUND(t.elapsed_min)::text AS x1, o.op_seq::text AS x2, o.operation::text AS x3
    FROM public.running_ops ro
    JOIN public.jc_ops o ON o.id = ro.jc_op_id AND o.deleted_at IS NULL
    JOIN public.job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
    JOIN public.v_jc_op_status vs ON vs.jc_op_id = o.id
    LEFT JOIN public.machines m ON m.id = ro.machine_id
    LEFT JOIN public.items i ON i.id = jc.item_id
    CROSS JOIN LATERAL (
      SELECT EXTRACT(EPOCH FROM (now() - ((ro.start_date + ro.start_time)
                                          AT TIME ZONE 'Asia/Kolkata'))) / 60 AS elapsed_min,
             GREATEST(vs.available, 0) * COALESCE(o.cycle_time_min, 0)::numeric AS expected_min
    ) t
    WHERE ro.company_id = ${cid}::uuid AND ro.status = 'running'
      ${filterFrag(f, 'jc.id', 'ro.created_by')}`;
}
