// Item + Drawing Rev on an SO / JWSO line — ONE hook for both line writers
// (sales-orders and job-work-orders: create insert and mergeLines; approved
// line edits replay through mergeLines, so they pass here too).
//
//   • resolveLineRevision — links the line to ABC/<rev> (lib/item-revision.ts
//     resolveItemRevision, the one writer of the register) and says what the
//     line's drawing copy should be.
//   • ADR-291 Step 4 (replaces D1 "Rev change moves open Job Cards") — a Rev
//     change on a line with an OPEN Job Card or OPEN Production Order is
//     refused: the work moves only through an Engineering Change (ECR), which
//     splits finished / started / not-started pieces. Plans with no PRO still
//     move; all Job Cards closed → refused (add a new line). The ECR implement
//     calls in with `ecrImplement` to record the line's change after it has
//     moved the work itself. Job Cards locked FOR UPDATE first.

import {
  ActivityAction,
  REV_CHANGE_REASON_MIN,
  itemRevLabel,
  normalizeRevision,
  REV_RELEASE_STATUS_LABELS,
} from '@innovic/shared';
import { inArray, sql } from 'drizzle-orm';
import { itemRevisionChanges, itemRevisions, items } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import {
  assertRevReleasedForWork,
  fillRevDrawingNo,
  resolveItemRevision,
} from '../../lib/item-revision';
import { emitActivityLog } from '../activity-log/service';

export type LineKind = 'so' | 'jw';

/** ADR-323 (owner 26-Nov-2026) — SO and JWSO lines take NO drawing file: the
 *  PDF is uploaded only in the Drawing Register. A sent drawingFilePath is
 *  ignored (kept optional in the input so old screens do not 400); the line's
 *  copy follows the register. A line Drawing No. fills a blank register
 *  Drawing No. (never overwrites one). */

export interface StoredLineRev {
  id: string;
  lineNo: number;
  itemId: string | null;
  revision: string | null;
  itemRevisionId: string | null;
  drawingFilePath: string | null;
}

export interface LineRevInput {
  kind: LineKind;
  /** The order (sales_orders.id / job_work_orders.id) and its code. */
  orderId: string;
  docCode: string;
  lineNo: number;
  /** Item and Rev the line will carry AFTER this save. */
  itemId: string | null;
  rev: string | null | undefined;
  /** The file field as sent: undefined = not sent, null = cleared. */
  sentFile: string | null | undefined;
  sentDrawingNo: string | null | undefined;
  /** The stored line, or null for a new line. */
  stored: StoredLineRev | null;
  /** ADR-289 — why the Rev changed; required once the line has a Plan / PRO /
   *  Job Card (applyLineRevChange). */
  revChangeReason?: string | null | undefined;
}

export interface LineRevResult {
  /** false = nothing about Item / Rev / file changed: leave the line as is. */
  touched: boolean;
  itemRevisionId: string | null;
  /** The line's drawing copy to store; undefined = keep today's behaviour. */
  drawingFilePath: string | null | undefined;
  /** The register's Drawing No., to fill a blank line Drawing No. only. */
  registerDrawingNo: string | null;
}

const norm = (v: string | null | undefined): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t === '' ? null : t;
};

