// ADR-311 — Drawing Register rows of the Approvals waiting list:
//   rev               Drawing Rev Under Review  → approve / reject
//   revRelease        Drawing Rev Approved      → release / reject
//   drawingCorrection pending correction of a released file → decide
// Each read uses the SAME right as its decide endpoint (release.ts requireRight,
// corrections.ts decideDrawingCorrection), so every row is one the caller's
// ✓ / ✗ is accepted on. The raiser is NOT excluded (owner 23-Nov: self-approval
// allowed — unlike readEcrApprovals).

import {
  canReleaseDrawings,
  itemRevLabel,
  WAITING_APPROVALS_LIMIT,
  type WaitingApprovalRow,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { getMyAccess } from '../access-control/service';
import { DRAWING_TYPE_LABELS, toIso } from './waiting-text';

interface DrawingWaiting {
  id: string;
  revId: string;
  itemCode: string;
  itemName: string | null;
  rev: string;
  ask: string | null;
  raisedByName: string | null;
  raisedAt: unknown;
  updatedAt: unknown;
}

const nameOf = (alias: string) =>
  sql.raw(`COALESCE(NULLIF(btrim(${alias}.full_name), ''), split_part(${alias}.email, '@', 1))`);

export interface DrawingApprovals {
  canApprove: boolean;
  rows: WaitingApprovalRow[];
  counts: Array<[string, number]>;
}

export async function readDrawingApprovals(
  user: AuthContext,
  companyId: string,
): Promise<DrawingApprovals> {
  const canRev = await hasFormAccess(user, 'drawingreg_create', 'approve');
  const canRelease =
    user.role === 'admin' || canReleaseDrawings(await getMyAccess(user), user.role);
  if (!canRev && !canRelease) return { canApprove: false, rows: [], counts: [] };

  const revRows = (status: 'under_review' | 'approved') =>
    withUserContext(
      user,
      async (tx) =>
        (await tx.execute(sql`
        SELECT r.id, r.id AS "revId", i.code AS "itemCode", i.name AS "itemName", r.rev,
               r.source_ref AS ask,
               ${status === 'under_review' ? nameOf('su') : nameOf('au')} AS "raisedByName",
               ${status === 'under_review' ? sql`COALESCE(r.submitted_at, r.updated_at)` : sql`COALESCE(r.approved_at, r.updated_at)`} AS "raisedAt",
               r.updated_at AS "updatedAt"
          FROM public.item_revisions r
          JOIN public.items i ON i.id = r.item_id
          LEFT JOIN public.users su ON su.id = r.submitted_by
          LEFT JOIN public.users au ON au.id = r.approved_by
         WHERE r.company_id = ${companyId}::uuid AND r.deleted_at IS NULL
           AND r.release_status = ${status}
         ORDER BY 8, r.id
         LIMIT ${WAITING_APPROVALS_LIMIT}`)) as unknown as DrawingWaiting[],
    );
  const corrections = () =>
    withUserContext(
      user,
      async (tx) =>
        (await tx.execute(sql`
        SELECT c.id, r.id AS "revId", i.code AS "itemCode", i.name AS "itemName", r.rev,
               c.reason AS ask, ${nameOf('u')} AS "raisedByName",
               c.created_at AS "raisedAt", c.updated_at AS "updatedAt"
          FROM public.drawing_corrections c
          JOIN public.item_revisions r ON r.id = c.item_revision_id
          JOIN public.items i ON i.id = r.item_id
          LEFT JOIN public.users u ON u.id = c.requested_by
         WHERE c.company_id = ${companyId}::uuid AND c.deleted_at IS NULL
           AND c.status = 'pending'
         ORDER BY c.created_at, c.id
         LIMIT ${WAITING_APPROVALS_LIMIT}`)) as unknown as DrawingWaiting[],
    );

  const [toApprove, toRelease, toCorrect] = await Promise.all([
    canRev ? revRows('under_review') : Promise.resolve([] as DrawingWaiting[]),
    canRelease ? revRows('approved') : Promise.resolve([] as DrawingWaiting[]),
    canRelease ? corrections() : Promise.resolve([] as DrawingWaiting[]),
  ]);

  const rows: WaitingApprovalRow[] = [];
  const push = (
    kind: 'rev' | 'revRelease' | 'drawingCorrection',
    list: DrawingWaiting[],
    request: (w: DrawingWaiting) => string,
  ) => {
    for (const w of list) {
      rows.push({
        kind,
        id: w.id,
        typeKey: kind,
        typeLabel: DRAWING_TYPE_LABELS[kind],
        docCode: itemRevLabel(w.itemCode, w.rev),
        docHref: `/drawings/${w.revId}`,
        request: request(w),
        itemCode: w.itemCode,
        itemName: w.itemName,
        raisedByName: w.raisedByName,
        raisedAt: toIso(w.raisedAt),
        mode: 'direct',
        changes: [],
        isStale: false,
        version: kind === 'drawingCorrection' ? null : toIso(w.updatedAt),
      });
    }
  };
  push('rev', toApprove, (w) => (w.ask ? `Approve drawing · ${w.ask}` : 'Approve drawing'));
  push('revRelease', toRelease, () => 'Release drawing');
  push('drawingCorrection', toCorrect, (w) => `Replace file: ${w.ask ?? ''}`.trim());

  return {
    canApprove: true,
    rows,
    counts: [
      ['rev', toApprove.length],
      ['revRelease', toRelease.length],
      ['drawingCorrection', toCorrect.length],
    ],
  };
}
