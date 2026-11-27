// ADR-324 line undo — the Production Order and plan steps of a JWSO line's
// Undo list. Each reads its document's OWN refusal rule
// (productionOrderCancelBlockers / planCancelBlockers); what the list already
// lists as its own step is left out, everything else becomes a 'manual' step
// before the cancel, so a step is 'todo' only when nothing it names is open.

import type { CancelBlocker } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { planCancelBlockers } from '../plans/cancel';
import { productionOrderCancelBlockers } from '../production-orders/cancel';
import { purchaseRequestCancelBlockers } from '../purchase-requests/cancel';
import { type BuiltStep, cancelStep, manualStep, q } from './step-kit';

export interface ProRow {
  id: string;
  code: string;
  planId: string;
  jobCardId: string | null;
  status: string;
}

export interface ListedCodes {
  jcCodes: Set<string>;
  proCodes: Set<string>;
  jwReturnCodes: Set<string>;
}

const SHORT_CLOSED = 'short-closed — Short-close the line instead';

/** Manual steps for blockers, one per document (a document named twice —
 *  by the card and by its order — is listed once). */
export function manualSteps(
  keyBase: string,
  docId: string,
  blockers: readonly CancelBlocker[],
  seen: Set<string>,
): BuiltStep[] {
  const out: BuiltStep[] = [];
  blockers.forEach((b, i) => {
    const id = `${b.docLabel}|${b.docNo}`;
    if (seen.has(id)) return;
    seen.add(id);
    const s = manualStep(`manual:${keyBase}:${i}`, docId, b);
    if (b.docLabel === 'Production Order' && /short/i.test(b.reason)) {
      s.step.manualReason = SHORT_CLOSED;
    }
    out.push(s);
  });
  return out;
}

/** The Production Order: its own blockers (its cards' are listed with the
 *  cards), then its cancel — once per order, after all its cards. */
export async function proSteps(
  tx: DbTransaction,
  companyId: string,
  pro: ProRow,
  listed: ListedCodes,
  seen: Set<string>,
): Promise<BuiltStep[]> {
  const blockers = (await productionOrderCancelBlockers(tx, companyId, pro.id)).filter(
    (b) =>
      // "<JC>: …" — a card's own blocker, already listed with that card.
      ![...listed.jcCodes].some((c) => b.reason.startsWith(`${c}: `)) &&
      !(b.docLabel === 'Job Card' && listed.jcCodes.has(b.docNo)),
  );
  const own = blockers.map((b) =>
    b.docLabel === 'Production Order' && pro.status === 'short_closed'
      ? { ...b, reason: `${pro.code} is short closed` }
      : b,
  );
  return [
    ...manualSteps(`pro:${pro.id}`, pro.id, own, seen),
    cancelStep(
      'production_order',
      pro.id,
      pro.code,
      `/production-orders/${pro.id}`,
      pro.jobCardId
        ? 'Cancel the Production Order — its Job Card is cancelled with it'
        : 'Cancel the Production Order',
    ),
  ];
}

/** The plan: its Direct Purchase / Full Outsource PR as its own step (or
 *  manual when the PR cannot be cancelled), its other blockers manual, then
 *  the plan cancel. */
export async function planSteps(
  tx: DbTransaction,
  companyId: string,
  plan: { id: string; code: string; dpPrId: string | null; foPrId: string | null },
  listed: ListedCodes,
  seen: Set<string>,
): Promise<BuiltStep[]> {
  const out: BuiltStep[] = [];
  const prIds = [plan.dpPrId, plan.foPrId].filter((v): v is string => v != null);
  const prs =
    prIds.length > 0
      ? await q<{ id: string; code: string }>(
          tx,
          sql`SELECT id, code FROM public.purchase_requests
               WHERE id = ANY(${sql.param(prIds)}::uuid[]) AND company_id = ${companyId}::uuid
                 AND deleted_at IS NULL AND status <> 'cancelled'
               ORDER BY created_at DESC`,
        )
      : [];
  for (const pr of prs) {
    const prBlockers = await purchaseRequestCancelBlockers(tx, companyId, pr.id);
    if (prBlockers.length === 0) {
      out.push(
        cancelStep(
          'purchase_request',
          pr.id,
          pr.code,
          `/purchase-requests/${pr.id}`,
          'Cancel the Purchase Request — the plan goes back to Planned',
        ),
      );
    } else {
      out.push(...manualSteps(`pr:${pr.id}`, pr.id, prBlockers, seen));
    }
  }
  const prCodes = new Set(prs.map((p) => p.code));
  const rest = (await planCancelBlockers(tx, companyId, plan.id)).filter(
    (b) =>
      !(b.docLabel === 'Production Order' && listed.proCodes.has(b.docNo)) &&
      !(b.docLabel === 'Job Card' && listed.jcCodes.has(b.docNo)) &&
      !(b.docLabel === 'Purchase Request' && prCodes.has(b.docNo)),
  );
  out.push(...manualSteps(`plan:${plan.id}`, plan.id, rest, seen));
  out.push(cancelStep('plan', plan.id, plan.code, `/plans/${plan.id}`, 'Cancel the plan'));
  return out;
}
