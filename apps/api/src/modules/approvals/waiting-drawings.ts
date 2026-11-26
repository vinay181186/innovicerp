// ADR-323 — Drawing Register rows of the Approvals waiting list:
//   rev   Drawing to verify: an Unverified Rev WITH a PDF used on an open
//         SO / JWSO line → POST /item-revisions/:id/verify
// Read with the SAME right as the verify endpoint (release.ts: Drawing
// Register Approve tick), so every row is one the caller's ✓ is accepted on.
// The raiser is NOT excluded (owner 23-Nov: self-approval allowed).

import { itemRevLabel, WAITING_APPROVALS_LIMIT, type WaitingApprovalRow } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { revStatusWords } from '../../lib/item-revision';
import { DRAWING_TYPE_LABELS, toIso } from './waiting-text';

interface DrawingWaiting {
  id: string;
  itemCode: string;
  itemName: string | null;
  rev: string;
  raisedByName: string | null;
  raisedAt: unknown;
  updatedAt: unknown;
}

const nameOf = (alias: string) =>
  sql.raw(`COALESCE(NULLIF(btrim(${alias}.full_name), ''), split_part(${alias}.email, '@', 1))`);

/** Order statuses that end a line's open life (header or line) — the
 *  Drawing Register's Open Lines rule (register.ts). */
const DONE = sql`('closed', 'dispatched', 'cancelled')`;

export interface DrawingApprovals {
  canApprove: boolean;
  rows: WaitingApprovalRow[];
  counts: Array<[string, number]>;
}

export async function readDrawingApprovals(
  user: AuthContext,
  companyId: string,
): Promise<DrawingApprovals> {
  if (!(await hasFormAccess(user, 'drawingreg_create', 'approve'))) {
    return { canApprove: false, rows: [], counts: [] };
  }

  // "Raised" = the latest PDF upload (first file or replace) of the Rev.
  const toVerify = await withUserContext(
    user,
    async (tx) =>
      (await tx.execute(sql`
      SELECT r.id, i.code AS "itemCode", i.name AS "itemName", r.rev,
             ${nameOf('u')} AS "raisedByName",
             COALESCE(d.created_at, r.updated_at) AS "raisedAt",
             r.updated_at AS "updatedAt"
        FROM public.item_revisions r
        JOIN public.items i ON i.id = r.item_id
        LEFT JOIN LATERAL (
          SELECT x.created_at, x.created_by FROM public.item_revision_drawings x
           WHERE x.item_revision_id = r.id AND x.deleted_at IS NULL
           ORDER BY x.created_at DESC LIMIT 1) d ON TRUE
        LEFT JOIN public.users u ON u.id = COALESCE(d.created_by, r.updated_by)
       WHERE r.company_id = ${companyId}::uuid AND r.deleted_at IS NULL
         AND r.release_status = ANY(${sql.param(revStatusWords('unverified'))}::text[])
         AND NULLIF(btrim(r.drawing_file_path), '') IS NOT NULL
         AND (EXISTS (SELECT 1 FROM public.sales_order_lines l
                        JOIN public.sales_orders h ON h.id = l.sales_order_id
                       WHERE l.item_revision_id = r.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL
                         AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE})
           OR EXISTS (SELECT 1 FROM public.job_work_order_lines l
                        JOIN public.job_work_orders h ON h.id = l.job_work_order_id
                       WHERE l.item_revision_id = r.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL
                         AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE}))
       ORDER BY 6 DESC, r.id DESC
       LIMIT ${WAITING_APPROVALS_LIMIT}`)) as unknown as DrawingWaiting[],
  );

  const rows: WaitingApprovalRow[] = toVerify.map((w) => ({
    kind: 'rev',
    id: w.id,
    typeKey: 'rev',
    typeLabel: DRAWING_TYPE_LABELS.rev,
    docCode: itemRevLabel(w.itemCode, w.rev),
    // The Drawing Rev page (web route drawings/$itemRevisionId).
    docHref: `/drawings/${w.id}`,
    request: 'Drawing to verify',
    itemCode: w.itemCode,
    itemName: w.itemName,
    raisedByName: w.raisedByName,
    raisedAt: toIso(w.raisedAt),
    mode: 'direct',
    changes: [],
    isStale: false,
    version: toIso(w.updatedAt),
  }));

  return { canApprove: true, rows, counts: [['rev', toVerify.length]] };
}