export async function resolveLineRevision(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  input: LineRevInput,
): Promise<LineRevResult> {
  const untouched: LineRevResult = {
    touched: false,
    itemRevisionId: input.stored?.itemRevisionId ?? null,
    drawingFilePath: undefined,
    registerDrawingNo: null,
  };
  const sourceType = input.kind === 'so' ? 'so_line' : 'jw_line';
  const sourceRef = `${input.docCode} ln ${input.lineNo}`;
  // ADR-323 — the line's own file (input.sentFile) is never offered to the
  // register: the register is the only place a drawing PDF is uploaded.
  const st = input.stored;
  const lineDrawingNo = norm(input.sentDrawingNo);

  if (!st) {
    const r = await resolveItemRevision(tx, user, companyId, {
      itemId: input.itemId,
      rev: input.rev,
      drawingNo: input.sentDrawingNo,
      sourceType,
      sourceRef,
    });
    if (!r)
      return {
        touched: true,
        itemRevisionId: null,
        drawingFilePath: undefined,
        registerDrawingNo: null,
      };
    await fillRevDrawingNo(tx, companyId, r.id, lineDrawingNo);
    return {
      touched: true,
      itemRevisionId: r.id,
      // The line's copy is the register's file (or none).
      drawingFilePath: r.drawingFilePath,
      registerDrawingNo: r.drawingNo,
    };
  }

  const itemChanged = (input.itemId ?? null) !== (st.itemId ?? null);
  const revChanged =
    input.rev !== undefined &&
    normalizeRevision(input.rev ?? '') !== normalizeRevision(st.revision ?? '');
  const storedFile = norm(st.drawingFilePath);
  if (!itemChanged && !revChanged) {
    await fillRevDrawingNo(tx, companyId, st.itemRevisionId, lineDrawingNo);
    return untouched;
  }

  // A JWSO line raised by a server path stores the DB default '0' — nobody
  // typed it, so when this save does not send a Rev it is not registered.
  const rev =
    input.rev !== undefined
      ? input.rev
      : input.kind === 'jw' && normalizeRevision(st.revision ?? '') === '0'
        ? null
        : st.revision;
  const r = await resolveItemRevision(tx, user, companyId, {
    itemId: input.itemId,
    rev,
    drawingNo: input.sentDrawingNo,
    sourceType,
    sourceRef,
  });
  if (!r && st.itemRevisionId) {
    // 0234 fix — a Rev cannot be blanked under live work: the Job Cards carry
    // it (D1 moves work between Revs; it never strips it).
    const lineCol =
      input.kind === 'so' ? sql.raw('source_so_line_id') : sql.raw('source_jw_line_id');
    const live = (await tx.execute(sql`
      SELECT 1 FROM public.job_cards
       WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
         AND ${lineCol} = ${st.id}::uuid
       LIMIT 1`)) as unknown as unknown[];
    if (live.length > 0) {
      throw new ValidationError(
        `Ln ${input.lineNo}: Drawing Rev cannot be cleared once a Job Card exists`,
      );
    }
  }
  if (!r)
    return {
      touched: true,
      itemRevisionId: null,
      drawingFilePath: undefined,
      registerDrawingNo: null,
    };

  // The line's copy follows the register; a new Item / Rev with no file
  // leaves the line with none.
  const copy: string | null = r.drawingFilePath ?? (revChanged || itemChanged ? null : storedFile);

  if (!itemChanged && st.itemRevisionId !== r.id) {
    await applyLineRevChange(tx, user, companyId, {
      kind: input.kind,
      orderId: input.orderId,
      docCode: input.docCode,
      lineId: st.id,
      lineNo: input.lineNo,
      itemId: input.itemId!,
      fromId: st.itemRevisionId,
      toId: r.id,
      reason: input.revChangeReason ?? null,
      // A first-time link of the same Rev text (old line, item_revision_id
      // NULL) is not a Rev change: no reason asked.
      revTextChanged: normalizeRevision(rev ?? '') !== normalizeRevision(st.revision ?? ''),
    });
  }
  await fillRevDrawingNo(tx, companyId, r.id, lineDrawingNo);
  return {
    touched: true,
    itemRevisionId: r.id,
    drawingFilePath: copy,
    registerDrawingNo: r.drawingNo,
  };
}

export interface LineRevChange {
  kind: LineKind;
  orderId: string;
  docCode: string;
  lineId: string;
  lineNo: number;
  itemId: string;
  fromId: string | null;
  toId: string;
  /** ADR-289 — the user's reason (stored in item_revision_changes.reason). */
  reason?: string | null;
  /** false = the Rev TEXT is the same (only the register link / file moved):
   *  no reason is required. Default true. */
  revTextChanged?: boolean;
  /** ADR-291 — internal, set only by the ECR implement (never from a user
   *  request). Skips the work-in-progress refusal.
   *    'split'    — the ECR already moved the not-started pieces to a new PRO /
   *                 Job Card; open Job Cards / PROs keep the old Rev.
   *    'move_all' — documentation-only change: open Job Cards / PROs of the
   *                 line move to the new Rev (the old D1 move). */
  ecrImplement?: 'split' | 'move_all';
}

