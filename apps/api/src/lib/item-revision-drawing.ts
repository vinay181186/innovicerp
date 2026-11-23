// Item + Drawing Rev — the ONE body that changes the file of an existing
// Item + Rev (§20.1): "Replace drawing" and an approved drawing correction
// (ADR-290). Split out of lib/item-revision.ts, which re-exports it.

import { ActivityAction, REV_CHANGE_REASON_MIN, itemRevLabel } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { itemRevisionDrawings, itemRevisions, items, users } from '../db/schema';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { emitActivityLog } from '../modules/activity-log/service';
import { assertUnchangedSinceOpened } from './edit-conflict';
import { autoSubmitRevIfFile } from './item-revision';
import { ConflictError, NotFoundError, ValidationError } from './errors';

export interface ReplaceItemRevisionDrawingArgs {
  drawingFilePath: string;
  drawingNo?: string | null | undefined;
  reason: string;
  expectedUpdatedAt?: string | undefined;
}

interface LockedRev {
  id: string;
  rev: string;
  drawingFilePath: string | null;
  drawingNo: string | null;
  updatedAt: Date;
  updatedBy: string;
  itemCode: string;
  releaseStatus: string;
}

/** ADR-289 lock order — the SO / JWSO lines on this Rev FIRST (id order), then
 *  the register row: the order a line save takes them (lines, then register),
 *  so a drawing change and a line save on the same Rev queue instead of
 *  deadlocking. */
