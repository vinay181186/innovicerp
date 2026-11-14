// ADR-290 — Drawing Register status actions on one Item + Drawing Rev:
// POST /item-revisions/:id/submit | approve | reject | release | obsolete.
// The ONE writer of item_revisions.release_status (with resolveItemRevision,
// which inserts 'draft', and Replace drawing, which sends an under-review /
// approved Rev back to 'draft').
//
// §20.2 / §20.4 — every action is ONE conditional UPDATE on the allowed FROM
// statuses AND the updated_at the screen loaded (to the millisecond). 0 rows =
// someone acted first: re-read and answer 409 naming who.
//
// Rights (packages/shared drawing-register.ts):
//   submit           — Drawing Register Entry or Edit
//   approve / reject / obsolete — Drawing Register Approve tick
//   release          — canReleaseDrawings (per-person switch; admin / L6 always)

import {
  ActivityAction,
  canReleaseDrawings,
  compareRevision,
  itemRevLabel,
  REV_CHANGE_REASON_MIN,
  REV_RELEASE_STATUS_LABELS,
  type RevReleaseStatus,
  type RevStatusAction,
  type RevStatusActionInput,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess } from '../../lib/access';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { fmtDateTime } from '../../lib/format-date';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { editConflicts, rowChangedByName } from '../../lib/row-changed-by';
import { emitActivityLog, emitActivityLogBatch } from '../activity-log/service';
import { getMyAccess } from '../access-control/service';
import { hashDrawingFile } from '../drawing-files/service';

interface RevRow {
  id: string;
  itemId: string;
  itemCode: string;
  rev: string;
  status: RevReleaseStatus;
  drawingFilePath: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  releasedBy: string | null;
  releasedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  obsoletedBy: string | null;
  obsoletedAt: Date | null;
}

const ALL: readonly RevReleaseStatus[] = [
  'unverified',
  'draft',
  'under_review',
  'approved',
  'released',
  'superseded',
  'rejected',
];

/** Allowed FROM statuses → TO status, per action. */
const MOVES: Record<RevStatusAction, { from: readonly RevReleaseStatus[]; to: RevReleaseStatus }> = {
  submit: { from: ['draft', 'rejected', 'unverified'], to: 'under_review' },
  approve: { from: ['under_review'], to: 'approved' },
  reject: { from: ['under_review', 'approved'], to: 'rejected' },
  release: { from: ['approved', 'unverified'], to: 'released' },
  obsolete: { from: ALL, to: 'obsolete' },
};

const ACTIVITY: Record<RevStatusAction, string> = {
  submit: 'SUBMIT',
  approve: 'APPROVE',
  reject: 'REJECT',
  release: 'RELEASE',
  obsolete: 'OBSOLETE',
};

const VERB: Record<RevStatusAction, string> = {
  submit: 'sent for review',
  approve: 'approved',
  reject: 'rejected',
  release: 'released',
  obsolete: 'made obsolete',
};

/** change_note of an old record verified and released with no note. */
const VERIFIED_NOTE = 'Verified from old record';

const ts = (v: unknown): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(String(v));

async function readRev(tx: DbTransaction, companyId: string, id: string): Promise<RevRow> {
  const rows = (await tx.execute(sql`
    SELECT ir.id, ir.item_id AS "itemId", i.code AS "itemCode", ir.rev,
           ir.release_status AS status, ir.drawing_file_path AS "drawingFilePath",
           ir.updated_at AS "updatedAt", ir.updated_by AS "updatedBy",
           ir.submitted_by AS "submittedBy", ir.submitted_at AS "submittedAt",
           ir.approved_by AS "approvedBy", ir.approved_at AS "approvedAt",
           ir.released_by AS "releasedBy", ir.released_at AS "releasedAt",
           ir.rejected_by AS "rejectedBy", ir.rejected_at AS "rejectedAt",
           ir.obsoleted_by AS "obsoletedBy", ir.obsoleted_at AS "obsoletedAt"
      FROM public.item_revisions ir JOIN public.items i ON i.id = ir.item_id
     WHERE ir.id = ${id}::uuid AND ir.company_id = ${companyId}::uuid AND ir.deleted_at IS NULL
     LIMIT 1`)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) throw new NotFoundError('Drawing Rev not found');
  return {
    ...(r as unknown as RevRow),
    updatedAt: ts(r['updatedAt'])!,
    submittedAt: ts(r['submittedAt']),
    approvedAt: ts(r['approvedAt']),
    releasedAt: ts(r['releasedAt']),
    rejectedAt: ts(r['rejectedAt']),
    obsoletedAt: ts(r['obsoletedAt']),
  };
}

