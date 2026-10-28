// QC Call Register — the two facts the register adds to every call, whatever
// its kind (QcRegisterFacts): the Client PO No. and, on job-card calls, the
// SOURCE STEP whose output the call inspects (its Planned / Actual Machine).
// ONE expression per fact per kind: the Sort & Filter column (register-sf.ts)
// and the hydrated value both read it, so the ▾ sorts exactly what the cell shows.
//
// Neither fact adds a join to pendingFrom / logsFrom (shared with QC History,
// whose rows must not change): the Client PO No. reads aliases those FROMs
// already join (`so`, `rev_jwl`), with the JWSO header as a scalar sub-select,
// and the source step is a sub-query keyed on the call's jc_op id.

import { type SQL, sql } from 'drizzle-orm';
import type { QcMachineOutput, QcSourceStep } from '@innovic/shared';
import type { DbTransaction as Tx } from '../../db/with-user-context';

// ── Client PO No. (NAMING.md "Client PO No.") ──────────────────────────────

/** Job-card AND GRN call (one rule, one copy): the SO header's Client PO No.,
 *  else the JWSO header's (the card's JWSO line → job_work_orders, live JWSO
 *  only). Blank reads as none. Reads the `so` / `rev_jwl` aliases that
 *  pendingFrom / logsFrom (sql.ts) AND incJoins (register-incoming.ts) both
 *  join — on a GRN line they trace PO line → jc_op → JC → SO line / JWSO line,
 *  so a purchase GRN with no job card reads null. */
export const CLIENT_PO_NO_SQL = sql`COALESCE(NULLIF(btrim(so.client_po_no), ''), (
  SELECT NULLIF(btrim(cjw.client_po_no), '') FROM public.job_work_orders cjw
  WHERE cjw.id = rev_jwl.job_work_order_id AND cjw.deleted_at IS NULL))`;

/** Party GRN call: its JWSO's Client PO No. (pgrnJoins' `jw`), ignoring a
 *  soft-deleted JWSO as CLIENT_PO_NO_SQL does (the join itself stays as is). */
export const PGRN_CLIENT_PO_NO = sql`(CASE WHEN jw.deleted_at IS NULL
  THEN NULLIF(btrim(jw.client_po_no), '') END)`;

// ── Source step (NAMING.md "Planned Machine" / "Actual Machine") ───────────

/**
 * The step a QC call inspects, as a one-row derived table over the call's
 * jc_op id: the nearest live op of the same card at or before the call's op
 * that is not a QC step (op_type <> 'qc'). A QC op therefore resolves to the
 * step before it; a process op that carries its own QC (qc_required) resolves
 * to itself — its own output is what is inspected. No such op → no row.
 * Outsourced = an OSP op (op_type 'outsource'); a dual-lane process op with an
 * OSP balance (ADR-081) stays 'process' and keeps its machine.
 */
function sourceStepRow(jcOpId: SQL): SQL {
  return sql`(
    SELECT ps.id AS step_id, ps.op_seq AS step_seq, ps.operation AS step_operation,
      (ps.op_type = 'outsource') AS outsourced,
      COALESCE(ssm.code, NULLIF(btrim(ps.machine_code_text), '')) AS planned_code
    FROM public.jc_ops cur
    JOIN public.jc_ops ps
      ON ps.job_card_id = cur.job_card_id AND ps.deleted_at IS NULL
     AND ps.op_type <> 'qc' AND (ps.op_seq < cur.op_seq OR ps.id = cur.id)
    LEFT JOIN public.machines ssm ON ssm.id = ps.machine_id AND ssm.deleted_at IS NULL
    WHERE cur.id = ${jcOpId}
    ORDER BY ps.op_seq DESC
    LIMIT 1
  )`;
}

/** The machines that logged output on the step (v_op_machine_output, which
 *  nets reversals), most pieces first — the same read as machine-split.ts.
 *  The view's '—' (output logged with no machine at all) names no machine,
 *  so it is left out rather than listed as one. */
const STEP_MACHINES_WHERE = sql`FROM public.v_op_machine_output smo
  WHERE smo.jc_op_id = ss.step_id AND smo.completed_qty > 0 AND smo.machine_code <> '—'`;

/** Planned Machine as the cell prints it ("Outsourced" on an OSP step). */
export function plannedMachineSql(jcOpId: SQL): SQL {
  return sql`(SELECT CASE WHEN ss.outsourced THEN 'Outsourced' ELSE ss.planned_code END
    FROM ${sourceStepRow(jcOpId)} ss)`;
}

/** Actual Machine as the cell prints it: "CNC-1 · CNC-2", most pieces first
 *  ("Outsourced" on an OSP step, null when nothing is logged). */
export function actualMachineSql(jcOpId: SQL): SQL {
  return sql`(SELECT CASE WHEN ss.outsourced THEN 'Outsourced' ELSE (
      SELECT string_agg(smo.machine_code, ' · ' ORDER BY smo.completed_qty DESC, smo.machine_code)
      ${STEP_MACHINES_WHERE}) END
    FROM ${sourceStepRow(jcOpId)} ss)`;
}

type Raw = Record<string, unknown>;

/**
 * The page's source steps in ONE query. Pending: `ids` are jc_op ids (the
 * call's op); completed: op_log ids (the QC log's jc_op_id). Keyed on the
 * given id; a call with no source step is simply absent.
 */
export async function loadSourceSteps(
  tx: Tx,
  companyId: string,
  view: 'pending' | 'completed',
  ids: SQL,
): Promise<Map<string, QcSourceStep>> {
  const from = view === 'pending' ? sql`public.jc_ops q` : sql`public.op_log q`;
  const opId = view === 'pending' ? sql`q.id` : sql`q.jc_op_id`;
  const r = (await tx.execute(sql`
    SELECT q.id AS "forId", ss.step_id AS "jcOpId", ss.step_seq AS "opSeq",
      ss.step_operation AS "operation", ss.outsourced, ss.planned_code AS "plannedCode",
      (SELECT json_agg(json_build_object('code', smo.machine_code, 'qty', smo.completed_qty)
              ORDER BY smo.completed_qty DESC, smo.machine_code)
       ${STEP_MACHINES_WHERE}) AS machines
    FROM ${from}
    CROSS JOIN LATERAL ${sourceStepRow(opId)} ss
    WHERE q.company_id = ${companyId}::uuid AND q.id IN (${ids})`)) as unknown as Raw[];
  const out = new Map<string, QcSourceStep>();
  for (const x of r) {
    const outsourced = Boolean(x['outsourced']);
    const machines = (x['machines'] as Array<{ code: unknown; qty: unknown }> | null) ?? [];
    out.set(String(x['forId']), {
      jcOpId: String(x['jcOpId']),
      opSeq: Number(x['opSeq']),
      operation: (x['operation'] as string | null) ?? null,
      outsourced,
      plannedMachine: outsourced ? null : ((x['plannedCode'] as string | null) ?? null),
      actualMachines: outsourced
        ? []
        : machines.map((m): QcMachineOutput => ({ code: String(m.code), qty: Number(m.qty) })),
    });
  }
  return out;
}
