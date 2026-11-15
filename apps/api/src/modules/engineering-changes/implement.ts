// ADR-291 Step 4 — E. Implement an approved ECR (POST /ecrs/:id/implement).
// One transaction:
//   1. approved → implemented, conditional (§20.2) — a second implement waits
//      on the ECR row lock and is refused;
//   2. per Job Card impact
//        move_new, moveQty = the whole untouched order → the old PRO is short
//          closed (shortCloseProductionOrderTx) and the new PRO takes all of it;
//        move_new, moveQty > 0 → reduceProductionOrderQty on the old PRO (its
//          locks re-check "not started" and "no running session", §20.3), the
//          plan moves to the new Rev, and a new PRO + Job Card for moveQty is
//          built on the new Rev's APPROVED Route Card (createProductionOrderTx).
//          A Job Card with no PRO (hand-raised JW card) is skipped with a note;
//        keep_old / move_new → this ECR's holds on that Job Card are released
//          (decide_later keeps them);
//   3. every SO / JWSO line on the old Rev gets the new Rev through the line-rev
//      path (applyLineRevChange, ecrImplement 'split' — or 'move_all' for a
//      documentation-only change, which moves the open work as the old D1 did);
//   4. implemented → closed when no hold of this ECR is left.

import { ECR_STATUS_LABELS, type Ecr, type EcrActionInput, itemRevLabel } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { ConflictError, ValidationError } from '../../lib/errors';
import { assertRevReleasedForWork } from '../../lib/item-revision';
import { releaseOpHolds } from '../../lib/jc-op-hold';
import { applyLineRevChange } from '../item-revisions/line-rev';
import {
  assertWholeOrderUntouched,
  reduceProductionOrderQty,
} from '../production-orders/reduce-qty';
import { createProductionOrderTx, shortCloseProductionOrderTx } from '../production-orders/service';
import { type EcrRow, readEcrDetail, readEcrRow, sameVersion } from './read';
import { assertSameVersion, logEcr, refuseChanged, requireCompany, stateText } from './service';
import { closeEcrTx } from './workflow';

interface ImpactRow {
  id: string;
  docType: string;
  soLineId: string | null;
  jwLineId: string | null;
  jobCardId: string | null;
  label: string;
  disposition: string | null;
  moveQty: number;
}

async function setImpact(
  tx: DbTransaction,
  id: string,
  userId: string,
  v: { note?: string; poId?: string; jcId?: string },
): Promise<void> {
  await tx.execute(sql`
    UPDATE public.engineering_change_impacts
       SET note = COALESCE(${v.note ?? null}, note),
           new_production_order_id = COALESCE(${v.poId ?? null}::uuid, new_production_order_id),
           new_job_card_id = COALESCE(${v.jcId ?? null}::uuid, new_job_card_id),
           updated_at = now(), updated_by = ${userId}::uuid
     WHERE id = ${id}::uuid`);
}

