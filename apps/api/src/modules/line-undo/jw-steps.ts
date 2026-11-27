// ADR-324 line undo (P1) — the Undo list of ONE JWSO line, built fresh from
// live data on every read (nothing stored). Newest step first, the order the
// owner approved:
//   JW Invoice → JW Return → Customer Material Return →
//   for each Job Card on the line (direct, Execute from a plan, or plan → PRO → JC):
//     running ops (stop) → live Op Log entries, newest first (reverse) →
//     Customer Material Issue with pieces still on the card (return to store) →
//     anything else that blocks the card's cancel (manual — its own screen) →
//     the Production Order (cancel) if the card came from one, else the card →
//   the plan (cancel) →
//   Customer Material Issues of the line on no listed card (return to store) →
//   for each live Party GRN line: NC decisions (undo) → its QC (reverse) →
//     the line (remove; on the GRN's last live line: cancel the Party GRN).
// The refusal rules are the documents' own (jobCardCancelBlockers, reverseOpLog's
// rules for 'manual'); the list adds only the order. Reads are batched by id
// list — one query per kind, plus jobCardCancelBlockers once per Job Card.

import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { jobCardCancelBlockers } from '../job-cards/cancel';
import { markPendingAndApproval, readJwLineDocs } from './jw-reads';
import { partyGrnSteps, pmiStep } from './pgrn-steps';
import { type ListedCodes, manualSteps, planSteps, type ProRow, proSteps } from './plan-steps';
import { type BuiltStep, cancelStep, ids, opRef, q } from './step-kit';

export type { BuiltStep, StepRun } from './step-kit';

interface Jc {
  id: string;
  code: string;
  productionOrderId: string | null;
}
interface OpLogRow {
  id: string;
  logNo: string;
  logType: string;
  qty: number;
  rejectQty: number;
  remarks: string | null;
  jobCardId: string;
  opSeq: number;
  operation: string | null;
  isLastOp: boolean;
  ncCodes: string | null;
}

/** Why reverseOpLog would refuse this entry for good (not for order) — the
 *  same rules, read in bulk; null = it can be reversed from the list. */
function opLogManualReason(l: OpLogRow): string | null {
  if (l.logNo.startsWith('LOG-NC-')) {
    return `${l.logNo} was put back by an NC decision — correct it on that NC`;
  }
  if ((l.remarks ?? '').startsWith('Incoming QC (from the same inspection)')) {
    return `${l.logNo} was written by Incoming QC on the GRN — correct it at Incoming QC`;
  }
  if (l.ncCodes) {
    return `${l.logNo} raised ${l.ncCodes} — its deviated pieces are handled on that NC`;
  }
  if (l.logType === 'qc' && l.qty > 0 && l.isLastOp) {
    return `${l.logNo} is the last inspection — its accepted pieces have already gone on`;
  }
  return null;
}

