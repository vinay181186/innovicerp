// ADR-290 drawing corrections — retired by ADR-323 (a Replace drawing now
// applies at once and resets the status). No correction is raised or decided
// any more; 0263 closed the pending ones. The old rows are still read for the
// Rev detail page (history only).

import { type DrawingCorrection, itemRevLabel } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';

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