/** Move `n` not-started pieces of one Job Card to the new Rev. */
async function moveToNewRev(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  e: EcrRow,
  m: ImpactRow,
): Promise<string> {
  const [jc] = (await tx.execute(sql`
    SELECT jc.production_order_id AS "poId", po.plan_id AS "planId", po.code AS "poCode",
           to_char(po.target_date, 'YYYY-MM-DD') AS "targetDate", po.actual_size AS "actualSize",
           po.order_qty AS "orderQty"
      FROM public.job_cards jc
      LEFT JOIN public.production_orders po ON po.id = jc.production_order_id AND po.deleted_at IS NULL
     WHERE jc.id = ${m.jobCardId}::uuid AND jc.deleted_at IS NULL
     LIMIT 1`)) as unknown as Array<{
    poId: string | null;
    planId: string | null;
    poCode: string | null;
    targetDate: string | null;
    actualSize: string | null;
    orderQty: number | null;
  }>;
  if (!jc?.poId || !jc.planId) {
    const note = 'Move by hand — no Production Order';
    await setImpact(tx, m.id, user.id, { note });
    return `${m.label}: ${note}`;
  }
  const toLabel = itemRevLabel(e.itemCode, e.toRev);
  const [rc] = (await tx.execute(sql`
    SELECT id FROM public.route_cards
     WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
       AND item_revision_id = ${e.toItemRevisionId}::uuid AND approval_status = 'approved'
     LIMIT 1`)) as unknown as Array<{ id: string }>;
  if (!rc) {
    throw new ValidationError(
      `No approved Route Card for ${toLabel} — make and approve it before Implement (${m.label} moves ${m.moveQty} to it).`,
    );
  }
  const n = Number(m.moveQty);
  // The whole order moves only when it is untouched: the old order is short
  // closed through THE short-close writer (§20.1) and its pieces go back to the
  // plan's Pending, which the new order below takes. Otherwise at least one
  // piece stays and the order's qty is lowered.
  const whole = n >= Number(jc.orderQty ?? 0);
  if (whole) {
    await assertWholeOrderUntouched(tx, companyId, jc.poId, n);
    await shortCloseProductionOrderTx(
      tx,
      jc.poId,
      `ECR ${e.code}: all ${n} moved to ${toLabel}`,
      user,
      companyId,
    );
  } else {
    await reduceProductionOrderQty(tx, {
      companyId,
      productionOrderId: jc.poId,
      qty: n,
      reason: `ECR ${e.code}`,
      user,
    });
  }
  // The plan's future work is on the new Rev; the old PRO keeps its own Rev.
  await tx.execute(sql`
    UPDATE public.plans SET item_revision_id = ${e.toItemRevisionId}::uuid,
           updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${jc.planId}::uuid AND company_id = ${companyId}::uuid`);
  const po = await createProductionOrderTx(
    tx,
    {
      planId: jc.planId,
      routeCardId: rc.id,
      targetDate: jc.targetDate!,
      orderQty: n,
      // The pieces' material was confirmed on the old order (ADR-182).
      rawMaterialAvailable: true,
      actualSize: jc.actualSize,
      remarks: `ECR ${e.code}: ${n} moved from ${jc.poCode} (${m.label}) to ${toLabel}`,
    },
    user,
    companyId,
    jc.actualSize,
  );
  await setImpact(tx, m.id, user.id, {
    note: `${n} moved to ${po.code} / ${po.jcCodeText}${whole ? ` (${jc.poCode} short closed)` : ''}`,
    poId: po.id,
    jcId: po.jobCardId,
  });
  return `${m.label}: ${n} → ${po.code} / ${po.jcCodeText}`;
}

/** Give each SO / JWSO line on the old Rev the new Rev (line-rev path). */
async function moveLines(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  e: EcrRow,
  impacts: ImpactRow[],
): Promise<string[]> {
  const out: string[] = [];
  const [to] = (await tx.execute(sql`
    SELECT rev, drawing_file_path AS "file" FROM public.item_revisions
     WHERE id = ${e.toItemRevisionId}::uuid LIMIT 1`)) as unknown as Array<{
    rev: string;
    file: string | null;
  }>;
  for (const m of impacts) {
    const kind = m.docType === 'so_line' ? 'so' : m.docType === 'jw_line' ? 'jw' : null;
    if (!kind || !to) continue;
    const lineId = (kind === 'so' ? m.soLineId : m.jwLineId)!;
    const tbl = kind === 'so' ? sql.raw('sales_order_lines') : sql.raw('job_work_order_lines');
    const hdr = kind === 'so' ? sql.raw('sales_orders') : sql.raw('job_work_orders');
    const fk = kind === 'so' ? sql.raw('sales_order_id') : sql.raw('job_work_order_id');
    const [line] = (await tx.execute(sql`
      SELECT l.id, l.line_no AS "lineNo", l.item_id AS "itemId",
             l.item_revision_id AS "revId", h.id AS "orderId", h.code
        FROM public.${tbl} l JOIN public.${hdr} h ON h.id = l.${fk}
       WHERE l.id = ${lineId}::uuid AND l.deleted_at IS NULL
       LIMIT 1
         FOR UPDATE OF l`)) as unknown as Array<{
      id: string;
      lineNo: number;
      itemId: string;
      revId: string | null;
      orderId: string;
      code: string;
    }>;
    if (!line || line.revId !== e.fromItemRevisionId) continue;
    try {
      await applyLineRevChange(tx, user, companyId, {
        kind,
        orderId: line.orderId,
        docCode: line.code,
        lineId: line.id,
        lineNo: line.lineNo,
        itemId: line.itemId,
        fromId: e.fromItemRevisionId,
        toId: e.toItemRevisionId!,
        reason: `ECR ${e.code}: ${e.description}`,
        ecrImplement: e.classification === 'documentation_only' ? 'move_all' : 'split',
      });
    } catch (err) {
      // A line whose Job Cards are all closed keeps its Rev (a new Rev = a new line).
      if (err instanceof ValidationError && /All Job Cards are closed/.test(err.message)) {
        await setImpact(tx, m.id, user.id, { note: 'Rev kept — all Job Cards closed' });
        continue;
      }
      throw err;
    }
    await tx.execute(sql`
      UPDATE public.${tbl}
         SET revision = ${to.rev}, item_revision_id = ${e.toItemRevisionId}::uuid,
             drawing_file_path = ${to.file}, updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${line.id}::uuid`);
    await setImpact(tx, m.id, user.id, { note: `Rev → ${itemRevLabel(e.itemCode, to.rev)}` });
    out.push(m.label);
  }
  return out;
}

