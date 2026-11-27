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

import {
  CANCEL_DOC_FORM_KEY,
  type AccessFormKey,
  type CancelDocType,
  ONE_STEP_CANCEL_DOC_TYPES,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { jobCardCancelBlockers } from '../job-cards/cancel';
import { partyGrnSteps, pmiStep } from './pgrn-steps';
import { type BuiltStep, cancelStep, ids, manualStep, opRef, q } from './step-kit';

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
  skip: { jcCodes: Set<string>; proCodes: Set<string>; jwReturnCodes: Set<string> },
  pmiByJc: Map<string, BuiltStep[]>,
  proById: Map<string, { id: string; code: string }>,
): Promise<BuiltStep[]> {
  if (jcs.length === 0) return [];
  const jcIds = jcs.map((j) => j.id);
  const running = await q<{
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
  const logs = await q<OpLogRow>(
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

  const out: BuiltStep[] = [];
  for (const jc of jcs) {
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

    // Everything else that refuses the card's cancel today, named by the
    // card's own rule; what the list already covers is left out.
    const blockers = await jobCardCancelBlockers(tx, companyId, jc.id, {
      viaProductionOrder: jc.productionOrderId != null,
    });
    blockers
      .filter(
        (b) =>
          b.docLabel !== 'Op Entry' &&
          b.docLabel !== 'Customer Material Issue' &&
          !(b.docLabel === 'Job Card' && skip.jcCodes.has(b.docNo)) &&
          !(b.docLabel === 'Production Order' && skip.proCodes.has(b.docNo)) &&
          !(b.docLabel === 'JW Return' && skip.jwReturnCodes.has(b.docNo)),
      )
      .forEach((b, i) => out.push(manualStep(`manual:${jc.id}:${i}`, jc.id, b)));

    const pro = jc.productionOrderId ? proById.get(jc.productionOrderId) : undefined;
    if (pro) {
      out.push(
        cancelStep(
          'production_order',
          pro.id,
          pro.code,
          `/production-orders/${pro.id}`,
          `Cancel the Production Order — ${jc.code} is cancelled with it`,
        ),
      );
    } else {
      out.push(cancelStep('job_card', jc.id, jc.code, jcHref, 'Cancel the Job Card'));
    }
  }
  return out;
}

/** Every live step holding the line, newest first, with state + needsApproval. */
export async function buildJwLineUndoSteps(
  tx: DbTransaction,
  companyId: string,
  jwLineId: string,
  user: AuthContext,
): Promise<BuiltStep[]> {
  const L = sql`${jwLineId}::uuid`;
  const C = sql`${companyId}::uuid`;
  const out: BuiltStep[] = [];

  const invoices = await q<{ id: string; code: string }>(
    tx,
    sql`SELECT id, code FROM public.jw_invoices
         WHERE job_work_order_line_id = ${L} AND company_id = ${C}
           AND deleted_at IS NULL AND status::text <> 'cancelled'
         ORDER BY created_at DESC`,
  );
  for (const r of invoices)
    out.push(cancelStep('jw_invoice', r.id, r.code, null, 'Cancel the JW Invoice'));

  const returns = await q<{ id: string; code: string }>(
    tx,
    sql`SELECT id, code FROM public.jw_return_challans
         WHERE job_work_order_line_id = ${L} AND company_id = ${C}
           AND deleted_at IS NULL AND status <> 'cancelled'
         ORDER BY created_at DESC`,
  );
  for (const r of returns)
    out.push(cancelStep('jw_return', r.id, r.code, null, 'Cancel the JW Return'));

  const cmrs = await q<{ id: string; code: string }>(
    tx,
    sql`SELECT c.id, c.code FROM public.customer_material_returns c
         WHERE c.company_id = ${C} AND c.deleted_at IS NULL AND c.status <> 'cancelled'
           AND EXISTS (SELECT 1 FROM public.customer_material_return_lines cl
                        WHERE cl.return_id = c.id AND cl.jw_line_id = ${L} AND cl.deleted_at IS NULL)
         ORDER BY c.created_at DESC`,
  );
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

  const plans = await q<{ id: string; code: string; jcId: string | null }>(
    tx,
    sql`SELECT id, code, jc_id AS "jcId" FROM public.plans
         WHERE jw_line_id = ${L} AND company_id = ${C}
           AND deleted_at IS NULL AND plan_status <> 'cancelled'
         ORDER BY created_at DESC`,
  );
  const pros =
    plans.length > 0
      ? await q<{ id: string; code: string; planId: string; jobCardId: string | null }>(
          tx,
          sql`SELECT id, code, plan_id AS "planId", job_card_id AS "jobCardId"
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
                                       AND p.deleted_at IS NULL LIMIT 1)) AS "planId"
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
  // Cards with no plan first (newest first), then each plan's cards + the plan.
  out.push(
    ...(await jobCardSteps(
      tx,
      companyId,
      jcs.filter((j) => !j.planId),
      skip,
      pmiByJc,
      proById,
    )),
  );
  for (const p of plans) {
    out.push(
      ...(await jobCardSteps(
        tx,
        companyId,
        jcs.filter((j) => j.planId === p.id),
        skip,
        pmiByJc,
        proById,
      )),
    );
    // A Production Order on the plan with no card yet is cancelled before the plan.
    const carded = new Set(jcs.flatMap((j) => (j.productionOrderId ? [j.productionOrderId] : [])));
    for (const o of pros.filter((x) => x.planId === p.id && !carded.has(x.id))) {
      out.push(
        cancelStep(
          'production_order',
          o.id,
          o.code,
          `/production-orders/${o.id}`,
          'Cancel the Production Order',
        ),
      );
    }
    out.push(cancelStep('plan', p.id, p.code, `/plans/${p.id}`, 'Cancel the plan'));
  }
  out.push(...loosePmis);
  out.push(...(await partyGrnSteps(tx, companyId, jwLineId)));

  await markPendingAndApproval(tx, companyId, out, user);
  return out;
}

/** A pending cancel request → 'waiting_approval'; needsApproval from the
 *  caller's Approve tick on the type's page (one-step types never wait). */
async function markPendingAndApproval(
  tx: DbTransaction,
  companyId: string,
  steps: BuiltStep[],
  user: AuthContext,
): Promise<void> {
  const cancels = steps.filter(
    (s): s is BuiltStep & { run: { kind: 'cancel'; docType: CancelDocType; docId: string } } =>
      s.run.kind === 'cancel',
  );
  if (cancels.length === 0) return;
  const pending = await q<{ docType: string; docId: string }>(
    tx,
    sql`SELECT doc_type AS "docType", doc_id AS "docId" FROM public.cancel_requests
         WHERE company_id = ${companyId}::uuid AND status = 'pending' AND deleted_at IS NULL
           AND doc_id IN (${ids(cancels.map((s) => s.run.docId))})`,
  );
  const pendingKeys = new Set(pending.map((p) => `${p.docType}:${p.docId}`));
  const approveByForm = new Map<string, boolean>();
  for (const s of cancels) {
    const { docType, docId } = s.run;
    if (pendingKeys.has(`${docType}:${docId}`)) s.step.state = 'waiting_approval';
    if (ONE_STEP_CANCEL_DOC_TYPES.includes(docType)) continue;
    const form = CANCEL_DOC_FORM_KEY[docType] as AccessFormKey;
    if (!approveByForm.has(form)) {
      approveByForm.set(form, await hasFormAccess(user, form, 'approve'));
    }
    s.step.needsApproval = !approveByForm.get(form);
  }
}
