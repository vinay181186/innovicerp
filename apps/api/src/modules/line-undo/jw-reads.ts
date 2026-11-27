// ADR-324 line undo (P1) — the line-level reads of ONE JWSO line and the
// pending / Approve-tick marking, split out of jw-steps.ts (CLAUDE.md §12).
// No logic of their own: jw-steps.ts calls them at the same point as before.

import {
  CANCEL_DOC_FORM_KEY,
  type AccessFormKey,
  type CancelDocType,
  ONE_STEP_CANCEL_DOC_TYPES,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { type BuiltStep, ids, q } from './step-kit';

export interface JwLinePlan {
  id: string;
  code: string;
  jcId: string | null;
  dpPrId: string | null;
  foPrId: string | null;
}

/** JW Invoices, JW Returns, Customer Material Returns and plans of the line,
 *  newest first — one round trip for the four line-level reads. */
export async function readJwLineDocs(
  tx: DbTransaction,
  companyId: string,
  jwLineId: string,
): Promise<
  [
    { id: string; code: string }[],
    { id: string; code: string }[],
    { id: string; code: string }[],
    JwLinePlan[],
  ]
> {
  const L = sql`${jwLineId}::uuid`;
  const C = sql`${companyId}::uuid`;
  const invoicesP = q<{ id: string; code: string }>(
    tx,
    sql`SELECT id, code FROM public.jw_invoices
         WHERE job_work_order_line_id = ${L} AND company_id = ${C}
           AND deleted_at IS NULL AND status::text <> 'cancelled'
         ORDER BY created_at DESC`,
  );
  const returnsP = q<{ id: string; code: string }>(
    tx,
    sql`SELECT id, code FROM public.jw_return_challans
         WHERE job_work_order_line_id = ${L} AND company_id = ${C}
           AND deleted_at IS NULL AND status <> 'cancelled'
         ORDER BY created_at DESC`,
  );
  const cmrsP = q<{ id: string; code: string }>(
    tx,
    sql`SELECT c.id, c.code FROM public.customer_material_returns c
         WHERE c.company_id = ${C} AND c.deleted_at IS NULL AND c.status <> 'cancelled'
           AND EXISTS (SELECT 1 FROM public.customer_material_return_lines cl
                        WHERE cl.return_id = c.id AND cl.jw_line_id = ${L} AND cl.deleted_at IS NULL)
         ORDER BY c.created_at DESC`,
  );
  const plansP = q<JwLinePlan>(
    tx,
    sql`SELECT id, code, jc_id AS "jcId", dp_pr_id AS "dpPrId", fo_pr_id AS "foPrId"
          FROM public.plans
         WHERE jw_line_id = ${L} AND company_id = ${C}
           AND deleted_at IS NULL AND plan_status <> 'cancelled'
         ORDER BY created_at DESC`,
  );
  // One round trip for the four line-level reads.
  return Promise.all([invoicesP, returnsP, cmrsP, plansP]);
}

/** A pending cancel request → 'waiting_approval'; needsApproval from the
 *  caller's Approve tick on the type's page (one-step types never wait). */
export async function markPendingAndApproval(
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