export async function lockRevForDrawingChange(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<LockedRev> {
  await tx.execute(sql`
    SELECT id FROM public.sales_order_lines
     WHERE company_id = ${companyId}::uuid AND item_revision_id = ${id}::uuid AND deleted_at IS NULL
     ORDER BY id FOR UPDATE`);
  await tx.execute(sql`
    SELECT id FROM public.job_work_order_lines
     WHERE company_id = ${companyId}::uuid AND item_revision_id = ${id}::uuid AND deleted_at IS NULL
     ORDER BY id FOR UPDATE`);
  const [row] = await tx
    .select({
      id: itemRevisions.id,
      rev: itemRevisions.rev,
      drawingFilePath: itemRevisions.drawingFilePath,
      drawingNo: itemRevisions.drawingNo,
      updatedAt: itemRevisions.updatedAt,
      updatedBy: itemRevisions.updatedBy,
      itemCode: items.code,
      releaseStatus: itemRevisions.releaseStatus,
    })
    .from(itemRevisions)
    .innerJoin(items, eq(items.id, itemRevisions.itemId))
    .where(
      and(
        eq(itemRevisions.id, id),
        eq(itemRevisions.companyId, companyId),
        isNull(itemRevisions.deletedAt),
      ),
    )
    .for('update', { of: itemRevisions })
    .limit(1);
  if (!row) throw new NotFoundError('Drawing Rev not found');
  return row;
}

interface DrawingChange {
  newPath: string;
  newNo: string | null;
  reason: string;
  label: string;
}

/** The new file + reason, checked the same way for a direct replace and a
 *  correction. */
function checkReplacement(
  row: LockedRev,
  args: { drawingFilePath: string; drawingNo?: string | null | undefined; reason: string },
): DrawingChange {
  const label = itemRevLabel(row.itemCode, row.rev);
  const newPath = args.drawingFilePath.trim();
  const reason = args.reason.trim();
  if (reason.length < REV_CHANGE_REASON_MIN)
    throw new ValidationError('Reason is required (at least 5 characters)');
  if (newPath === '') throw new ValidationError('Choose the new drawing file');
  if (newPath === row.drawingFilePath) {
    throw new ValidationError(`This file is already the drawing of ${label}`);
  }
  const newNo = args.drawingNo !== undefined ? args.drawingNo?.trim() || null : row.drawingNo;
  return { newPath, newNo, reason, label };
}

/**
 * The ONE body that changes the file of an Item + Rev (§20.1): a direct
 * "Replace drawing" and an approved drawing correction both run it, with the
 * row already locked by lockRevForDrawingChange.
 *
 * §20.4: written with `WHERE id = ? AND updated_at = <locked value>` and the
 * row count checked. The new file goes into item_revision_drawings ('replaced',
 * with the reason; the earlier rows keep the old file); the SO / JWSO line
 * copies (drawing_file_path / drawing_no) follow, and every SO line whose copy
 * changes gets its so_line_drawing_revisions row, as a line save writes it.
 */
async function applyDrawingReplacement(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  row: LockedRev,
  change: DrawingChange,
  extra: { releaseStatus?: 'draft'; fileHash: string | null; detail: string },
): Promise<{ soLines: number; jwLines: number }> {
  const { newPath, newNo, reason, label } = change;
  const id = row.id;
  // §20.4 — conditional on the updated_at read under the lock; 0 rows = 409.
  const updated = await tx
    .update(itemRevisions)
    .set({
      drawingFilePath: newPath,
      drawingNo: newNo,
      // ADR-290 — the hash belongs to the released file: a replace before
      // release clears it, an approved correction stores the new file's.
      fileHash: extra.fileHash,
      ...(extra.releaseStatus ? { releaseStatus: extra.releaseStatus } : {}),
      updatedBy: user.id,
    })
    // ADR-289 — compared to the MILLISECOND on both sides: the column carries
    // microseconds, the value read back through a JS Date only milliseconds, so
    // a plain `=` matched 0 rows and refused every valid replace (as
    // job-cards updateJobCardTx and lib/edit-conflict.ts do it).
    .where(
      and(
        eq(itemRevisions.id, id),
        sql`date_trunc('milliseconds', ${itemRevisions.updatedAt}) = date_trunc('milliseconds', ${row.updatedAt.toISOString()}::timestamptz)`,
      ),
    )
    .returning({ id: itemRevisions.id });
  if (updated.length === 0) {
    throw new ConflictError(`${label} was changed by someone else — reload and try again`);
  }

  await tx.insert(itemRevisionDrawings).values({
    companyId,
    itemRevisionId: id,
    action: 'replaced',
    drawingFilePath: newPath,
    drawingNo: newNo,
    reason,
    sourceType: null,
    sourceRef: null,
    createdBy: user.id,
    updatedBy: user.id,
  });

  // SO line drawing history — one row per line whose copy really changes,
  // written BEFORE the copies move (IS DISTINCT FROM reads the old copy).
  // MAX(revision_no) is read here, under the line locks taken above.
  await tx.execute(sql`
    INSERT INTO public.so_line_drawing_revisions
      (company_id, sales_order_id, so_line_id, revision_no, line_revision_text, action,
       drawing_file_path, drawing_no, item_code_text, created_by)
    SELECT l.company_id, l.sales_order_id, l.id,
           COALESCE((SELECT MAX(r.revision_no) FROM public.so_line_drawing_revisions r
                      WHERE r.so_line_id = l.id), -1) + 1,
           l.revision,
           CASE WHEN NULLIF(btrim(l.drawing_file_path), '') IS NULL THEN 'added' ELSE 'replaced' END,
           ${newPath}, ${newNo}, ${row.itemCode}, ${user.id}
      FROM public.sales_order_lines l
     WHERE l.company_id = ${companyId}::uuid
       AND l.item_revision_id = ${id}::uuid
       AND l.deleted_at IS NULL
       AND l.drawing_file_path IS DISTINCT FROM ${newPath}`);

  const so = (await tx.execute(sql`
    UPDATE public.sales_order_lines
       SET drawing_file_path = ${newPath}, drawing_no = ${newNo}, updated_by = ${user.id}
     WHERE company_id = ${companyId}::uuid AND item_revision_id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id`)) as unknown as { id: string }[];
  const jw = (await tx.execute(sql`
    UPDATE public.job_work_order_lines
       SET drawing_file_path = ${newPath}, drawing_no = ${newNo}, updated_by = ${user.id}
     WHERE company_id = ${companyId}::uuid AND item_revision_id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id`)) as unknown as { id: string }[];

  const statusMoved = extra.releaseStatus && extra.releaseStatus !== row.releaseStatus;
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: 'ItemRevision',
      entityId: id,
      refId: label,
      reason,
      changes: [
        { field: 'drawingFilePath', label: 'Drawing', before: row.drawingFilePath, after: newPath },
        ...(statusMoved
          ? [
              {
                field: 'releaseStatus',
                label: 'Release Status',
                before: row.releaseStatus,
                after: extra.releaseStatus ?? null,
              },
            ]
          : []),
      ],
      detail: `${extra.detail} on ${label} — ${so.length} SO line(s), ${jw.length} JWSO line(s) updated`,
    },
    companyId,
    user,
  );
  return { soLines: so.length, jwLines: jw.length };
}

/** Order statuses that end a line's open life (header or line) — the same
 *  rule as the Drawing Register's Open Lines column (register.ts). */
const DONE = sql`('closed', 'dispatched', 'cancelled')`;

/** True when an open SO / JWSO line or an open Job Card uses this Rev (the
 *  Drawing Register's Open Lines / Open Job Cards rule). */