/** ADR-291 — a line's Rev change. Open Job Card / open PRO → refused (raise
 *  an ECR); plans with no PRO move to the new Rev; all Job Cards closed →
 *  refused. "Closed JC" = closed_at set, or v_jc_status 'complete' / 'closed',
 *  or its PRO closed / short_closed. Cancelled JCs are soft-deleted
 *  (deleted_at) and so ignored. */
export async function applyLineRevChange(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  c: LineRevChange,
): Promise<{ movedDocs: string[]; keptDocs: string[] }> {
  const lineCol = c.kind === 'so' ? sql.raw('source_so_line_id') : sql.raw('source_jw_line_id');
  const planLineCol = c.kind === 'so' ? sql.raw('so_line_id') : sql.raw('jw_line_id');

  // Lock the line's Job Cards first (§20.3 — check and write under the lock).
  await tx.execute(sql`
    SELECT jc.id FROM public.job_cards jc
     WHERE jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
       AND jc.${lineCol} = ${c.lineId}::uuid AND jc.item_id = ${c.itemId}::uuid
     FOR UPDATE`);
  const jcs = (await tx.execute(sql`
    SELECT jc.id, jc.code,
           (jc.closed_at IS NOT NULL
             OR js.computed_status IN ('complete', 'closed')
             OR po.status IN ('closed', 'short_closed')) AS closed
      FROM public.job_cards jc
      LEFT JOIN public.v_jc_status js ON js.job_card_id = jc.id
      LEFT JOIN public.production_orders po
        ON po.id = jc.production_order_id AND po.deleted_at IS NULL
     WHERE jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
       AND jc.${lineCol} = ${c.lineId}::uuid AND jc.item_id = ${c.itemId}::uuid
     ORDER BY jc.code`)) as unknown as Array<{ id: string; code: string; closed: boolean }>;

  const closed = jcs.filter((j) => j.closed);
  // ADR-291 — with ecrImplement the ECR has already split the open work; the
  // Job Cards themselves are not moved here.
  const open = c.ecrImplement === 'split' ? [] : jcs.filter((j) => !j.closed);
  if (jcs.length > 0 && jcs.every((j) => j.closed)) {
    throw new ValidationError(
      `Ln ${c.lineNo}: All Job Cards are closed — Rev and drawing locked. For a new Rev add a new line`,
    );
  }

  const revIds = [c.toId, ...(c.fromId ? [c.fromId] : [])];
  const revRows = await tx
    .select({ id: itemRevisions.id, rev: itemRevisions.rev, code: items.code })
    .from(itemRevisions)
    .innerJoin(items, sql`${items.id} = ${itemRevisions.itemId}`)
    .where(inArray(itemRevisions.id, revIds));
  const lbl = (id: string | null): string => {
    const r = revRows.find((x) => x.id === id);
    return r ? itemRevLabel(r.code, r.rev) : '—';
  };

  // ADR-291 Step 4 — work in progress moves only through an Engineering
  // Change. Checked under the Job Card locks above; an open PRO counts even
  // before its Job Card has a piece logged.
  if (!c.ecrImplement) {
    const openPros =
      open.length > 0
        ? []
        : ((await tx.execute(sql`
      SELECT po.id FROM public.production_orders po
       WHERE po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL
         AND po.status NOT IN ('closed', 'short_closed')
         AND po.plan_id IN (
           SELECT p.id FROM public.plans p
            WHERE p.company_id = ${companyId}::uuid AND p.deleted_at IS NULL
              AND p.${planLineCol} = ${c.lineId}::uuid AND p.item_id = ${c.itemId}::uuid)
       LIMIT 1`)) as unknown as unknown[]);
    if (open.length > 0 || openPros.length > 0) {
      throw new ValidationError(
        `Ln ${c.lineNo}: ${lbl(c.fromId)} has work in progress — raise an Engineering Change (ECR) to move it to ${lbl(c.toId)}.`,
      );
    }
  }
  // ADR-289 — once the line has any Plan / PRO / Job Card, a Rev change needs
  // a reason (stored on the change row and in every moved document's log).
  const reason = (c.reason ?? '').trim();
  let hasWork = jcs.length > 0;
  if (!hasWork) {
    const pl = (await tx.execute(sql`
      SELECT 1 FROM public.plans
       WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
         AND ${planLineCol} = ${c.lineId}::uuid
       LIMIT 1`)) as unknown as unknown[];
    hasWork = pl.length > 0;
  }
  if (c.revTextChanged !== false && hasWork && reason.length < REV_CHANGE_REASON_MIN) {
    throw new ValidationError(`Ln ${c.lineNo}: give a reason for changing the Drawing Rev`);
  }
  // ADR-323 — open Plan / PRO / Job Card work moves to the new Rev, so the
  // new Rev must allow work (Verified or Unverified; only Obsolete refused).
  if (hasWork) {
    await assertRevReleasedForWork(
      tx,
      companyId,
      c.toId,
      // Names the Drawing Register, where a new Rev is added (POST
      // /item-revisions) — the way out of a refused save.
      (label, status) =>
        `${label} is ${REV_RELEASE_STATUS_LABELS[status]}. Pick another Drawing Rev, or add a new one in the Drawing Register first.`,
    );
  }
  const closedIds = closed.map((j) => j.id);
  const closedArr =
    closedIds.length > 0
      ? sql`ARRAY[${sql.join(
          closedIds.map((i) => sql`${i}::uuid`),
          sql`, `,
        )}]`
      : sql`ARRAY[]::uuid[]`;

  // The APPROVED Route Card of the new Item + Rev, if any: open PROs and their Job
  // Cards move to it together, by this one rule, or both keep the old card.
  const newRevCard = sql`
    SELECT id, code, current_revision FROM public.route_cards
     WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
       AND item_revision_id = ${c.toId}::uuid AND approval_status = 'approved'
     LIMIT 1`;

  const movedDocs: string[] = [];
  if (open.length > 0) {
    // ADR-282 — the Job Card's stamp stays in step with its PRO. A change held back
    // for the old card is not for the new one. A Job Card that never recorded a
    // card stays blank (never guessed).
    await tx.execute(sql`
      WITH rc AS (${newRevCard})
      UPDATE public.job_cards jc
         SET item_revision_id = ${c.toId}::uuid,
             updated_by = ${user.id}::uuid,
             route_card_id = CASE WHEN jc.route_card_id IS NULL THEN NULL
               ELSE COALESCE((SELECT id FROM rc), jc.route_card_id) END,
             route_card_revision = CASE WHEN jc.route_card_id IS NULL THEN NULL
               ELSE COALESCE((SELECT current_revision FROM rc), jc.route_card_revision) END,
             route_card_not_sent = CASE
               WHEN jc.route_card_id IS DISTINCT FROM (SELECT id FROM rc)
                AND EXISTS (SELECT 1 FROM rc) THEN false
               ELSE jc.route_card_not_sent END
       WHERE jc.id IN (${sql.join(
         open.map((j) => sql`${j.id}::uuid`),
         sql`, `,
       )})`);
    movedDocs.push(...open.map((j) => j.code));
  }
  const plans = (await tx.execute(sql`
    UPDATE public.plans SET item_revision_id = ${c.toId}::uuid, updated_by = ${user.id}::uuid
     WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
       AND ${planLineCol} = ${c.lineId}::uuid AND item_id = ${c.itemId}::uuid
       AND (jc_id IS NULL OR NOT (jc_id = ANY(${closedArr})))
       AND item_revision_id IS DISTINCT FROM ${c.toId}::uuid
    RETURNING id, code`)) as unknown as Array<{ id: string; code: string }>;
  movedDocs.push(...plans.map((p) => p.code));
  // 0234 fix — open PROs move by plan LINKAGE (every live plan of this line +
  // item), not only plans changed by the statement above: a plan already on
  // the new Rev may still have PROs on the old one. A PRO moving to the new
  // Rev takes the APPROVED Route Card of the new Item + Rev when one exists
  // (route card id / code / revision snapshot together); otherwise it keeps
  // its old card (the screen then shows the card for the new Rev is missing).
  const pros =
    c.ecrImplement === 'split'
      ? []
      : ((await tx.execute(sql`
    WITH rc AS (${newRevCard})
    UPDATE public.production_orders po
       SET item_revision_id = ${c.toId}::uuid,
           updated_by = ${user.id}::uuid,
           route_card_id = COALESCE((SELECT id FROM rc), po.route_card_id),
           route_card_code_text = COALESCE((SELECT code FROM rc), po.route_card_code_text),
           route_card_revision = COALESCE((SELECT current_revision FROM rc), po.route_card_revision)
     WHERE po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL
       AND po.plan_id IN (
         SELECT p.id FROM public.plans p
          WHERE p.company_id = ${companyId}::uuid AND p.deleted_at IS NULL
            AND p.${planLineCol} = ${c.lineId}::uuid AND p.item_id = ${c.itemId}::uuid)
       AND po.status NOT IN ('closed', 'short_closed')
       AND (po.job_card_id IS NULL OR NOT (po.job_card_id = ANY(${closedArr})))
       AND po.item_revision_id IS DISTINCT FROM ${c.toId}::uuid
    RETURNING po.id, po.code`)) as unknown as Array<{ id: string; code: string }>);
  movedDocs.push(...pros.map((p) => p.code));
  const keptDocs = closed.map((j) => j.code);

  await tx.insert(itemRevisionChanges).values({
    companyId,
    soLineId: c.kind === 'so' ? c.lineId : null,
    jwLineId: c.kind === 'jw' ? c.lineId : null,
    fromItemRevisionId: c.fromId,
    toItemRevisionId: c.toId,
    movedDocs,
    keptDocs,
    reason: reason || null,
    createdBy: user.id,
    updatedBy: user.id,
  });

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: c.kind === 'so' ? 'SalesOrder' : 'JobWorkOrder',
      entityId: c.orderId,
      refId: c.docCode,
      lineRef: `Line ${c.lineNo}`,
      changes: [
        { field: 'drawingRev', label: 'Drawing Rev', before: lbl(c.fromId), after: lbl(c.toId) },
      ],
      detail:
        `Drawing Rev ${lbl(c.fromId)} → ${lbl(c.toId)} on ${c.docCode} ln ${c.lineNo}` +
        (movedDocs.length > 0 ? ` — moved ${movedDocs.join(', ')}` : '') +
        (keptDocs.length > 0 ? ` — kept (closed) ${keptDocs.join(', ')}` : ''),
      ...(reason ? { reason } : {}),
    },
    companyId,
    user,
  );
  // ADR-289 — one row on EACH moved Job Card, PRO and Plan, so the change shows
  // in that document's own History, not only on the SO / JWSO.
  const revChange = {
    field: 'drawingRev',
    label: 'Drawing Rev',
    before: lbl(c.fromId),
    after: lbl(c.toId),
  };
  const moved: Array<{ entity: string; id: string; code: string }> = [
    ...open.map((j) => ({ entity: 'JobCard', id: j.id, code: j.code })),
    ...pros.map((p) => ({ entity: 'ProductionOrder', id: p.id, code: p.code })),
    ...plans.map((p) => ({ entity: 'Plan', id: p.id, code: p.code })),
  ];
  for (const m of moved) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: m.entity,
        entityId: m.id,
        refId: m.code,
        changes: [revChange],
        detail: `Drawing Rev ${lbl(c.fromId)} → ${lbl(c.toId)} — moved with ${c.docCode} ln ${c.lineNo}`,
        ...(reason ? { reason } : {}),
      },
      companyId,
      user,
    );
  }
  return { movedDocs, keptDocs };
}