/** "is already Approved by Jinal at 14-11-2026 02:35 PM" — the state that
 *  refused an action, naming who put it there. */
async function stateText(tx: DbTransaction, r: RevRow): Promise<string> {
  const who: Partial<Record<RevReleaseStatus, [string | null, Date | null]>> = {
    under_review: [r.submittedBy, r.submittedAt],
    approved: [r.approvedBy, r.approvedAt],
    released: [r.releasedBy, r.releasedAt],
    rejected: [r.rejectedBy, r.rejectedAt],
    obsolete: [r.obsoletedBy, r.obsoletedAt],
  };
  const [by, at] = who[r.status] ?? [r.updatedBy, r.updatedAt];
  const name = await rowChangedByName(tx, by);
  return `is ${REV_RELEASE_STATUS_LABELS[r.status]}${name ? ` by ${name}` : ''}${at ? ` at ${fmtDateTime(at)}` : ''}`;
}

async function requireRight(action: RevStatusAction, user: AuthContext): Promise<void> {
  if (action === 'submit') {
    await requireAnyFormAccess(user, [
      ['drawingreg_create', 'entry'],
      ['drawingreg_create', 'edit'],
    ]);
    return;
  }
  if (action === 'release') {
    if (user.role === 'admin') return;
    if (!canReleaseDrawings(await getMyAccess(user), user.role)) {
      throw new AuthorizationError(
        'Releasing a drawing needs the "Can release drawings" switch. Ask an admin.',
      );
    }
    return;
  }
  await requireFormAccess(user, 'drawingreg_create', 'approve');
}

/** The columns an action stamps besides release_status. */
function stamps(action: RevStatusAction, userId: string, note: string | null, fileHash: string | null) {
  switch (action) {
    case 'submit':
      return sql`, change_note = COALESCE(${note}, change_note), submitted_at = now(), submitted_by = ${userId}::uuid,
                 rejected_at = NULL, rejected_by = NULL, reject_reason = NULL`;
    case 'approve':
      return sql`, approved_at = now(), approved_by = ${userId}::uuid`;
    case 'reject':
      return sql`, rejected_at = now(), rejected_by = ${userId}::uuid, reject_reason = ${note}`;
    case 'release':
      // "Verify & Release" of an old (unverified) record: it never went
      // through review, so the release also stands as its approval and the
      // change note says where it came from. (The RHS reads the OLD status.)
      return sql`, released_at = now(), released_by = ${userId}::uuid, file_hash = ${fileHash},
                 approved_at = CASE WHEN release_status = 'unverified' THEN now() ELSE approved_at END,
                 approved_by = CASE WHEN release_status = 'unverified' THEN ${userId}::uuid ELSE approved_by END,
                 change_note = CASE WHEN release_status = 'unverified'
                                    THEN COALESCE(NULLIF(btrim(change_note), ''), ${note}::text, ${VERIFIED_NOTE}::text)
                                    ELSE change_note END`;
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
  await requireRight(action, user);
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const note = input.note?.trim() || null;
  if ((action === 'reject' || action === 'obsolete') && (note?.length ?? 0) < REV_CHANGE_REASON_MIN) {
    throw new ValidationError('Reason is required (at least 5 characters)');
  }
  const move = MOVES[action];

  // Release: the file is hashed BEFORE the transaction (a storage read is
  // slow); the UPDATE below is conditional on the same path, so a file
  // replaced in between refuses instead of storing the wrong hash.
  let fileHash: string | null = null;
  let hashedPath: string | null = null;
  if (action === 'release') {
    const pre = await withUserContext(user, (tx) => readRev(tx, companyId, id));
    if (!pre.drawingFilePath) {
      throw new ValidationError('Upload the drawing before releasing it');
    }
    hashedPath = pre.drawingFilePath;
    fileHash = await hashDrawingFile(hashedPath);
    if (!fileHash) {
      throw new ValidationError(
        `The drawing file of ${itemRevLabel(pre.itemCode, pre.rev)} could not be read — upload it again before release`,
      );
    }
  }

  await withUserContext(user, async (tx) => {
    const cur = await readRev(tx, companyId, id);
    const label = itemRevLabel(cur.itemCode, cur.rev);
    if (!move.from.includes(cur.status)) {
      throw new ConflictError(`Cannot ${action} ${label}: it ${await stateText(tx, cur)}. Reload the page.`);
    }
    if (editConflicts(cur.updatedAt, input.expectedUpdatedAt)) {
      assertUnchangedSinceOpened(
        cur.updatedAt,
        input.expectedUpdatedAt,
        await rowChangedByName(tx, cur.updatedBy),
      );
    }
    if (action === 'submit' && !cur.drawingFilePath) {
      throw new ValidationError('Upload the drawing before sending it for review');
    }

    // Release supersedes other Revs of the same item: lock every live Rev of
    // the item in id order first, so two releases of one item queue.
    if (action === 'release') {
      await tx.execute(sql`
        SELECT id FROM public.item_revisions
         WHERE company_id = ${companyId}::uuid AND item_id = ${cur.itemId}::uuid AND deleted_at IS NULL
         ORDER BY id FOR UPDATE`);
    }

    // §20.2 + §20.4 — one conditional UPDATE.
    const updated = (await tx.execute(sql`
      UPDATE public.item_revisions
         SET release_status = ${move.to}, updated_by = ${user.id}::uuid
             ${stamps(action, user.id, note, fileHash)}
       WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
         AND release_status = ANY(${sql.param([...move.from])}::text[])
         AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${cur.updatedAt.toISOString()}::timestamptz)
         ${hashedPath ? sql`AND drawing_file_path = ${hashedPath}` : sql``}
      RETURNING id`)) as unknown as Array<{ id: string }>;
    if (updated.length === 0) {
      const now = await readRev(tx, companyId, id);
      throw new ConflictError(
        `Cannot ${action} ${label}: it ${await stateText(tx, now)}${
          hashedPath && now.drawingFilePath !== hashedPath ? ' and its drawing was replaced' : ''
        }. Reload the page.`,
      );
    }

    // ADR-290 — release from 'unverified' = "Verify & Release" (old record).
    const verified = action === 'release' && cur.status === 'unverified';
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
            label: 'Release Status',
            before: REV_RELEASE_STATUS_LABELS[cur.status],
            after: REV_RELEASE_STATUS_LABELS[move.to],
          },
        ],
        detail: `${label} ${verified ? '— Verified & released' : VERB[action]} by ${user.fullName || user.email}${note ? ` — ${note}` : ''}`,
      },
      companyId,
      user,
    );

    if (action === 'release') await supersedeOlder(tx, user, companyId, cur);
  });
}

