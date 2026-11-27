// ADR-323 — Drawing Register status actions on one Item + Drawing Rev:
// POST /item-revisions/:id/verify | unverify | obsolete.
// Writers of item_revisions.release_status: this file, resolveItemRevision
// (inserts 'unverified') and Replace drawing (a different file turns a
// Verified Rev back to 'unverified').
//
// §20.2 / §20.4 — every action is ONE conditional UPDATE on the allowed FROM
// statuses (their legacy ADR-290 words included until 0264) AND the updated_at
// the screen loaded (to the millisecond). 0 rows = someone acted first:
// re-read and answer 409 naming who.
//
// Rights (packages/shared drawing-register.ts): Drawing Register Approve tick
// for all three; self-verify allowed.
//   verify   — unverified → verified; needs a PDF; stores the file hash and
//              Verified On / By (released_at / released_by)
//   unverify — verified → unverified (note ≥ 5)
//   obsolete — any but obsolete → obsolete (note ≥ 5)

import {
  ActivityAction,
  itemRevLabel,
  normalizeRevStatus,
  REV_CHANGE_REASON_MIN,
  REV_RELEASE_STATUS_LABELS,
  type RevReleaseStatus,
  type RevStatusAction,
  type RevStatusActionInput,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { fmtDateTime } from '../../lib/format-date';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { revStatusWords } from '../../lib/item-revision';
import { editConflicts, rowChangedByName } from '../../lib/row-changed-by';
import { emitActivityLog } from '../activity-log/service';
import { hashDrawingFile } from '../drawing-files/service';

interface RevRow {
  id: string;
  itemCode: string;
  rev: string;
  status: RevReleaseStatus;
  drawingFilePath: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  releasedBy: string | null;
  releasedAt: Date | null;
  obsoletedBy: string | null;
  obsoletedAt: Date | null;
}

/** Allowed FROM statuses → TO status, per action. */
const MOVES: Record<RevStatusAction, { from: readonly RevReleaseStatus[]; to: RevReleaseStatus }> =
  {
    verify: { from: ['unverified'], to: 'verified' },
    unverify: { from: ['verified'], to: 'unverified' },
    obsolete: { from: ['unverified', 'verified'], to: 'obsolete' },
  };

const ACTIVITY: Record<RevStatusAction, string> = {
  verify: ActivityAction.Approve,
  unverify: ActivityAction.Edit,
  obsolete: 'OBSOLETE',
};

const VERB: Record<RevStatusAction, string> = {
  verify: 'verified',
  unverify: 'set back to Unverified',
  obsolete: 'made obsolete',
};

const ts = (v: unknown): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(String(v));

async function readRev(tx: DbTransaction, companyId: string, id: string): Promise<RevRow> {
  const rows = (await tx.execute(sql`
    SELECT ir.id, i.code AS "itemCode", ir.rev,
           ir.release_status AS status, ir.drawing_file_path AS "drawingFilePath",
           ir.updated_at AS "updatedAt", ir.updated_by AS "updatedBy",
           ir.released_by AS "releasedBy", ir.released_at AS "releasedAt",
           ir.obsoleted_by AS "obsoletedBy", ir.obsoleted_at AS "obsoletedAt"
      FROM public.item_revisions ir JOIN public.items i ON i.id = ir.item_id
     WHERE ir.id = ${id}::uuid AND ir.company_id = ${companyId}::uuid AND ir.deleted_at IS NULL
     LIMIT 1`)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) throw new NotFoundError('Drawing Rev not found');
  return {
    ...(r as unknown as RevRow),
    status: normalizeRevStatus(r['status'] as string | null),
    updatedAt: ts(r['updatedAt'])!,
    releasedAt: ts(r['releasedAt']),
    obsoletedAt: ts(r['obsoletedAt']),
  };
}

/** "is already Verified by Jinal at 14-11-2026 02:35 PM" — the state that
 *  refused an action, naming who put it there. */
async function stateText(tx: DbTransaction, r: RevRow): Promise<string> {
  const who: Partial<Record<RevReleaseStatus, [string | null, Date | null]>> = {
    verified: [r.releasedBy, r.releasedAt],
    obsolete: [r.obsoletedBy, r.obsoletedAt],
  };
  const [by, at] = who[r.status] ?? [r.updatedBy, r.updatedAt];
  const name = await rowChangedByName(tx, by);
  return `is ${REV_RELEASE_STATUS_LABELS[r.status]}${name ? ` by ${name}` : ''}${at ? ` at ${fmtDateTime(at)}` : ''}`;
}

/** The columns an action stamps besides release_status. */
function stamps(action: RevStatusAction, userId: string, fileHash: string | null) {
  switch (action) {
    case 'verify':
      return sql`, released_at = now(), released_by = ${userId}::uuid, file_hash = ${fileHash}`;
    case 'unverify':
      return sql`, released_at = NULL, released_by = NULL, file_hash = NULL`;
    case 'obsolete':
      return sql`, obsoleted_at = now(), obsoleted_by = ${userId}::uuid`;
  }
}

/** Run one status action (the route re-reads the detail afterwards). */
export async function revStatusAction(
  id: string,
  action: RevStatusAction,
  input: RevStatusActionInput,
  user: AuthContext,
): Promise<void> {
  await requireFormAccess(user, 'drawingreg_create', 'approve');
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const note = input.note?.trim() || null;
  if (
    (action === 'unverify' || action === 'obsolete') &&
    (note?.length ?? 0) < REV_CHANGE_REASON_MIN
  ) {
    throw new ValidationError('Reason is required (at least 5 characters)');
  }
  const move = MOVES[action];
  const fromWords = move.from.flatMap(revStatusWords);

  // Verify: the file is hashed BEFORE the transaction (a storage read is
  // slow); the UPDATE below is conditional on the same path, so a file
  // replaced in between refuses instead of storing the wrong hash.
  let fileHash: string | null = null;
  let hashedPath: string | null = null;
  if (action === 'verify') {
    const pre = await withUserContext(user, (tx) => readRev(tx, companyId, id));
    if (!pre.drawingFilePath) {
      throw new ValidationError('Upload the drawing PDF before verifying it');
    }
    if (
      input.expectedDrawingFilePath !== undefined &&
      input.expectedDrawingFilePath !== null &&
      input.expectedDrawingFilePath !== pre.drawingFilePath
    ) {
      throw new ConflictError('The drawing changed — open it again before verifying.');
    }
    hashedPath = pre.drawingFilePath;
    fileHash = await hashDrawingFile(hashedPath);
    if (!fileHash) {
      throw new ValidationError(
        `The drawing file of ${itemRevLabel(pre.itemCode, pre.rev)} could not be read — upload it again before verifying`,
      );
    }
  }

  await withUserContext(user, async (tx) => {
    const cur = await readRev(tx, companyId, id);
    const label = itemRevLabel(cur.itemCode, cur.rev);
    if (!move.from.includes(cur.status)) {
      throw new ConflictError(
        `Cannot ${action} ${label}: it ${await stateText(tx, cur)}. Reload the page.`,
      );
    }
    if (editConflicts(cur.updatedAt, input.expectedUpdatedAt)) {
      assertUnchangedSinceOpened(
        cur.updatedAt,
        input.expectedUpdatedAt,
        await rowChangedByName(tx, cur.updatedBy),
      );
    }
    if (hashedPath && cur.drawingFilePath !== hashedPath) {
      throw new ConflictError('The drawing changed — open it again before verifying.');
    }

    // §20.2 + §20.4 — one conditional UPDATE.
    const updated = (await tx.execute(sql`
      UPDATE public.item_revisions
         SET release_status = ${move.to}, updated_by = ${user.id}::uuid
             ${stamps(action, user.id, fileHash)}
       WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
         AND release_status = ANY(${sql.param(fromWords)}::text[])
         AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${cur.updatedAt.toISOString()}::timestamptz)
         ${hashedPath ? sql`AND drawing_file_path = ${hashedPath}` : sql``}
      RETURNING id`)) as unknown as Array<{ id: string }>;
    if (updated.length === 0) {
      const now = await readRev(tx, companyId, id);
      if (hashedPath && now.drawingFilePath !== hashedPath) {
        throw new ConflictError('The drawing changed — open it again before verifying.');
      }
      throw new ConflictError(
        `Cannot ${action} ${label}: it ${await stateText(tx, now)}. Reload the page.`,
      );
    }

    await emitActivityLog(
      tx,
      {
        action: ACTIVITY[action],
        entity: 'ItemRevision',
        entityId: id,
        refId: label,
        reason: note,
        changes: [
          {
            field: 'releaseStatus',
            label: 'Drawing Rev Status',
            before: REV_RELEASE_STATUS_LABELS[cur.status],
            after: REV_RELEASE_STATUS_LABELS[move.to],
          },
        ],
        detail: `${label} ${VERB[action]} by ${user.fullName || user.email}${note ? ` — ${note}` : ''}`,
      },
      companyId,
      user,
    );
  });
}
