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
//   • ADR-323 — a new row is 'unverified'; getting a first file never changes
//     the status (Design verifies it in the Drawing Register).

import {
  normalizeRevision,
  REVISION_PATTERN,
  isRevWorkAllowed,
  itemRevLabel,
  LEGACY_UNVERIFIED_STATUSES,
  LEGACY_VERIFIED_STATUSES,
  normalizeRevStatus,
  revNotReleasedMessage,
  type ItemRevisionSource,
  type RevReleaseStatus,
} from '@innovic/shared';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { itemRevisionDrawings, itemRevisions, items } from '../db/schema';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';

// ─── Reading release_status (ADR-323) ─────────────────────────────────────
// Until 0264 the column may still hold an ADR-290 word. Every SQL read goes
// through revStatusSql, every filter / conditional UPDATE through
// revStatusWords — the SQL twin of normalizeRevStatus (packages/shared).

const VERIFIED_WORDS = ['verified', ...LEGACY_VERIFIED_STATUSES] as const;

/** SQL: a raw release_status column → 'unverified' | 'verified' | 'obsolete'. */
export function revStatusSql(col: SQL | string): SQL {
  const c = typeof col === 'string' ? sql.raw(col) : col;
  return sql`(CASE WHEN ${c} IN ('verified', 'released', 'superseded', 'approved') THEN 'verified'
                   WHEN ${c} = 'obsolete' THEN 'obsolete' ELSE 'unverified' END)`;
}

/** Every stored word that reads as `status` (for `= ANY(...)`). */
export function revStatusWords(status: RevReleaseStatus): string[] {
  if (status === 'verified') return [...VERIFIED_WORDS];
  if (status === 'obsolete') return ['obsolete'];
  return ['unverified', ...LEGACY_UNVERIFIED_STATUSES];
}

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
  /** ADR-290 — "what changed in this Rev", stored on a NEW row only. */
  changeNote?: string | null | undefined;
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

  // ADR-323 — every new Rev is Unverified until Design verifies its PDF.
  const releaseStatus = 'unverified';
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO item_revisions (company_id, item_id, rev, drawing_file_path, drawing_no, source_type, source_ref, release_status, change_note, created_by, updated_by)
    VALUES (${companyId}, ${input.itemId}, ${rev}, ${offered ?? null}, ${offeredNo ?? null}, ${input.sourceType}, ${input.sourceRef}, ${releaseStatus}, ${input.changeNote?.trim() || null}, ${user.id}, ${user.id})
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

/** ADR-323 — a line's Drawing No. fills the register's Drawing No. when that
 *  is blank. Never overwrites a non-blank one (conditional UPDATE). Runs in
 *  the line save's transaction, after its line locks (ADR-289 lock order). */
export async function fillRevDrawingNo(
  tx: DbTransaction,
  companyId: string,
  revId: string | null | undefined,
  drawingNo: string | null | undefined,
): Promise<void> {
  const no = drawingNo?.trim();
  if (!revId || !no) return;
  await tx.execute(sql`
    UPDATE public.item_revisions SET drawing_no = ${no}
     WHERE id = ${revId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
       AND NULLIF(btrim(drawing_no), '') IS NULL`);
}

/** Read-only: the live ABC/<rev> row (no lock, no write), or null. Used by the
 *  line save to decide "Use as is" before calling resolveItemRevision. */
export async function findItemRevision(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  rev: string,
): Promise<{
  id: string;
  drawingFilePath: string | null;
  drawingNo: string | null;
  releaseStatus: string;
} | null> {
  const r = normalizeRevision(rev);
  if (r === '') return null;
  const [row] = await tx
    .select({
      id: itemRevisions.id,
      drawingFilePath: itemRevisions.drawingFilePath,
      drawingNo: itemRevisions.drawingNo,
      releaseStatus: itemRevisions.releaseStatus,
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

// Replace drawing + drawing corrections live in item-revision-drawing.ts (size).
export {
  replaceItemRevisionDrawing,
  type ReplaceItemRevisionDrawingArgs,
} from './item-revision-drawing';

/**
 * ADR-323 — the work rule, in ONE place. New Plan / PRO / Job Card work (and a
 * line Rev change that moves open work) may use a Verified or Unverified Rev
 * (REV_WORK_ALLOWED); only Obsolete is refused. No Rev (Buy item, blank) is
 * not decided here. `refusal` replaces the standard sentence where a screen
 * needs its own words.
 */
export async function assertRevReleasedForWork(
  tx: DbTransaction,
  companyId: string,
  itemRevisionId: string | null | undefined,
  refusal?: (label: string, status: RevReleaseStatus) => string,
): Promise<void> {
  if (!itemRevisionId) return;
  const [row] = await tx
    .select({ rev: itemRevisions.rev, status: itemRevisions.releaseStatus, itemCode: items.code })
    .from(itemRevisions)
    .innerJoin(items, eq(items.id, itemRevisions.itemId))
    .where(and(eq(itemRevisions.id, itemRevisionId), eq(itemRevisions.companyId, companyId)))
    .limit(1);
  if (!row) return;
  const status = normalizeRevStatus(row.status);
  if (isRevWorkAllowed(status)) return;
  const label = itemRevLabel(row.itemCode, row.rev);
  throw new ValidationError(
    refusal ? refusal(label, status) : revNotReleasedMessage(label, status),
  );
}