/** The Job Card group: stop → reverse → return → manual → cancel card/PRO. */
async function jobCardSteps(
  tx: DbTransaction,
  companyId: string,
  jcs: readonly Jc[],
  skip: ListedCodes,
  pmiByJc: Map<string, BuiltStep[]>,
  proById: Map<string, ProRow>,
  seen: Set<string>,
  firstOnly: boolean,
): Promise<BuiltStep[]> {
  if (jcs.length === 0) return [];
  const jcIds = jcs.map((j) => j.id);
  // Independent reads are sent together (postgres-js pipelines them on the
  // transaction's connection) — one round trip instead of two.
  const runningP = q<{
    id: string;
    jobCardId: string;
    opSeq: number;
    operation: string | null;
    operatorId: string | null;
    operatorName: string | null;
    shift: string;
  }>(
    tx,
    sql`
      SELECT ro.id, o.job_card_id AS "jobCardId", o.op_seq AS "opSeq", o.operation,
             ro.operator_id AS "operatorId", ro.operator_name AS "operatorName",
             ro.shift::text AS shift
        FROM public.running_ops ro JOIN public.jc_ops o ON o.id = ro.jc_op_id
       WHERE o.job_card_id IN (${ids(jcIds)}) AND ro.company_id = ${companyId}::uuid
         AND ro.status = 'running'
       ORDER BY ro.created_at DESC
    `,
  );
  const logsP = q<OpLogRow>(
    tx,
    sql`
      SELECT l.id, l.log_no AS "logNo", l.log_type::text AS "logType",
             l.qty::int AS qty, l.reject_qty::int AS "rejectQty", l.remarks,
             o.job_card_id AS "jobCardId", o.op_seq AS "opSeq", o.operation,
             (o.op_seq = (SELECT MAX(o2.op_seq) FROM public.jc_ops o2
                           WHERE o2.job_card_id = o.job_card_id AND o2.deleted_at IS NULL)) AS "isLastOp",
             (SELECT string_agg(nc.code, ', ' ORDER BY nc.code) FROM public.nc_register nc
               WHERE nc.qc_log_id = l.id AND nc.deleted_at IS NULL) AS "ncCodes"
        FROM public.op_log l JOIN public.jc_ops o ON o.id = l.jc_op_id
       WHERE o.job_card_id IN (${ids(jcIds)}) AND l.company_id = ${companyId}::uuid
         AND o.deleted_at IS NULL
         AND l.log_type <> 'start' AND l.reversal_of_id IS NULL
         AND (l.qty <> 0 OR l.reject_qty <> 0)
         AND NOT EXISTS (SELECT 1 FROM public.op_log r WHERE r.reversal_of_id = l.id)
       ORDER BY l.created_at DESC, l.log_no DESC
    `,
  );
  const [running, logs] = await Promise.all([runningP, logsP]);

  const out: BuiltStep[] = [];
  const proOrder: ProRow[] = [];
  for (const jc of jcs) {
    if (firstOnly && out.length > 0) return out;
    const jcHref = `/job-cards/${jc.id}`;
    for (const r of running.filter((x) => x.jobCardId === jc.id)) {
      out.push({
        step: {
          key: `stop_op:${r.id}`,
          kind: 'stop_op',
          docType: null,
          docId: r.id,
          docLabel: 'Running operation',
          docCode: `${jc.code} ${opRef(r.opSeq, r.operation)}`,
          whatHappens: 'Stop the running operation — no qty is logged',
          actionLabel: 'Stop',
          href: jcHref,
          needsApproval: false,
          state: 'todo',
          manualReason: null,
        },
        run: {
          kind: 'stop_op',
          runningOpId: r.id,
          operatorId: r.operatorId,
          operatorName: r.operatorName,
          shift: r.shift,
        },
      });
    }
    for (const l of logs.filter((x) => x.jobCardId === jc.id)) {
      const manual = opLogManualReason(l);
      out.push({
        step: {
          key: `reverse_op_log:${l.id}`,
          kind: 'reverse_op_log',
          docType: null,
          docId: l.id,
          docLabel: 'Op Log entry',
          docCode: `${l.logNo} · ${opRef(l.opSeq, l.operation)}`,
          whatHappens: `Reverse the entry — ${Number(l.qty) + Number(l.rejectQty)} pcs`,
          actionLabel: manual ? 'Open' : 'Reverse',
          href: jcHref,
          needsApproval: false,
          state: manual ? 'manual' : 'todo',
          manualReason: manual,
        },
        run: manual ? { kind: 'manual' } : { kind: 'reverse_op_log', opLogId: l.id },
      });
    }
    out.push(...(pmiByJc.get(jc.id) ?? []));
    if (firstOnly && out.length > 0) return out;

    // Everything else that refuses the card's cancel today, named by the
    // card's own rule; what the list already covers is left out. A
    // short-closed / stopped order stays (manual — short-close the line).
    const pro = jc.productionOrderId ? proById.get(jc.productionOrderId) : undefined;
    const mainCard = pro?.jobCardId === jc.id;
    // The order's own card: its blockers come with the order's own rule
    // (productionOrderCancelBlockers reads them) — not read twice.
    if (!mainCard) {
      const blockers = await jobCardCancelBlockers(tx, companyId, jc.id, {
        viaProductionOrder: false,
      });
      out.push(
        ...manualSteps(
          `jc:${jc.id}`,
          jc.id,
          blockers.filter(
            (b) =>
              b.docLabel !== 'Op Entry' &&
              b.docLabel !== 'Customer Material Issue' &&
              !(b.docLabel === 'Job Card' && skip.jcCodes.has(b.docNo)) &&
              !(
                b.docLabel === 'Production Order' &&
                b.reason.startsWith('built by Production Order')
              ) &&
              !(b.docLabel === 'JW Return' && skip.jwReturnCodes.has(b.docNo)),
          ),
          seen,
        ),
      );
    }
    // The order's own card is cancelled with the order (below, once).
    if (!mainCard) out.push(cancelStep('job_card', jc.id, jc.code, jcHref, 'Cancel the Job Card'));
    if (pro && !proOrder.includes(pro)) proOrder.push(pro);
  }
  // Each Production Order ONCE, after every card of it (rework child + parent).
  for (const pro of proOrder) out.push(...(await proSteps(tx, companyId, pro, skip, seen)));
  return out;
}

