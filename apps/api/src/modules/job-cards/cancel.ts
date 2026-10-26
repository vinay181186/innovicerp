// ADR-235 Phase C (part 2) — Job Card in the standard Cancel.
//
// A Job Card may be cancelled ONLY while nothing was done on it: no production
// / QC entry (net of reversals), no running operation, no OSP PR / PO / DC, no
// NC or rework child, no Item / Tool / Party Material Issue, no stock booked to
// it or credited from it, no JW Return. Never cascade — each live document is
// named as a blocker ("cancel PR-x first").
//
// A card built by a Production Order is cancelled THROUGH that order (the
// Production Order cancel calls cancelJobCardTx with viaProductionOrder: true,
// in its own transaction); asked directly, it is refused and the order named.
//
// The cancel stamps header + live ops with ONE softDeleteStamp (job_cards.
// deleted_at is read by ~76 files — every live reader keeps skipping the card
// with no change), plus cancel_reason / cancelled_at (same instant) /
// cancelled_by on the header (0221). The list (includeCancelled) and the
// detail read cancelled_at to show it as Cancelled, with the ops whose
// deleted_at equals the header's. The SO / JWSO line's "in Job Cards" balance
// is computed over live cards, so it frees by itself.
//
// Plans (owner decision): a card that a live plan made (plans.jc_id = card)
// and that no Production Order built is BLOCKED — "cancel the plan first"
// (Plan cancel already treats a non-live card as no blocker). A Production
// Order's card is cancelled through the order, which re-points the plan.
//
// While a cancel is PENDING on the card or on the Production Order that built
// it, every write on the card refuses (assertJobCardNotPendingCancel). New
// work racing a cancel's commit (Item / Tool / Party Material Issue) takes
// lockLiveJobCardForShare AFTER its own locks: it waits for the cancel and
// then sees the card gone.
//
// LOCK ORDER — jc_ops (id order) FIRST, then job_cards: the order op-entry
// (jc_ops lock, then job_cards in finishJc) and updateJobCardTx (writes jc_ops
// first, ADR-220 note) already use, so a cancel never deadlocks against them.
//
// One refusal rule — jobCardCancelBlockers — used by the preview, the Cancel
// Request service, the worker under its locks, and deleteJobCard.

import { ActivityAction, type CancelBlocker, type CancelEffect, opSrNo } from '@innovic/shared';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { jcOps, jobCards } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { softDeleteStamp } from '../../lib/audit-trail';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { jcEffectiveQtySql } from '../../lib/jc-effective-qty';
import {
  findStoppedProductionOrder,
  productionOrderStoppedMessage,
} from '../../lib/production-order-stop';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { assertNoPendingCancel } from '../cancel-requests/pending-guard';

export interface JobCardCancelHead {
  id: string;
  code: string;
  cancelled: boolean;
  productionOrderId: string | null;
}

const rows = <T>(tx: DbTransaction, q: SQL): Promise<T[]> =>
  tx.execute(q) as unknown as Promise<T[]>;

/** Read the card — cancelled AND trashed ones included (`cancelled` is true
 *  for both: neither is a live document). `forUpdate` locks its jc_ops (id
 *  order) and then the card (see LOCK ORDER). null = not in this company. */
export async function lockJobCardForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<JobCardCancelHead | null> {
  if (forUpdate) {
    await tx.execute(sql`
      SELECT id FROM public.jc_ops
       WHERE job_card_id = ${id}::uuid AND company_id = ${companyId}::uuid
       ORDER BY id FOR UPDATE
    `);
  }
  const r = (
    await rows<{
      id: string;
      code: string;
      deletedAt: unknown;
      cancelledAt: unknown;
      productionOrderId: string | null;
    }>(
      tx,
      sql`
        SELECT id, code, deleted_at AS "deletedAt", cancelled_at AS "cancelledAt",
               production_order_id AS "productionOrderId"
          FROM public.job_cards
         WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
         ${forUpdate ? sql`FOR UPDATE` : sql``}
      `,
    )
  )[0];
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    cancelled: r.cancelledAt != null || r.deletedAt != null,
    productionOrderId: r.productionOrderId ?? null,
  };
}

