// ADR-290 — Drawing Register list: GET /item-revisions/register. One row per
// live Item + Drawing Rev with its release status, how many open SO / JWSO
// lines and open Job Cards use it, and whether a drawing correction waits.
// Right: Drawing Register View. 25 rows a page; Sort & Filter ADR-200.
// Also POST /item-revisions — a new Drawing Rev added in the register
// (createDrawingRev, Drawing Register Entry right).

import {
  ActivityAction,
  type CreateDrawingRevInput,
  itemRevLabel,
  REV_RELEASE_STATUS_LABELS,
  type DrawingRegisterRow,
  type ListDrawingRegisterQuery,
  type ListDrawingRegisterResponse,
  type RevReleaseStatus,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { resolveItemRevision } from '../../lib/item-revision';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { emitActivityLog } from '../activity-log/service';
import { DRAWING_REGISTER_SF_COLUMNS } from './sf-columns';

/** Order statuses that end a line's open life (header or line). */
const DONE = sql`('closed', 'dispatched', 'cancelled')`;

/** The rows themselves (aliases ir, i, ru) — all the count needs unless a
 *  filter reads one of the three counts below. */
const BASE_FROM = sql`
  FROM public.item_revisions ir
  JOIN public.items i ON i.id = ir.item_id
  LEFT JOIN public.users ru ON ru.id = ir.released_by`;

/** Open lines / open Job Cards / pending correction (aliases ol, oj, pc). */
const COUNTS = sql`
  LEFT JOIN LATERAL (
    SELECT (
      (SELECT COUNT(*) FROM public.sales_order_lines l
         JOIN public.sales_orders h ON h.id = l.sales_order_id
        WHERE l.item_revision_id = ir.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL
          AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE})
    + (SELECT COUNT(*) FROM public.job_work_order_lines l
         JOIN public.job_work_orders h ON h.id = l.job_work_order_id
        WHERE l.item_revision_id = ir.id AND l.deleted_at IS NULL AND h.deleted_at IS NULL
          AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE})
    )::int AS n) ol ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS n FROM public.job_cards jc
      LEFT JOIN public.v_jc_status js ON js.job_card_id = jc.id
     WHERE jc.item_revision_id = ir.id AND jc.deleted_at IS NULL
       AND COALESCE(js.computed_status, 'open') NOT IN ('complete', 'closed')) oj ON TRUE
  LEFT JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM public.drawing_corrections c
                    WHERE c.item_revision_id = ir.id AND c.status = 'pending'
                      AND c.deleted_at IS NULL) AS pending) pc ON TRUE`;

/** Sort & Filter fields read from COUNTS (sf-columns.ts ol / oj / pc). */
const COUNT_FIELDS: ReadonlySet<string> = new Set([
  'openLines',
  'openJobCards',
  'pendingCorrection',
]);

export async function listDrawingRegister(
  q: ListDrawingRegisterQuery,
  user: AuthContext,
): Promise<ListDrawingRegisterResponse> {
  await requireFormAccess(user, 'drawingreg_create', 'view');
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const sf = readSf(q.sf);
  return withUserContext(user, async (tx) => {
    const term = q.search ? `%${likeEscape(q.search.trim())}%` : null;
    const where = sql`
      WHERE ir.company_id = ${companyId}::uuid AND ir.deleted_at IS NULL
        ${q.status ? sql`AND ir.release_status = ${q.status}` : sql``}
        ${
          term
            ? // '\\' in the source = ESCAPE '\' in SQL (a bare '\' in a template
              // literal is an escape and sent ESCAPE '' — "_" then matched any char).
              sql`AND (i.code ILIKE ${term} ESCAPE '\\' OR i.name ILIKE ${term} ESCAPE '\\'
                     OR i.customer_part_no ILIKE ${term} ESCAPE '\\' OR ir.rev ILIKE ${term} ESCAPE '\\'
                     OR ir.drawing_no ILIKE ${term} ESCAPE '\\'
                     OR (i.code || '/' || ir.rev) ILIKE ${term} ESCAPE '\\')`
            : sql``
        }
        ${sfWhere(DRAWING_REGISTER_SF_COLUMNS, sf)}`;
    const rows = (await tx.execute(sql`
      SELECT ir.id, ir.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
             i.customer_part_no AS "customerPartNo", ir.rev, ir.drawing_no AS "drawingNo",
             (NULLIF(btrim(ir.drawing_file_path), '') IS NOT NULL) AS "hasFile",
             ir.release_status AS "releaseStatus", ir.released_at AS "releasedAt",
             CASE WHEN ru.id IS NULL THEN NULL
                  ELSE COALESCE(NULLIF(btrim(ru.full_name), ''), split_part(ru.email, '@', 1)) END
               AS "releasedByName",
             ol.n AS "openLines", oj.n AS "openJobCards", pc.pending AS "pendingCorrection",
             ir.updated_at AS "updatedAt"
      ${BASE_FROM} ${COUNTS} ${where}
      ORDER BY ${sfOrderBy(DRAWING_REGISTER_SF_COLUMNS, sf, sql`i.code, ir.rev, ir.id`)}
      LIMIT ${q.limit} OFFSET ${q.offset}`)) as unknown as Array<Record<string, unknown>>;
    // The count runs the three LATERAL subqueries only when a filter reads
    // one of them (a sort never changes the count).
    const countNeedsCounts = (sf?.filters ?? []).some((f) => COUNT_FIELDS.has(f.field));
    const total = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n ${BASE_FROM} ${countNeedsCounts ? COUNTS : sql``} ${where}`)) as unknown as Array<{
      n: number;
    }>;
    const iso = (v: unknown): string | null =>
      v == null ? null : v instanceof Date ? v.toISOString() : String(v);
    const items: DrawingRegisterRow[] = rows.map((r) => ({
      id: r['id'] as string,
      itemId: r['itemId'] as string,
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      customerPartNo: (r['customerPartNo'] as string | null) ?? null,
      drawingRev: r['rev'] as string,
      label: itemRevLabel(r['itemCode'] as string | null, r['rev'] as string),
      drawingNo: (r['drawingNo'] as string | null) ?? null,
      hasFile: r['hasFile'] === true,
      releaseStatus: r['releaseStatus'] as RevReleaseStatus,
      releasedAt: iso(r['releasedAt']),
      releasedByName: (r['releasedByName'] as string | null) ?? null,
      openLines: Number(r['openLines'] ?? 0),
      openJobCards: Number(r['openJobCards'] ?? 0),
      pendingCorrection: r['pendingCorrection'] === true,
      updatedAt: iso(r['updatedAt'])!,
    }));
    return { items, total: Number(total[0]?.n ?? 0) };
  });
}

/**
 * ADR-290 — a new Drawing Rev added in the Drawing Register (a customer's
 * ABC/2 that no order names yet). Make items only; the Rev must not exist yet
 * (409 naming the record). Created through resolveItemRevision — the one
 * writer of item_revisions — as 'draft' ("Not released"), source 'register'.
 * Returns the new id (the route re-reads the detail).
 */
export async function createDrawingRev(
  input: CreateDrawingRevInput,
  user: AuthContext,
): Promise<string> {
  await requireFormAccess(user, 'drawingreg_create', 'entry');
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  return withUserContext(user, async (tx) => {
    const [item] = (await tx.execute(sql`
      SELECT code, procurement_type AS "procurementType" FROM public.items
       WHERE id = ${input.itemId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
       LIMIT 1`)) as unknown as Array<{ code: string; procurementType: string | null }>;
    if (!item) throw new NotFoundError('Item not found');
    const label = itemRevLabel(item.code, input.rev);
    if (item.procurementType !== 'make') {
      throw new ValidationError(
        `${item.code} is not a make item — a Drawing Rev is only for make items`,
      );
    }
    const existing = async (): Promise<never> => {
      const [r] = (await tx.execute(sql`
        SELECT release_status AS status FROM public.item_revisions
         WHERE company_id = ${companyId}::uuid AND item_id = ${input.itemId}::uuid
           AND rev = ${input.rev} AND deleted_at IS NULL
         LIMIT 1`)) as unknown as Array<{ status: RevReleaseStatus }>;
      throw new ConflictError(
        `${label} already exists${r ? ` (${REV_RELEASE_STATUS_LABELS[r.status]})` : ''} — open it in the Drawing Register`,
      );
    };
    const pre = (await tx.execute(sql`
      SELECT 1 FROM public.item_revisions
       WHERE company_id = ${companyId}::uuid AND item_id = ${input.itemId}::uuid
         AND rev = ${input.rev} AND deleted_at IS NULL
       LIMIT 1`)) as unknown as unknown[];
    if (pre.length > 0) await existing();

    const res = await resolveItemRevision(tx, user, companyId, {
      itemId: input.itemId,
      rev: input.rev,
      drawingFilePath: input.drawingFilePath,
      drawingNo: input.drawingNo,
      sourceType: 'register',
      sourceRef: 'Drawing Register',
      changeNote: input.changeNote,
    });
    if (!res) throw new ValidationError('Drawing Rev is required');
    // Someone added the same Rev in the same moment: theirs stands (any file
    // adoption above rolls back with this transaction).
    if (!res.created) await existing();

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: 'ItemRevision',
        entityId: res.id,
        refId: label,
        reason: input.changeNote,
        detail: `${label} added in the Drawing Register — ${
          input.drawingFilePath ? 'Under Review (drawing file attached, ADR-311)' : 'Not released'
        }`,
      },
      companyId,
      user,
    );
    return res.id;
  });
}
