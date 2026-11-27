// Item + Drawing Rev — the ONE body that changes the file of an existing
// Item + Rev (§20.1): "Replace drawing" / first upload in the Drawing Register.
// Split out of lib/item-revision.ts, which re-exports it.
//
// ADR-323 — no drawing correction any more: the new file applies at once. A
// DIFFERENT file (hash differs, or no hash stored) turns a Verified Rev back
// to Unverified; the same file (same hash) keeps the status.

import {
  ActivityAction,
  REV_CHANGE_REASON_MIN,
  REV_RELEASE_STATUS_LABELS,
  itemRevLabel,
  normalizeRevStatus,
} from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { itemRevisionDrawings, itemRevisions, items, users } from '../db/schema';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { emitActivityLog } from '../modules/activity-log/service';
import { requireFormAccess } from './access';
import { assertUnchangedSinceOpened } from './edit-conflict';
import { ConflictError, NotFoundError, ValidationError } from './errors';

export interface ReplaceItemRevisionDrawingArgs {
  drawingFilePath: string;
  drawingNo?: string | null | undefined;
  reason: string;
  expectedUpdatedAt?: string | undefined;
  /** SHA-256 of the NEW file, read by the caller before the transaction
   *  (a storage read is slow); null = could not be read. */
  newFileHash?: string | null | undefined;
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
  fileHash: string | null;
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
      fileHash: itemRevisions.fileHash,
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
  /** ADR-319 — the Rev had no file: this is its first drawing, not a replace. */
  first: boolean;
}

/** ADR-319 — the reason stored when the first file of a Rev is uploaded with none typed. */
export const FIRST_DRAWING_REASON = 'First drawing uploaded';

/** The new file + reason. */
function checkReplacement(
  row: LockedRev,
  args: { drawingFilePath: string; drawingNo?: string | null | undefined; reason: string },
): DrawingChange {
  const label = itemRevLabel(row.itemCode, row.rev);
  const newPath = args.drawingFilePath.trim();
  const first = !row.drawingFilePath?.trim();
  const typed = args.reason.trim();
  // ADR-319 — a first file needs no reason; a replace still does.
  const reason = first && typed === '' ? FIRST_DRAWING_REASON : typed;
  if (reason.length < REV_CHANGE_REASON_MIN)
    throw new ValidationError('Reason is required (at least 5 characters)');
  if (newPath === '') throw new ValidationError('Choose the new drawing file');
  if (newPath === row.drawingFilePath) {
    throw new ValidationError(`This file is already the drawing of ${label}`);
  }
  const newNo = args.drawingNo !== undefined ? args.drawingNo?.trim() || null : row.drawingNo;
  return { newPath, newNo, reason, label, first };
}

/**
 * The ONE body that changes the file of an Item + Rev (§20.1), with the row
 * already locked by lockRevForDrawingChange.
 *
 * §20.4: written with `WHERE id = ? AND updated_at = <locked value>` and the
 * row count checked. The new file goes into item_revision_drawings ('replaced',
 * with the reason; the earlier rows keep the old file); the SO / JWSO line
 * copies follow (drawing_file_path always; drawing_no only where the line's is blank — ADR-323), and every SO line whose copy
 * changes gets its so_line_drawing_revisions row, as a line save writes it.
 */
async function applyDrawingReplacement(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  row: LockedRev,
  change: DrawingChange,
  extra: { unverify: boolean; fileHash: string | null; detail: string },
): Promise<{ soLines: number; jwLines: number }> {
  const { newPath, newNo, reason, label } = change;
  const id = row.id;
  // §20.4 — conditional on the updated_at read under the lock; 0 rows = 409.
  const updated = await tx
    .update(itemRevisions)
    .set({
      drawingFilePath: newPath,
      drawingNo: newNo,
      // ADR-323 — the hash belongs to the verified file: a different file
      // clears it (and Verified On / By) and the Rev is Unverified again.
      fileHash: extra.fileHash,
      ...(extra.unverify
        ? { releaseStatus: 'unverified', releasedAt: null, releasedBy: null }
        : {}),
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
    // ADR-319 — the first file of a Rev is 'adopted' (as a line save adopts one).
    action: change.first ? 'adopted' : 'replaced',
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
           ${newPath}, COALESCE(NULLIF(btrim(l.drawing_no), ''), ${newNo}), ${row.itemCode}, ${user.id}
      FROM public.sales_order_lines l
     WHERE l.company_id = ${companyId}::uuid
       AND l.item_revision_id = ${id}::uuid
       AND l.deleted_at IS NULL
       AND l.drawing_file_path IS DISTINCT FROM ${newPath}`);

  const so = (await tx.execute(sql`
    UPDATE public.sales_order_lines
       SET drawing_file_path = ${newPath},
           -- ADR-323: a line keeps its own typed Drawing No.; the register's only fills a blank.
           drawing_no = COALESCE(NULLIF(btrim(drawing_no), ''), ${newNo}),
           updated_by = ${user.id}
     WHERE company_id = ${companyId}::uuid AND item_revision_id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id`)) as unknown as { id: string }[];
  const jw = (await tx.execute(sql`
    UPDATE public.job_work_order_lines
       SET drawing_file_path = ${newPath},
           -- ADR-323: a line keeps its own typed Drawing No.; the register's only fills a blank.
           drawing_no = COALESCE(NULLIF(btrim(drawing_no), ''), ${newNo}),
           updated_by = ${user.id}
     WHERE company_id = ${companyId}::uuid AND item_revision_id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id`)) as unknown as { id: string }[];

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
        ...(extra.unverify
          ? [
              {
                field: 'releaseStatus',
                label: 'Drawing Rev Status',
                before: REV_RELEASE_STATUS_LABELS.verified,
                after: REV_RELEASE_STATUS_LABELS.unverified,
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

/**
 * "Replace drawing" / first upload — the ONLY way to change the file of an
 * Item + Rev from the Drawing Register (ADR-323).
 *
 * Rights (owner rule): first file on a Rev with none = Drawing Register Entry;
 * replacing an existing file = Drawing Register Edit.
 *   obsolete → refused: add a new Drawing Rev
 *   verified → the new file applies; a DIFFERENT file (hash differs, or no
 *              hash stored) turns it Unverified and clears Verified On / By and
 *              the hash; the same file (same hash) keeps it Verified
 *   unverified → the new file applies; status unchanged
 */
export async function replaceItemRevisionDrawing(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  id: string,
  args: ReplaceItemRevisionDrawingArgs,
): Promise<{ soLines: number; jwLines: number }> {
  const row = await lockRevForDrawingChange(tx, companyId, id);

  const [by] = await tx
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, row.updatedBy))
    .limit(1);
  assertUnchangedSinceOpened(row.updatedAt, args.expectedUpdatedAt, by?.fullName ?? null);

  const label = itemRevLabel(row.itemCode, row.rev);
  const status = normalizeRevStatus(row.releaseStatus);
  if (status === 'obsolete') {
    throw new ValidationError(`${label} is Obsolete — add a new Drawing Rev instead`);
  }
  const change = checkReplacement(row, args);
  await requireFormAccess(user, 'drawingreg_create', change.first ? 'entry' : 'edit');

  const sameFile = !!row.fileHash && !!args.newFileHash && row.fileHash === args.newFileHash;
  return applyDrawingReplacement(tx, user, companyId, row, change, {
    unverify: status === 'verified' && !sameFile,
    fileHash: sameFile ? row.fileHash : null,
    detail: change.first ? 'Drawing uploaded' : 'Drawing replaced',
  });
}