/** ADR-235 — no write on a card while a Cancel Request is pending on it OR on
 *  the Production Order that built it (that cancel takes the card with it).
 *  Replaces the bare assertNoPendingCancel('job_card') on every card writer. */
export async function assertJobCardNotPendingCancel(
  tx: DbTransaction,
  jobCardId: string,
): Promise<void> {
  await assertNoPendingCancel(tx, 'job_card', jobCardId);
  for (const p of await rows<{ id: string }>(
    tx,
    sql`
      SELECT jc.production_order_id AS id FROM public.job_cards jc
       WHERE jc.id = ${jobCardId}::uuid AND jc.production_order_id IS NOT NULL
      UNION
      SELECT po.id FROM public.production_orders po
       WHERE po.job_card_id = ${jobCardId}::uuid AND po.deleted_at IS NULL
    `,
  )) {
    await assertNoPendingCancel(tx, 'production_order', p.id);
  }
}

/** ADR-235 — new work attaching to a card (Item / Tool / Party Material
 *  Issue) takes a SHARE lock on the live card, AFTER its own locks (the cancel
 *  locks jc_ops then job_cards and nothing else, so job_cards last never
 *  closes a cycle). A cancel committing first leaves no live row: refused. A
 *  cancel arriving second waits, then its blocker re-check sees the new work. */
export async function lockLiveJobCardForShare(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string,
  code: string,
): Promise<void> {
  const r = await rows<{ id: string }>(
    tx,
    sql`
      SELECT id FROM public.job_cards
       WHERE id = ${jobCardId}::uuid AND company_id = ${companyId}::uuid
         AND deleted_at IS NULL
       FOR SHARE
    `,
  );
  if (r.length === 0) {
    throw new ConflictError(
      `Job Card ${code} was cancelled or moved to Trash just now. Refresh and pick the Job Card again.`,
    );
  }
}

/** Every PO line raised for one of this card's ops (any of the three links). */
const cardPoLineIds = (id: string) => sql`(
  SELECT o.outsource_po_line_id FROM public.jc_ops o
   WHERE o.job_card_id = ${id}::uuid AND o.outsource_po_line_id IS NOT NULL
  UNION
  SELECT l.purchase_order_line_id FROM public.jc_op_po_lines l
    JOIN public.jc_ops o ON o.id = l.jc_op_id
   WHERE o.job_card_id = ${id}::uuid AND l.deleted_at IS NULL
  UNION
  SELECT p.id FROM public.purchase_order_lines p
    JOIN public.jc_ops o ON o.id = p.source_jc_op_id
   WHERE o.job_card_id = ${id}::uuid
)`;

const opNo = (seq: number): string => `Op ${opSrNo(seq)}`;

/**
 * THE Job Card cancel refusal rule (one place — the preview, the Cancel
 * Request service, the worker under its locks, the Production Order cancel
 * and deleteJobCard). `viaProductionOrder` skips ONLY the "built by
 * Production Order X" blocker. A cancelled / trashed / missing card has
 * nothing to refuse (the lock step says so).
 */
