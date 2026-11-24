// ADR-290 — drawing corrections on a released / superseded Rev (or an old
// unverified Rev with a file that open orders / Job Cards use).
// A "Replace drawing" on such a Rev writes a pending drawing_corrections row
// (lib/item-revision-drawing.ts); this file decides it:
//   POST /item-revisions/corrections/:id/decide {decision, note}
// Right: canReleaseDrawings. §20.2 — conditional on status = 'pending'; 0 rows
// = 409 naming who decided. Approve applies the file through the SAME body as
// Replace drawing (applyDrawingCorrection, §20.1) and stores the new file hash.
//
// LOCK ORDER — the Rev's SO / JWSO lines, then the Rev row, then the
// correction: the order Replace drawing takes them (lines → Rev → its
// correction insert), so a decide and a replace on one Rev queue.

import {
  ActivityAction,
  canReleaseDrawings,
  type DecideDrawingCorrectionInput,
  type DrawingCorrection,
  itemRevLabel,
  REV_CHANGE_REASON_MIN,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { fmtDateTime } from '../../lib/format-date';
import { applyDrawingCorrection, lockRevForDrawingChange } from '../../lib/item-revision-drawing';
import { emitActivityLog } from '../activity-log/service';
import { getMyAccess } from '../access-control/service';
import { hashDrawingFile } from '../drawing-files/service';

const nameSql = (alias: string): SQL =>
  sql.raw(`COALESCE(NULLIF(btrim(${alias}.full_name), ''), split_part(${alias}.email, '@', 1))`);
const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

const CORRECTION_SELECT = sql`
  SELECT c.id, c.item_revision_id AS "itemRevisionId", i.code AS "itemCode", ir.rev,
         c.drawing_file_path AS "drawingFilePath", c.drawing_no AS "drawingNo", c.reason,
         c.status, c.requested_by AS "requestedBy", ${nameSql('ru')} AS "requestedByName",
         c.requested_at AS "requestedAt", c.decided_by AS "decidedBy",
         CASE WHEN du.id IS NULL THEN NULL ELSE ${nameSql('du')} END AS "decidedByName",
         c.decided_at AS "decidedAt", c.decision_note AS "decisionNote"
    FROM public.drawing_corrections c
    JOIN public.item_revisions ir ON ir.id = c.item_revision_id
    JOIN public.items i ON i.id = ir.item_id
    LEFT JOIN public.users ru ON ru.id = c.requested_by
    LEFT JOIN public.users du ON du.id = c.decided_by`;

function toCorrection(r: Record<string, unknown>): DrawingCorrection {
  return {
    id: r['id'] as string,
    itemRevisionId: r['itemRevisionId'] as string,
    label: itemRevLabel(r['itemCode'] as string, r['rev'] as string),
    drawingFilePath: r['drawingFilePath'] as string,
    drawingNo: (r['drawingNo'] as string | null) ?? null,
    reason: r['reason'] as string,
    status: r['status'] as DrawingCorrection['status'],
    requestedBy: (r['requestedBy'] as string | null) ?? null,
    requestedByName: (r['requestedByName'] as string | null) ?? null,
    requestedAt: iso(r['requestedAt'])!,
    decidedBy: (r['decidedBy'] as string | null) ?? null,
    decidedByName: (r['decidedByName'] as string | null) ?? null,
    decidedAt: iso(r['decidedAt']),
    decisionNote: (r['decisionNote'] as string | null) ?? null,
  };
}

/** Every correction of one Rev, newest first (the Rev detail shows them). */
export async function listRevCorrections(
  tx: DbTransaction,
  companyId: string,
  itemRevisionId: string,
): Promise<DrawingCorrection[]> {
  const rows = (await tx.execute(sql`
    ${CORRECTION_SELECT}
     WHERE c.item_revision_id = ${itemRevisionId}::uuid AND c.company_id = ${companyId}::uuid
       AND c.deleted_at IS NULL
     ORDER BY c.requested_at DESC`)) as unknown as Array<Record<string, unknown>>;
  return rows.map(toCorrection);
}

async function readCorrection(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<DrawingCorrection> {
  const rows = (await tx.execute(sql`
    ${CORRECTION_SELECT}
     WHERE c.id = ${id}::uuid AND c.company_id = ${companyId}::uuid AND c.deleted_at IS NULL
     LIMIT 1`)) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) throw new NotFoundError('Drawing correction not found');
  return toCorrection(rows[0]);
}

/** Decide one pending correction. Returns the Rev id (the route re-reads it). */
export async function decideDrawingCorrection(
  id: string,
  input: DecideDrawingCorrectionInput,
  user: AuthContext,
): Promise<string> {
  if (user.role !== 'admin' && !canReleaseDrawings(await getMyAccess(user), user.role)) {
    throw new AuthorizationError(
      'Deciding a drawing correction needs the "Can release drawings" switch. Ask an admin.',
    );
  }
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const note = input.note?.trim() || null;
  if (input.decision === 'reject' && (note?.length ?? 0) < REV_CHANGE_REASON_MIN) {
    throw new ValidationError('Reason is required (at least 5 characters)');
  }

  // The new file is hashed before the transaction (a storage read is slow).
  const pre = await withUserContext(user, (tx) => readCorrection(tx, companyId, id));
  // ADR-311 — owner 23-Nov: self-approval allowed; the requester may approve their own correction.
  let fileHash: string | null = null;
  if (input.decision === 'approve') {
    fileHash = await hashDrawingFile(pre.drawingFilePath);
    if (!fileHash) {
      throw new ValidationError(
        `The corrected drawing of ${pre.label} could not be read — ask for the correction again`,
      );
    }
  }

  await withUserContext(user, async (tx) => {
    await lockRevForDrawingChange(tx, companyId, pre.itemRevisionId);
    const done = (await tx.execute(sql`
      UPDATE public.drawing_corrections
         SET status = ${input.decision === 'approve' ? 'approved' : 'rejected'},
             decided_by = ${user.id}::uuid, decided_at = now(), decision_note = ${note},
             updated_by = ${user.id}::uuid
       WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
         AND status = 'pending'
      RETURNING id`)) as unknown as Array<{ id: string }>;
    if (done.length === 0) {
      const now = await readCorrection(tx, companyId, id);
      throw new ConflictError(
        `The correction for ${now.label} was already ${now.status}${
          now.decidedByName ? ` by ${now.decidedByName}` : ''
        }${now.decidedAt ? ` at ${fmtDateTime(now.decidedAt)}` : ''}. Reload the page.`,
      );
    }
    if (input.decision === 'approve') {
      await applyDrawingCorrection(
        tx,
        user,
        companyId,
        pre.itemRevisionId,
        { drawingFilePath: pre.drawingFilePath, drawingNo: pre.drawingNo, reason: pre.reason },
        fileHash!,
      );
    }
    // The decision itself: APPROVE / REJECT on the correction (entity
    // DrawingCorrection — the Rev's own APPROVE / REJECT stays its status
    // decision). The note rules (dashboard/personal/note-rules.ts) tell the
    // requester and the Rev's creator. The file change of an approval is the
    // Rev's EDIT written by applyDrawingCorrection above.
    const approved = input.decision === 'approve';
    await emitActivityLog(
      tx,
      {
        action: approved ? ActivityAction.Approve : ActivityAction.Reject,
        entity: 'DrawingCorrection',
        entityId: id,
        refId: pre.label,
        reason: note,
        changes: [
          {
            field: 'status',
            label: 'Correction Status',
            before: 'Pending',
            after: approved ? 'Approved' : 'Rejected',
          },
        ],
        detail: `Drawing correction on ${pre.label} ${approved ? 'approved' : 'rejected'}${
          note ? ` — ${note}` : ''
        }`,
      },
      companyId,
      user,
    );
  });
  return pre.itemRevisionId;
}
