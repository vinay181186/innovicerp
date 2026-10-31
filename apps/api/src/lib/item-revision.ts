// Item + Drawing Rev register (ABC/1) — the ONE writer of item_revisions and
// item_revision_drawings. SO lines, JWSO lines, Route Cards and BOM child lines
// all call resolveItemRevision() inside their own save transaction, so the
// register row and the document that names it commit (or fail) together.
//
// Rules (owner, 2026-10-31):
//   • ABC/<rev> is created by whichever document names it first.
//   • A later document with no file gets the register's file.
//   • A register row with no file ADOPTS the first file offered.
//   • A DIFFERENT file for a row that already has one is refused — the fix is
//     replaceItemRevisionDrawing() with a reason (old file kept in history).
//   • Rev only for MAKE items; Buy items / RM resolve to null.

import {
  ActivityAction,
  normalizeRevision,
  REVISION_PATTERN,
  itemRevLabel,
  type ItemRevisionSource,
} from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { itemRevisionDrawings, itemRevisions, items, users } from '../db/schema';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { emitActivityLog } from '../modules/activity-log/service';
import { assertUnchangedSinceOpened } from './edit-conflict';
import { ConflictError, NotFoundError, ValidationError } from './errors';

export interface ResolveItemRevisionInput {
  itemId: string | null | undefined;
  rev: string | null | undefined;
  /** File offered by the document: undefined = not mentioned, null = none. */
  drawingFilePath?: string | null | undefined;
  drawingNo?: string | null | undefined;
  sourceType: ItemRevisionSource;
  /** Display ref for the history ("IN-SO-00012 ln 3", "IN-RC-00045"). */
  sourceRef: string | null;
  /** True when the file is "Use as is" carried over from another Rev. */
  copiedFromOtherRev?: boolean;
}

export interface ResolvedItemRevision {
  id: string;
  rev: string;
  /** The register's file after this call — documents store it as their copy. */
  drawingFilePath: string | null;
  drawingNo: string | null;
  created: boolean;
}

/** True when the item is a MAKE item (only those carry a Drawing Rev). */
export async function itemNeedsRev(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ procurementType: items.procurementType })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
    .limit(1);
  return row?.procurementType === 'make';
}

/**
 * Find or create ABC/<rev> and reconcile the offered drawing. Returns null for
 * a Buy item, no item, or no Rev (caller decides whether a Rev was compulsory).
 * Race-safe: INSERT … ON CONFLICT DO NOTHING on the live unique index, then
 * re-read under FOR UPDATE, so two first-namers in the same second share one row.
 */