export async function jobCardCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
  opts: { viaProductionOrder?: boolean } = {},
): Promise<CancelBlocker[]> {
  const head = await lockJobCardForCancel(tx, companyId, id, false);
  if (!head || head.cancelled) return [];
  const out: CancelBlocker[] = [];
  const jcHref = `/job-cards/${id}`;
  const c = sql`${companyId}::uuid`;

  // Production / QC entries per op, net of reversals (negative rows).
  for (const r of await rows<{ opSeq: number; qty: number }>(
    tx,
    sql`
      SELECT o.op_seq AS "opSeq", SUM(l.qty + l.reject_qty)::int AS qty
        FROM public.op_log l JOIN public.jc_ops o ON o.id = l.jc_op_id
       WHERE o.job_card_id = ${id}::uuid AND o.deleted_at IS NULL
         AND l.log_type <> 'start'
       GROUP BY o.id, o.op_seq HAVING SUM(l.qty + l.reject_qty) > 0
       ORDER BY o.op_seq
    `,
  )) {
    out.push({
      docLabel: 'Op Entry',
      docNo: `${head.code} ${opNo(r.opSeq)}`,
      href: jcHref,
      reason: `${opNo(r.opSeq)} has production / QC entries (${r.qty} pcs) — reverse them first (Op Entry)`,
    });
  }

  for (const r of await rows<{ opSeq: number }>(
    tx,
    sql`
      SELECT DISTINCT o.op_seq AS "opSeq"
        FROM public.running_ops ro JOIN public.jc_ops o ON o.id = ro.jc_op_id
       WHERE o.job_card_id = ${id}::uuid AND ro.status = 'running'
       ORDER BY o.op_seq
    `,
  )) {
    out.push({
      docLabel: 'Op Entry',
      docNo: `${head.code} ${opNo(r.opSeq)}`,
      href: jcHref,
      reason: `${opNo(r.opSeq)} is running — stop it first (Op Entry)`,
    });
  }

  // PRs raised for an op (the auto-raised OSP PR included) — never cascaded.
  for (const r of await rows<{ id: string; code: string; opSeq: number | null }>(
    tx,
    sql`
      SELECT pr.id, pr.code, MIN(o.op_seq)::int AS "opSeq"
        FROM public.purchase_requests pr
        JOIN public.jc_ops o ON o.id = pr.source_jc_op_id OR o.outsource_pr_id = pr.id
       WHERE o.job_card_id = ${id}::uuid AND pr.company_id = ${c}
         AND pr.deleted_at IS NULL AND pr.status <> 'cancelled'
       GROUP BY pr.id, pr.code ORDER BY pr.code
    `,
  )) {
    const op = r.opSeq != null ? opNo(r.opSeq) : 'an operation';
    out.push({
      docLabel: 'Purchase Request',
      docNo: r.code,
      href: `/purchase-requests/${r.id}`,
      reason: `raised for ${op} — cancel ${r.code} first`,
    });
  }

  for (const r of await rows<{ id: string; code: string }>(
    tx,
    sql`
      SELECT DISTINCT po.id, po.code
        FROM public.purchase_order_lines pol
        JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
       WHERE pol.id IN ${cardPoLineIds(id)} AND pol.deleted_at IS NULL
         AND po.company_id = ${c} AND po.deleted_at IS NULL AND po.status <> 'cancelled'
       ORDER BY po.code
    `,
  )) {
    out.push({
      docLabel: 'Purchase Order',
      docNo: r.code,
      href: `/purchase-orders/${r.id}`,
      reason: `raised for this card's OSP operation — cancel ${r.code} first`,
    });
  }

  for (const r of await rows<{ id: string; code: string }>(
    tx,
    sql`
      SELECT dc.id, dc.code FROM public.delivery_challans dc
       WHERE dc.company_id = ${c} AND dc.deleted_at IS NULL AND dc.status <> 'cancelled'
         AND (dc.job_card_id = ${id}::uuid OR EXISTS (
           SELECT 1 FROM public.delivery_challan_lines dcl
            WHERE dcl.delivery_challan_id = dc.id AND dcl.deleted_at IS NULL
              AND dcl.purchase_order_line_id IN ${cardPoLineIds(id)}))
       ORDER BY dc.code
    `,
  )) {
    out.push({
      docLabel: 'DC',
      docNo: r.code,
      href: `/delivery-challans/${r.id}`,
      reason: `pieces sent out on ${r.code} — cancel it first`,
    });
  }

  for (const r of await rows<{ id: string; code: string; isChild: boolean }>(
    tx,
    sql`
      SELECT nc.id, nc.code, (nc.child_job_card_id = ${id}::uuid) AS "isChild"
        FROM public.nc_register nc
       WHERE nc.company_id = ${c} AND nc.deleted_at IS NULL
         AND (nc.job_card_id = ${id}::uuid OR nc.child_job_card_id = ${id}::uuid
              OR nc.jc_op_id IN (SELECT o.id FROM public.jc_ops o WHERE o.job_card_id = ${id}::uuid))
       ORDER BY nc.code
    `,
  )) {
    out.push({
      docLabel: 'NC',
      docNo: r.code,
      href: `/nc-register/${r.id}`,
      reason: r.isChild
        ? `this card was raised by ${r.code} (rework / repair) — decide it on the NC`
        : `raised on this card — cancel ${r.code} first`,
    });
  }

  for (const r of await rows<{ id: string; code: string }>(
    tx,
    sql`
      SELECT ch.id, ch.code FROM public.job_cards ch
       WHERE ch.parent_job_card_id = ${id}::uuid AND ch.company_id = ${c} AND ch.deleted_at IS NULL
       ORDER BY ch.code
    `,
  )) {
    out.push({
      docLabel: 'Job Card',
      docNo: r.code,
      href: `/job-cards/${r.id}`,
      reason: `rework / repair card raised off this one — cancel ${r.code} first`,
    });
  }

  for (const r of await rows<{ code: string }>(
    tx,
    sql`
      SELECT code FROM public.store_issues
       WHERE job_card_id = ${id}::uuid AND company_id = ${c}
         AND deleted_at IS NULL AND reversed_at IS NULL
       ORDER BY code
    `,
  )) {
    out.push({
      docLabel: 'Item Issue',
      docNo: r.code,
      href: `/issue-register?search=${encodeURIComponent(r.code)}`,
      reason: `material issued to this card — reverse ${r.code} first`,
    });
  }

  for (const r of await rows<{ code: string }>(
    tx,
    sql`
      SELECT code FROM public.tool_issues
       WHERE job_card_id = ${id}::uuid AND company_id = ${c}
         AND deleted_at IS NULL AND cancelled_at IS NULL AND return_status <> 'cancelled'
       ORDER BY code
    `,
  )) {
    out.push({
      docLabel: 'Tool Issue',
      docNo: r.code,
      href: null,
      reason: `tools issued against this card — cancel ${r.code} first`,
    });
  }

  // ADR-203 — the rule deleteJobCard always had: pieces still held on the card.
  for (const r of await rows<{ code: string }>(
    tx,
    sql`
      SELECT code FROM public.party_material_issues
       WHERE job_card_id = ${id}::uuid AND company_id = ${c} AND deleted_at IS NULL
         AND qty - returned_to_store_qty > 0
       ORDER BY code
    `,
  )) {
    out.push({
      docLabel: 'Party Material Issue',
      docNo: r.code,
      href: `/party-material?search=${encodeURIComponent(r.code)}`,
      reason: 'customer material is on this card — return it to store or cancel the issue first',
    });
  }

  for (const r of await rows<{ soCode: string; lineNo: number; qty: number }>(
    tx,
    sql`
      SELECT so_code_text AS "soCode", line_no AS "lineNo",
             (qty - consumed_qty - released_qty)::int AS qty
        FROM public.so_stock_reservations
       WHERE job_card_id = ${id}::uuid AND company_id = ${c} AND deleted_at IS NULL
         AND status IN ('active', 'partially_consumed')
       ORDER BY so_code_text, line_no
    `,
  )) {
    out.push({
      docLabel: 'Stock Booking',
      docNo: `${r.soCode} Ln ${r.lineNo}`,
      href: null,
      reason: `${r.qty} booked from this card — release the booking first`,
    });
  }

  for (const r of await rows<{ code: string; jwId: string }>(
    tx,
    sql`
      SELECT code, job_work_order_id AS "jwId" FROM public.jw_return_challans
       WHERE job_card_id = ${id}::uuid AND company_id = ${c}
         AND deleted_at IS NULL AND status = 'issued'
       ORDER BY code
    `,
  )) {
    out.push({
      docLabel: 'JW Return',
      docNo: r.code,
      href: `/job-work-orders/${r.jwId}`,
      reason: `pieces from this card returned on ${r.code} — cancel it first`,
    });
  }

  // QC reports uploaded against the card, one of its ops or one of its entries.
  for (const r of await rows<{ fileName: string; docType: string }>(
    tx,
    sql`
      SELECT d.file_name AS "fileName", d.doc_type AS "docType"
        FROM public.qc_documents d
       WHERE d.company_id = ${c} AND d.deleted_at IS NULL
         AND (d.job_card_id = ${id}::uuid
              OR d.jc_op_id IN (SELECT o.id FROM public.jc_ops o WHERE o.job_card_id = ${id}::uuid)
              OR d.op_log_id IN (
                SELECT l.id FROM public.op_log l JOIN public.jc_ops o ON o.id = l.jc_op_id
                 WHERE o.job_card_id = ${id}::uuid))
       ORDER BY d.file_name
    `,
  )) {
    out.push({
      docLabel: 'QC Report',
      docNo: r.fileName,
      href: jcHref,
      reason: `QC report uploaded (${r.docType}) — delete it first`,
    });
  }

  for (const r of await rows<{ opSeq: number; inspector: string }>(
    tx,
    sql`
      SELECT o.op_seq AS "opSeq", a.inspector_name AS inspector
        FROM public.qc_assignments a JOIN public.jc_ops o ON o.id = a.jc_op_id
       WHERE o.job_card_id = ${id}::uuid AND o.deleted_at IS NULL
         AND a.company_id = ${c} AND a.deleted_at IS NULL
       ORDER BY o.op_seq
    `,
  )) {
    out.push({
      docLabel: 'QC Assignment',
      docNo: `${head.code} ${opNo(r.opSeq)}`,
      href: jcHref,
      reason: `inspector ${r.inspector} assigned to ${opNo(r.opSeq)} — remove the assignment first`,
    });
  }

  // Stock credited at the last op's QC accept (source_ref "<JC code> Op #NN").
  const credited = (
    await rows<{ qty: number | null }>(
      tx,
      sql`
        SELECT SUM(CASE WHEN txn_type = 'in' THEN qty ELSE -qty END)::float AS qty
          FROM public.store_transactions
         WHERE company_id = ${c} AND source_type = 'qc_accept'
           AND left(source_ref, ${head.code.length + 5}) = ${`${head.code} Op #`}
      `,
    )
  )[0];
  if (credited?.qty != null && Number(credited.qty) > 0) {
    out.push({
      docLabel: 'Stock',
      docNo: head.code,
      href: jcHref,
      reason: `${Number(credited.qty)} credited to stock from this card`,
    });
  }

  if (!opts.viaProductionOrder) {
    const pros = await rows<{ id: string; code: string }>(
      tx,
      sql`
        SELECT id, code FROM public.production_orders
         WHERE company_id = ${c} AND deleted_at IS NULL
           AND (job_card_id = ${id}::uuid
                OR id = ${head.productionOrderId ?? null}::uuid)
         ORDER BY code
      `,
    );
    for (const r of pros) {
      out.push({
        docLabel: 'Production Order',
        docNo: r.code,
        href: `/production-orders/${r.id}`,
        reason: `built by Production Order ${r.code} — cancel the Production Order instead`,
      });
    }
    // Owner decision — a live plan that made this card (no Production Order
    // built it; that cancel re-points the plan) is cancelled first.
    if (pros.length === 0 && head.productionOrderId == null) {
      for (const p of await rows<{ id: string; code: string }>(
        tx,
        sql`
          SELECT id, code FROM public.plans
           WHERE jc_id = ${id}::uuid AND company_id = ${c}
             AND deleted_at IS NULL AND plan_status <> 'cancelled'
           ORDER BY code
        `,
      )) {
        out.push({
          docLabel: 'Plan',
          docNo: p.code,
          href: `/plans/${p.id}`,
          reason: 'made this Job Card — cancel the plan first',
        });
      }
    }
  }

  // ADR-182 — a short-closed order's card (or rework child) is frozen.
  const stopped = await findStoppedProductionOrder(tx, id);
  if (stopped) {
    out.push({
      docLabel: 'Production Order',
      docNo: stopped.code,
      href: null,
      reason: productionOrderStoppedMessage(stopped),
    });
  }
  return out;
}

/** What the cancel will do — the Cancel preview's lines. */
export async function jobCardCancelEffects(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelEffect[]> {
  const head = await lockJobCardForCancel(tx, companyId, id, false);
  if (!head || head.cancelled) return [];
  const out: CancelEffect[] = [];

  // The SO / JWSO line's "in Job Cards" balance (rework / repair children are
  // not counted there, so nothing reopens for them).
  const src = (
    await rows<{ code: string | null; lineNo: number | null; qty: number }>(
      tx,
      sql`
        SELECT COALESCE(so.code, jw.code) AS code,
               COALESCE(sol.line_no, jwl.line_no) AS "lineNo",
               (CASE WHEN sol.id IS NOT NULL THEN ${jcEffectiveQtySql('jc')}
                     ELSE jc.order_qty END)::int AS qty
          FROM public.job_cards jc
          LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
          LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
          LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
          LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id
         WHERE jc.id = ${id}::uuid AND jc.recovery_kind IS NULL
           AND (sol.id IS NOT NULL OR jwl.id IS NOT NULL)
      `,
    )
  )[0];
  if (src?.code) {
    const ln = src.lineNo != null ? ` Ln ${src.lineNo}` : '';
    out.push({
      kind: 'reopen',
      text: `${src.code}${ln}: ${src.qty} can take a Job Card again`,
      qty: Number(src.qty),
    });
  }

  for (const r of await rows<{ opSeq: number; operation: string; machine: string | null }>(
    tx,
    sql`
      SELECT o.op_seq AS "opSeq", o.operation,
             COALESCE(m.code, NULLIF(o.machine_code_text, 'QC')) AS machine
        FROM public.jc_ops o LEFT JOIN public.machines m ON m.id = o.machine_id
       WHERE o.job_card_id = ${id}::uuid AND o.deleted_at IS NULL AND o.op_type = 'process'
       ORDER BY o.op_seq
    `,
  )) {
    if (!r.machine) continue;
    out.push({
      kind: 'release',
      text: `${opNo(r.opSeq)} (${r.operation}) leaves the ${r.machine} queue`,
      qty: null,
    });
  }

  out.push({ kind: 'note', text: 'No stock moves — nothing was made on this card', qty: null });
  return out;
}

/**
 * The ONE Job Card cancel writer — run by an approved Cancel Request
 * (ADR-235) or by the Production Order cancel (viaProductionOrder), in the
 * caller's transaction. No rights check — the caller checks the ticks.
 */
export async function cancelJobCardTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  actor: AuthContext,
  opts: { viaProductionOrder?: boolean } = {},
): Promise<void> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a Job Card.');

  // Lock ops then the card, THEN re-check it is live — two cancels (or a
  // cancel and a delete) queue here and the second sees deleted_at.
  const head = await lockJobCardForCancel(tx, companyId, id, true);
  if (!head) throw new NotFoundError('Job Card not found. Refresh the page.');
  if (head.cancelled) {
    throw new ConflictError(`${head.code} is already cancelled or in Trash. Refresh the page.`);
  }

  const blockers = await jobCardCancelBlockers(tx, companyId, id, opts);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(head.code, blockers), { blockers });
  }

  // ONE stamp for card and ops: a cancelled card's own ops are exactly those
  // whose deleted_at equals the header's (ops removed earlier keep theirs).
  const stamp = softDeleteStamp(actor);
  const ops = await tx
    .update(jcOps)
    .set({ ...stamp, updatedAt: stamp.deletedAt, updatedBy: actor.id })
    .where(and(eq(jcOps.jobCardId, id), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)))
    .returning({ id: jcOps.id });
  const done = await tx
    .update(jobCards)
    .set({
      ...stamp,
      cancelReason: trimmed,
      cancelledAt: stamp.deletedAt,
      cancelledBy: actor.id,
      updatedAt: stamp.deletedAt,
      updatedBy: actor.id,
    })
    .where(and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)))
    .returning({ id: jobCards.id });
  if (done.length === 0) {
    throw new ConflictError(
      `${head.code} has just been cancelled by someone else. Refresh the page.`,
    );
  }

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'JobCard',
      entityId: head.id,
      refId: head.code,
      reason: trimmed,
      detail:
        `${head.code} cancelled (${ops.length} operation(s))` +
        `${opts.viaProductionOrder ? ' with its Production Order' : ''}; ` +
        `nothing was made on it. Reason: ${trimmed}`,
    },
    companyId,
    actor,
  );
}