/**
 * At most ONE Released Rev per item. After a release, the winner among every
 * released Rev of the item (this one included) is the one that compares
 * HIGHEST (lib/revision compareRevision); when two cannot be compared, the
 * NEWEST release wins. Every other released Rev → superseded, conditional on
 * release_status = 'released' — so releasing ABC/2 while ABC/3 is released
 * makes ABC/2 superseded at once, in the same transaction. The item's Revs
 * are locked (id order) before the release UPDATE.
 */
async function supersedeOlder(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  cur: RevRow,
): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT id, rev, released_at AS "releasedAt" FROM public.item_revisions
     WHERE company_id = ${companyId}::uuid AND item_id = ${cur.itemId}::uuid AND deleted_at IS NULL
       AND release_status = 'released'`)) as unknown as Array<{
    id: string;
    rev: string;
    releasedAt: unknown;
  }>;
  const released = rows.map((r) => ({ ...r, at: ts(r.releasedAt)?.getTime() ?? 0 }));
  let winner = released.find((r) => r.id === cur.id);
  if (!winner) return;
  for (const o of released) {
    if (o.id === winner.id) continue;
    const c = compareRevision(o.rev, winner.rev);
    if (c !== null ? c > 0 : o.at > winner.at) winner = o;
  }
  const losers = released.filter((r) => r.id !== winner.id);
  if (losers.length === 0) return;
  const done = (await tx.execute(sql`
    UPDATE public.item_revisions
       SET release_status = 'superseded', superseded_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ANY(${sql.param(losers.map((o) => o.id))}::uuid[]) AND release_status = 'released'
    RETURNING id, rev`)) as unknown as Array<{ id: string; rev: string }>;
  const winLabel = itemRevLabel(cur.itemCode, winner.rev);
  await emitActivityLogBatch(
    tx,
    done.map((d) => ({
      action: ActivityAction.Edit,
      entity: 'ItemRevision',
      entityId: d.id,
      refId: itemRevLabel(cur.itemCode, d.rev),
      changes: [
        {
          field: 'releaseStatus',
          label: 'Release Status',
          before: REV_RELEASE_STATUS_LABELS.released,
          after: REV_RELEASE_STATUS_LABELS.superseded,
        },
      ],
      detail:
        d.id === cur.id
          ? `${itemRevLabel(cur.itemCode, d.rev)} superseded at once — ${winLabel} is already released`
          : `${itemRevLabel(cur.itemCode, d.rev)} superseded — ${winLabel} released`,
    })),
    companyId,
    user,
  );
}