/** Every live step holding the line, newest first, with state + needsApproval. */
export async function buildJwLineUndoSteps(
  tx: DbTransaction,
  companyId: string,
  jwLineId: string,
  user: AuthContext,
  opts: { firstOnly?: boolean } = {},
): Promise<BuiltStep[]> {
  // firstOnly (the run endpoint): stop at the first step — only it is checked.
  const firstOnly = opts.firstOnly === true;
  const finish = async (): Promise<BuiltStep[]> => {
    const steps = firstOnly ? out.slice(0, 1) : out;
    await markPendingAndApproval(tx, companyId, steps, user);
    return steps;
  };
  const L = sql`${jwLineId}::uuid`;
  const C = sql`${companyId}::uuid`;
  const out: BuiltStep[] = [];

  // One round trip for the four line-level reads.
  const [invoices, returns, cmrs, plans] = await readJwLineDocs(tx, companyId, jwLineId);
  for (const r of invoices)
    out.push(cancelStep('jw_invoice', r.id, r.code, null, 'Cancel the JW Invoice'));

  for (const r of returns)
    out.push(cancelStep('jw_return', r.id, r.code, null, 'Cancel the JW Return'));

  for (const r of cmrs) {
    out.push(
      cancelStep(
        'customer_material_return',
        r.id,
        r.code,
        '/customer-material-returns',
        'Cancel the Customer Material Return — its pieces come back into the register',
      ),
    );
  }

  if (firstOnly && out.length > 0) return finish();
  const pros =
    plans.length > 0
      ? await q<ProRow>(
          tx,
          sql`SELECT id, code, plan_id AS "planId", job_card_id AS "jobCardId", status
                FROM public.production_orders
               WHERE plan_id IN (${ids(plans.map((p) => p.id))}) AND company_id = ${C}
                 AND deleted_at IS NULL
               ORDER BY created_at DESC`,
        )
      : [];
  const jcExtra = [
    ...plans.flatMap((p) => (p.jcId ? [p.jcId] : [])),
    ...pros.flatMap((p) => (p.jobCardId ? [p.jobCardId] : [])),
  ];
  const jcs = await q<Jc & { planId: string | null }>(
    tx,
    sql`SELECT jc.id, jc.code, jc.production_order_id AS "productionOrderId",
               COALESCE(po.plan_id, (SELECT p.id FROM public.plans p WHERE p.jc_id = jc.id
                                       AND p.deleted_at IS NULL
                                       AND p.plan_status <> 'cancelled' LIMIT 1)) AS "planId"
          FROM public.job_cards jc
          LEFT JOIN public.production_orders po ON po.id = jc.production_order_id
         WHERE jc.company_id = ${C} AND jc.deleted_at IS NULL
           AND (jc.source_jw_line_id = ${L}
                ${pros.length > 0 ? sql`OR jc.production_order_id IN (${ids(pros.map((p) => p.id))})` : sql``}
                ${jcExtra.length > 0 ? sql`OR jc.id IN (${ids(jcExtra)})` : sql``})
         ORDER BY jc.created_at DESC`,
  );

  const pmis = await q<{ id: string; code: string; jobCardId: string | null; left: number }>(
    tx,
    sql`SELECT id, code, job_card_id AS "jobCardId", (qty - returned_to_store_qty)::int AS "left"
          FROM public.party_material_issues
         WHERE company_id = ${C} AND deleted_at IS NULL AND qty - returned_to_store_qty > 0
           AND (jw_line_id = ${L}
                ${jcs.length > 0 ? sql`OR job_card_id IN (${ids(jcs.map((j) => j.id))})` : sql``})
         ORDER BY created_at DESC`,
  );
  const jcIdSet = new Set(jcs.map((j) => j.id));
  const pmiByJc = new Map<string, BuiltStep[]>();
  const loosePmis: BuiltStep[] = [];
  for (const m of pmis) {
    if (m.jobCardId && jcIdSet.has(m.jobCardId)) {
      pmiByJc.set(m.jobCardId, [...(pmiByJc.get(m.jobCardId) ?? []), pmiStep(m)]);
    } else {
      loosePmis.push(pmiStep(m));
    }
  }

  const skip = {
    jcCodes: new Set(jcs.map((j) => j.code)),
    proCodes: new Set(pros.map((p) => p.code)),
    jwReturnCodes: new Set(returns.map((r) => r.code)),
  };
  const proById = new Map(pros.map((p) => [p.id, p]));
  const seen = new Set<string>();
  // Every card appears: one whose plan is not a live plan of this line goes
  // with the no-plan cards (newest first), then each plan's cards + the plan.
  const livePlanIds = new Set(plans.map((p) => p.id));
  const planOf = (j: { planId: string | null }) =>
    j.planId && livePlanIds.has(j.planId) ? j.planId : null;
  const group = (planId: string | null) =>
    jobCardSteps(
      tx,
      companyId,
      jcs.filter((j) => planOf(j) === planId),
      skip,
      pmiByJc,
      proById,
      seen,
      firstOnly,
    );
  out.push(...(await group(null)));
  for (const p of plans) {
    if (firstOnly && out.length > 0) return finish();
    out.push(...(await group(p.id)));
    if (firstOnly && out.length > 0) return finish();
    // A Production Order on the plan with no card yet comes before the plan.
    const carded = new Set(jcs.flatMap((j) => (j.productionOrderId ? [j.productionOrderId] : [])));
    for (const o of pros.filter((x) => x.planId === p.id && !carded.has(x.id))) {
      out.push(...(await proSteps(tx, companyId, o, skip, seen)));
    }
    out.push(...(await planSteps(tx, companyId, p, skip, seen)));
  }
  if (firstOnly && out.length > 0) return finish();
  out.push(...loosePmis);
  if (firstOnly && out.length > 0) return finish();
  out.push(...(await partyGrnSteps(tx, companyId, jwLineId)));
  return finish();
}