async function revInOpenUse(tx: DbTransaction, companyId: string, id: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM public.sales_order_lines l
      JOIN public.sales_orders h ON h.id = l.sales_order_id
     WHERE l.company_id = ${companyId}::uuid AND l.item_revision_id = ${id}::uuid
       AND l.deleted_at IS NULL AND h.deleted_at IS NULL
       AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE}
    UNION ALL
    SELECT 1 FROM public.job_work_order_lines l
      JOIN public.job_work_orders h ON h.id = l.job_work_order_id
     WHERE l.company_id = ${companyId}::uuid AND l.item_revision_id = ${id}::uuid
       AND l.deleted_at IS NULL AND h.deleted_at IS NULL
       AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE}
    UNION ALL
    SELECT 1 FROM public.job_cards jc
      LEFT JOIN public.v_jc_status js ON js.job_card_id = jc.id
     WHERE jc.company_id = ${companyId}::uuid AND jc.item_revision_id = ${id}::uuid
       AND jc.deleted_at IS NULL
       AND COALESCE(js.computed_status, 'open') NOT IN ('complete', 'closed')
    LIMIT 1`)) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * "Replace drawing" — the ONLY way to change the file of an Item + Rev that
 * already has one. The caller checks the Route Card Master edit right.
 *
 * ADR-290 — by release status:
 *   released / superseded   → the file is NOT changed: a pending
 *                             drawing_corrections row is written instead (one
 *                             per Rev; decided by the release switch)
 *   unverified, has a file, in open use (open SO / JWSO line or open Job
 *                             Card) → a correction too: the shop floor works
 *                             to that file. No file yet → the first file, direct.
 *   obsolete                → refused: add a new Drawing Rev
 *   under_review / approved → replaced, and the Rev goes back to draft (it
 *                             must be reviewed again)
 *   any other               → replaced as before
 */
export async function replaceItemRevisionDrawing(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  id: string,
  args: ReplaceItemRevisionDrawingArgs,
): Promise<{ soLines: number; jwLines: number; correctionId: string | null }> {
  const row = await lockRevForDrawingChange(tx, companyId, id);

  const [by] = await tx
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, row.updatedBy))
    .limit(1);
  assertUnchangedSinceOpened(row.updatedAt, args.expectedUpdatedAt, by?.fullName ?? null);

  const label = itemRevLabel(row.itemCode, row.rev);
  if (row.releaseStatus === 'obsolete') {
    throw new ValidationError(`${label} is Obsolete — add a new Drawing Rev instead`);
  }
  const change = checkReplacement(row, args);

  const needsCorrection =
    row.releaseStatus === 'released' ||
    row.releaseStatus === 'superseded' ||
    (row.releaseStatus === 'unverified' &&
      !!row.drawingFilePath?.trim() &&
      (await revInOpenUse(tx, companyId, id)));
  if (needsCorrection) {
    // One pending correction per Rev — the partial unique index settles a race.
    const ins = (await tx.execute(sql`
      INSERT INTO public.drawing_corrections
        (company_id, item_revision_id, drawing_file_path, drawing_no, reason, status,
         requested_by, created_by, updated_by)
      VALUES (${companyId}, ${id}, ${change.newPath}, ${change.newNo}, ${change.reason}, 'pending',
              ${user.id}, ${user.id}, ${user.id})
      ON CONFLICT (item_revision_id) WHERE status = 'pending' AND deleted_at IS NULL DO NOTHING
      RETURNING id`)) as unknown as { id: string }[];
    const correctionId = ins[0]?.id;
    if (!correctionId)
      throw new ConflictError(`A correction for ${change.label} is already waiting`);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'ItemRevision',
        entityId: id,
        refId: change.label,
        reason: change.reason,
        detail: `Drawing correction requested on ${change.label} — waiting for release approval`,
      },
      companyId,
      user,
    );
    return { soLines: 0, jwLines: 0, correctionId };
  }

  // ADR-311 — a replaced file is checked again: draft / rejected / under_review /
  // approved all go (back) to Under Review (autoSubmitRevIfFile), never to draft.
  const res = await applyDrawingReplacement(tx, user, companyId, row, change, {
    fileHash: null,
    detail: 'Drawing replaced',
  });
  await autoSubmitRevIfFile(tx, user, companyId, id, `Replace drawing: ${change.reason}`);
  return { ...res, correctionId: null };
}

/** ADR-290 — an APPROVED drawing correction: the same body as Replace drawing
 *  (applyDrawingReplacement); the Rev keeps its status and stores the new
 *  file's hash. The caller has already moved the correction pending → approved
 *  in this transaction. */
export async function applyDrawingCorrection(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  itemRevisionId: string,
  correction: { drawingFilePath: string; drawingNo: string | null; reason: string },
  fileHash: string,
): Promise<{ soLines: number; jwLines: number }> {
  const row = await lockRevForDrawingChange(tx, companyId, itemRevisionId);
  const change = checkReplacement(row, correction);
  return applyDrawingReplacement(tx, user, companyId, row, change, {
    fileHash,
    detail: 'Drawing correction approved',
  });
}