export async function resolveItemRevision(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  input: ResolveItemRevisionInput,
): Promise<ResolvedItemRevision | null> {
  if (!input.itemId) return null;
  const rev = normalizeRevision(input.rev ?? '');
  if (rev === '') return null;
  if (!REVISION_PATTERN.test(rev))
    throw new ValidationError(`Drawing Rev "${rev}": letters, digits, . - / only`);
  if (!(await itemNeedsRev(tx, companyId, input.itemId))) return null;

  const offered =
    input.drawingFilePath === undefined ? undefined : input.drawingFilePath?.trim() || null;
  const offeredNo = input.drawingNo === undefined ? undefined : input.drawingNo?.trim() || null;

  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO item_revisions (company_id, item_id, rev, drawing_file_path, drawing_no, source_type, source_ref, created_by, updated_by)
    VALUES (${companyId}, ${input.itemId}, ${rev}, ${offered ?? null}, ${offeredNo ?? null}, ${input.sourceType}, ${input.sourceRef}, ${user.id}, ${user.id})
    ON CONFLICT (company_id, item_id, rev) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id`);
  const insertedId = (inserted as unknown as { id: string }[])[0]?.id ?? null;

  if (insertedId) {
    if (offered) {
      await tx.insert(itemRevisionDrawings).values({
        companyId,
        itemRevisionId: insertedId,
        action: input.copiedFromOtherRev ? 'copied' : 'born',
        drawingFilePath: offered,
        drawingNo: offeredNo ?? null,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        createdBy: user.id,
        updatedBy: user.id,
      });
    }
    return {
      id: insertedId,
      rev,
      drawingFilePath: offered ?? null,
      drawingNo: offeredNo ?? null,
      created: true,
    };
  }

  const [row] = await tx
    .select({
      id: itemRevisions.id,
      drawingFilePath: itemRevisions.drawingFilePath,
      drawingNo: itemRevisions.drawingNo,
      itemCode: items.code,
    })
    .from(itemRevisions)
    .innerJoin(items, eq(items.id, itemRevisions.itemId))
    .where(
      and(
        eq(itemRevisions.companyId, companyId),
        eq(itemRevisions.itemId, input.itemId),
        eq(itemRevisions.rev, rev),
        isNull(itemRevisions.deletedAt),
      ),
    )
    .for('update', { of: itemRevisions })
    .limit(1);
  if (!row) throw new ValidationError(`Drawing Rev ${rev} could not be saved — try again`);

  if (offered && row.drawingFilePath && offered !== row.drawingFilePath) {
    throw new ValidationError(
      `Drawing differs from ${itemRevLabel(row.itemCode, rev)} — make a new Drawing Rev or use Replace drawing with a reason`,
    );
  }
  if (offered && !row.drawingFilePath) {
    await tx
      .update(itemRevisions)
      .set({ drawingFilePath: offered, drawingNo: offeredNo ?? row.drawingNo, updatedBy: user.id })
      .where(eq(itemRevisions.id, row.id));
    await tx.insert(itemRevisionDrawings).values({
      companyId,
      itemRevisionId: row.id,
      action: input.copiedFromOtherRev ? 'copied' : 'adopted',
      drawingFilePath: offered,
      drawingNo: offeredNo ?? row.drawingNo,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      createdBy: user.id,
      updatedBy: user.id,
    });
    return {
      id: row.id,
      rev,
      drawingFilePath: offered,
      drawingNo: offeredNo ?? row.drawingNo,
      created: false,
    };
  }
  return {
    id: row.id,
    rev,
    drawingFilePath: row.drawingFilePath,
    drawingNo: row.drawingNo,
    created: false,
  };
}

/** Read-only: the live ABC/<rev> row (no lock, no write), or null. Used by the
 *  line save to decide "Use as is" before calling resolveItemRevision. */
export async function findItemRevision(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  rev: string,
): Promise<{ id: string; drawingFilePath: string | null; drawingNo: string | null } | null> {
  const r = normalizeRevision(rev);
  if (r === '') return null;
  const [row] = await tx
    .select({
      id: itemRevisions.id,
      drawingFilePath: itemRevisions.drawingFilePath,
      drawingNo: itemRevisions.drawingNo,
    })
    .from(itemRevisions)
    .where(
      and(
        eq(itemRevisions.companyId, companyId),
        eq(itemRevisions.itemId, itemId),
        eq(itemRevisions.rev, r),
        isNull(itemRevisions.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface ReplaceItemRevisionDrawingArgs {
  drawingFilePath: string;
  drawingNo?: string | null | undefined;
  reason: string;
  expectedUpdatedAt?: string | undefined;
}

/**
 * "Replace drawing" — the ONLY way to change the file of an Item + Rev that
 * already has one. The caller checks the Route Card Master edit right.
 *
 * §20.4: the row is locked FOR UPDATE and compared with the updatedAt the
 * screen loaded (409 naming who changed it), then written with
 * `WHERE id = ? AND updated_at = <locked value>` and the row count checked.
 * The new file goes into item_revision_drawings ('replaced', with the reason;
 * the earlier rows keep the old file); the SO / JWSO line copies
 * (drawing_file_path / drawing_no) follow, and every SO line whose copy
 * changes gets its so_line_drawing_revisions row, as a line save writes it.
 */
export async function replaceItemRevisionDrawing(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  id: string,
  args: ReplaceItemRevisionDrawingArgs,
): Promise<{ soLines: number; jwLines: number }> {
  const [row] = await tx
    .select({
      id: itemRevisions.id,
      rev: itemRevisions.rev,
      drawingFilePath: itemRevisions.drawingFilePath,
      drawingNo: itemRevisions.drawingNo,
      updatedAt: itemRevisions.updatedAt,
      updatedBy: itemRevisions.updatedBy,
      itemCode: items.code,
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

  const [by] = await tx
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, row.updatedBy))
    .limit(1);
  assertUnchangedSinceOpened(row.updatedAt, args.expectedUpdatedAt, by?.fullName ?? null);

  const label = itemRevLabel(row.itemCode, row.rev);
  const newPath = args.drawingFilePath.trim();
  const reason = args.reason.trim();
  if (reason.length < 5) throw new ValidationError('Reason is required (at least 5 characters)');
  if (newPath === '') throw new ValidationError('Choose the new drawing file');
  if (newPath === row.drawingFilePath) {
    throw new ValidationError(`This file is already the drawing of ${label}`);
  }
  const newNo = args.drawingNo !== undefined ? args.drawingNo?.trim() || null : row.drawingNo;

  // §20.4 — conditional on the updated_at read under the lock; 0 rows = 409.
  const updated = await tx
    .update(itemRevisions)
    .set({ drawingFilePath: newPath, drawingNo: newNo, updatedBy: user.id })
    .where(and(eq(itemRevisions.id, id), eq(itemRevisions.updatedAt, row.updatedAt)))
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
      ],
      detail: `Drawing replaced on ${label} — ${so.length} SO line(s), ${jw.length} JWSO line(s) updated`,
    },
    companyId,
    user,
  );
  return { soLines: so.length, jwLines: jw.length };
}