export async function implementEcr(
  id: string,
  input: EcrActionInput,
  user: AuthContext,
): Promise<Ecr> {
  await requireAnyFormAccess(user, [
    ['ecr_create', 'edit'],
    ['ecr_create', 'advance'],
  ]);
  const companyId = requireCompany(user);
  // A new PRO / JC number can collide with a save on another plan — the whole
  // transaction re-runs (as createProductionOrder).
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const e = await readEcrRow(tx, companyId, id, true);
      if (e.status !== 'approved') {
        throw new ConflictError(
          `Cannot implement ${e.code}: it ${await stateText(tx, e)}. Reload the page.`,
        );
      }
      await assertSameVersion(tx, e, input.expectedUpdatedAt);
      if (e.customerApproval === 'pending') {
        throw new ValidationError(
          `${e.code} is waiting for the customer's approval — record it first.`,
        );
      }
      if (e.classification !== 'non_interchangeable') {
        await assertRevReleasedForWork(tx, companyId, e.toItemRevisionId);
      }
      const done = (await tx.execute(sql`
        UPDATE public.engineering_changes
           SET status = 'implemented', implemented_at = now(), implemented_by = ${user.id}::uuid,
               updated_at = now(), updated_by = ${user.id}::uuid
         WHERE id = ${id}::uuid AND status = 'approved' AND ${sameVersion(e)}
        RETURNING id`)) as unknown as unknown[];
      if (done.length === 0) await refuseChanged(tx, companyId, id, 'implement');

      const impacts = (await tx.execute(sql`
        SELECT id, doc_type AS "docType", so_line_id AS "soLineId", jw_line_id AS "jwLineId",
               job_card_id AS "jobCardId", label, disposition, move_qty AS "moveQty"
          FROM public.engineering_change_impacts
         WHERE ecr_id = ${id}::uuid AND deleted_at IS NULL
         ORDER BY label`)) as unknown as ImpactRow[];

      const notes: string[] = [];
      for (const m of impacts) {
        if (m.docType !== 'job_card' || !m.jobCardId) continue;
        const moving =
          e.classification === 'interchangeable' &&
          m.disposition === 'move_new' &&
          Number(m.moveQty) > 0;
        if (moving) notes.push(await moveToNewRev(tx, user, companyId, e, m));
        // keep_old and move_new: this ECR's holds on the card are lifted — the
        // moved pieces left it, the rest carry on at the old Rev. Only a
        // decide_later card stays held.
        if (m.disposition === 'keep_old' || m.disposition === 'move_new') {
          const ops = (await tx.execute(sql`
            SELECT id FROM public.jc_ops
             WHERE job_card_id = ${m.jobCardId}::uuid AND hold_ecr_id = ${id}::uuid
               AND deleted_at IS NULL`)) as unknown as Array<{ id: string }>;
          if (ops.length > 0) {
            await releaseOpHolds(tx, {
              companyId,
              jcOpIds: ops.map((o) => o.id),
              note:
                m.disposition === 'keep_old'
                  ? `ECR ${e.code}: kept on ${itemRevLabel(e.itemCode, e.fromRev)}`
                  : `ECR ${e.code}: ${Number(m.moveQty)} moved to ${itemRevLabel(e.itemCode, e.toRev)}, the rest carry on at ${itemRevLabel(e.itemCode, e.fromRev)}`,
              userId: user.id,
            });
          }
        }
      }
      const lines =
        e.classification === 'non_interchangeable'
          ? []
          : await moveLines(tx, user, companyId, e, impacts);

      await logEcr(
        tx,
        user,
        companyId,
        e,
        'IMPLEMENT',
        `${e.code} implemented` +
          (notes.length > 0 ? ` — ${notes.join('; ')}` : '') +
          (lines.length > 0 ? ` — lines moved to the new Rev: ${lines.join(', ')}` : ''),
        { before: ECR_STATUS_LABELS.approved, after: ECR_STATUS_LABELS.implemented },
      );
      await closeEcrTx(tx, user, companyId, await readEcrRow(tx, companyId, id, true));
      return readEcrDetail(tx, companyId, id);
    }),
  );
}
