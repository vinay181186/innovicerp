// Item + Drawing Rev register (ABC/1) — reads, Replace drawing, Rev change log.
// Contract: packages/shared/src/schemas/item-revision.ts. The register is
// WRITTEN only by lib/item-revision.ts (resolveItemRevision /
// replaceItemRevisionDrawing); this module reads it and calls those.
//
// Read access: any logged-in user of the company — the SO / JWSO / Route Card
// Item + Rev pickers need it (ADR-237 picker pattern; RLS keeps it to the
// company). Replace drawing: Route Card Master Edit.

import {
  itemRevLabel,
  type ItemRevision,
  type ItemRevisionChange,
  type ItemRevisionDetail,
  type ItemRevisionDrawingEvent,
  type ItemRevisionLinkedDoc,
  type ItemRevisionSource,
  type ListItemRevisionChangesQuery,
  type ListItemRevisionsQuery,
  type ListItemRevisionsResponse,
  type LookupItemRevisionQuery,
  type LookupItemRevisionResponse,
  type ReplaceItemRevisionDrawingInput,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { itemNeedsRev, replaceItemRevisionDrawing } from '../../lib/item-revision';
import { likeEscape } from '../../lib/list-query';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const ts = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const nameSql = (alias: string): SQL =>
  sql.raw(`COALESCE(NULLIF(btrim(${alias}.full_name), ''), split_part(${alias}.email, '@', 1))`);

/** Register columns + item + the one Route Card (live) for this Item + Rev. */
const REV_SELECT = sql`
  SELECT ir.id, ir.company_id AS "companyId", ir.item_id AS "itemId",
         i.code AS "itemCode", i.name AS "itemName", ir.rev,
         ir.drawing_file_path AS "drawingFilePath", ir.drawing_no AS "drawingNo",
         ir.source_type AS "sourceType", ir.source_ref AS "sourceRef",
         rc.id AS "routeCardId", rc.code AS "routeCardCode",
         ir.created_at AS "createdAt", ir.created_by AS "createdBy",
         ir.updated_at AS "updatedAt", ir.updated_by AS "updatedBy"
    FROM public.item_revisions ir
    JOIN public.items i ON i.id = ir.item_id
    LEFT JOIN public.route_cards rc
      ON rc.item_revision_id = ir.id AND rc.company_id = ir.company_id AND rc.deleted_at IS NULL`;

function toItemRevision(r: Record<string, unknown>): ItemRevision {
  const itemCode = (r['itemCode'] as string | null) ?? null;
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    itemId: r['itemId'] as string,
    itemCode,
    itemName: (r['itemName'] as string | null) ?? null,
    drawingRev: r['rev'] as string,
    label: itemRevLabel(itemCode, r['rev'] as string),
    drawingFilePath: (r['drawingFilePath'] as string | null) ?? null,
    drawingNo: (r['drawingNo'] as string | null) ?? null,
    sourceType: r['sourceType'] as ItemRevisionSource,
    sourceRef: (r['sourceRef'] as string | null) ?? null,
    routeCardId: (r['routeCardId'] as string | null) ?? null,
    routeCardCode: (r['routeCardCode'] as string | null) ?? null,
    createdAt: ts(r['createdAt']),
    createdBy: (r['createdBy'] as string | null) ?? null,
    updatedAt: ts(r['updatedAt']),
    updatedBy: (r['updatedBy'] as string | null) ?? null,
  };
}

export async function listItemRevisions(
  q: ListItemRevisionsQuery,
  user: AuthContext,
): Promise<ListItemRevisionsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = q.search ? `%${likeEscape(q.search)}%` : null;
    const where = sql`
      WHERE ir.company_id = ${companyId}::uuid AND ir.deleted_at IS NULL
        ${q.itemId ? sql`AND ir.item_id = ${q.itemId}::uuid` : sql``}
        ${
          term
            ? sql`AND (i.code ILIKE ${term} ESCAPE '\\' OR ir.rev ILIKE ${term} ESCAPE '\\'
                     OR (i.code || '/' || ir.rev) ILIKE ${term} ESCAPE '\\')`
            : sql``
        }`;
    const rows = (await tx.execute(sql`
      ${REV_SELECT} ${where}
      ORDER BY i.code, ir.rev
      LIMIT ${q.limit} OFFSET ${q.offset}`)) as unknown as Array<Record<string, unknown>>;
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM public.item_revisions ir
        JOIN public.items i ON i.id = ir.item_id ${where}`)) as unknown as Array<{ n: number }>;
    return {
      items: rows.map(toItemRevision),
      total: Number(totalRows[0]?.n ?? 0),
      limit: q.limit,
      offset: q.offset,
    };
  });
}

export async function lookupItemRevision(
  q: LookupItemRevisionQuery,
  user: AuthContext,
): Promise<LookupItemRevisionResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const revRequired = await itemNeedsRev(tx, companyId, q.itemId);
    const rows = (await tx.execute(sql`
      ${REV_SELECT}
      WHERE ir.company_id = ${companyId}::uuid AND ir.deleted_at IS NULL
        AND ir.item_id = ${q.itemId}::uuid AND ir.rev = ${q.rev}
      LIMIT 1`)) as unknown as Array<Record<string, unknown>>;
    return { revision: rows[0] ? toItemRevision(rows[0]) : null, revRequired };
  });
}

export async function getItemRevision(id: string, user: AuthContext): Promise<ItemRevisionDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      ${REV_SELECT}
      WHERE ir.id = ${id}::uuid AND ir.company_id = ${companyId}::uuid AND ir.deleted_at IS NULL
      LIMIT 1`)) as unknown as Array<Record<string, unknown>>;
    if (!rows[0]) throw new NotFoundError('Drawing Rev not found');
    const head = toItemRevision(rows[0]);

    const hist = (await tx.execute(sql`
      SELECT d.id, d.item_revision_id AS "itemRevisionId", d.action,
             d.drawing_file_path AS "drawingFilePath", d.drawing_no AS "drawingNo",
             d.reason, d.source_type AS "sourceType", d.source_ref AS "sourceRef",
             d.created_at AS "createdAt", d.created_by AS "createdBy",
             ${nameSql('u')} AS "createdByName"
        FROM public.item_revision_drawings d
        LEFT JOIN public.users u ON u.id = d.created_by
       WHERE d.item_revision_id = ${id}::uuid AND d.company_id = ${companyId}::uuid
         AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC`)) as unknown as Array<Record<string, unknown>>;
    const history: ItemRevisionDrawingEvent[] = hist.map((h) => ({
      id: h['id'] as string,
      itemRevisionId: h['itemRevisionId'] as string,
      action: h['action'] as ItemRevisionDrawingEvent['action'],
      drawingFilePath: (h['drawingFilePath'] as string | null) ?? null,
      drawingNo: (h['drawingNo'] as string | null) ?? null,
      reason: (h['reason'] as string | null) ?? null,
      sourceType: (h['sourceType'] as ItemRevisionSource | null) ?? null,
      sourceRef: (h['sourceRef'] as string | null) ?? null,
      createdAt: ts(h['createdAt']),
      createdBy: (h['createdBy'] as string | null) ?? null,
      createdByName: (h['createdByName'] as string | null) ?? null,
    }));

    // Every live document linked by item_revision_id. SO / JWSO lines name
    // their ORDER (docId = order id, code = order code, lineNo = line no).
    const linked = (await tx.execute(sql`
      SELECT 'so_line' AS "docType", h.id AS "docId", h.code, l.line_no AS "lineNo", l.status::text AS status
        FROM public.sales_order_lines l JOIN public.sales_orders h ON h.id = l.sales_order_id
       WHERE l.item_revision_id = ${id}::uuid AND l.company_id = ${companyId}::uuid
         AND l.deleted_at IS NULL AND h.deleted_at IS NULL
      UNION ALL
      SELECT 'jw_line', h.id, h.code, l.line_no, l.status::text
        FROM public.job_work_order_lines l JOIN public.job_work_orders h ON h.id = l.job_work_order_id
       WHERE l.item_revision_id = ${id}::uuid AND l.company_id = ${companyId}::uuid
         AND l.deleted_at IS NULL AND h.deleted_at IS NULL
      UNION ALL
      SELECT 'route_card', rc.id, rc.code, NULL::int, rc.approval_status::text
        FROM public.route_cards rc
       WHERE rc.item_revision_id = ${id}::uuid AND rc.company_id = ${companyId}::uuid AND rc.deleted_at IS NULL
      UNION ALL
      SELECT 'plan', p.id, p.code, NULL::int, p.plan_status::text
        FROM public.plans p
       WHERE p.item_revision_id = ${id}::uuid AND p.company_id = ${companyId}::uuid AND p.deleted_at IS NULL
      UNION ALL
      SELECT 'production_order', po.id, po.code, NULL::int, po.status::text
        FROM public.production_orders po
       WHERE po.item_revision_id = ${id}::uuid AND po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL
      UNION ALL
      SELECT 'job_card', jc.id, jc.code, NULL::int, js.computed_status
        FROM public.job_cards jc LEFT JOIN public.v_jc_status js ON js.job_card_id = jc.id
       WHERE jc.item_revision_id = ${id}::uuid AND jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
      ORDER BY 1, 3, 4`)) as unknown as Array<Record<string, unknown>>;
    const linkedDocs: ItemRevisionLinkedDoc[] = linked.map((d) => ({
      docType: d['docType'] as ItemRevisionLinkedDoc['docType'],
      docId: d['docId'] as string,
      code: d['code'] as string,
      lineNo: d['lineNo'] == null ? null : Number(d['lineNo']),
      status: (d['status'] as string | null) ?? null,
    }));
    return { ...head, history, linkedDocs };
  });
}

export async function replaceDrawing(
  id: string,
  input: ReplaceItemRevisionDrawingInput,
  user: AuthContext,
): Promise<ItemRevisionDetail> {
  await requireFormAccess(user, 'routecard_create', 'edit');
  const companyId = requireCompany(user);
  await withUserContext(user, (tx) =>
    replaceItemRevisionDrawing(tx, user, companyId, id, {
      drawingFilePath: input.drawingFilePath,
      drawingNo: input.drawingNo,
      reason: input.reason,
      expectedUpdatedAt: input.expectedUpdatedAt,
    }),
  );
  return getItemRevision(id, user);
}

export async function listItemRevisionChanges(
  q: ListItemRevisionChangesQuery,
  user: AuthContext,
): Promise<ItemRevisionChange[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const filters: SQL[] = [];
    if (q.soLineId) filters.push(sql`c.so_line_id = ${q.soLineId}::uuid`);
    if (q.jwLineId) filters.push(sql`c.jw_line_id = ${q.jwLineId}::uuid`);
    if (q.salesOrderId) filters.push(sql`sl.sales_order_id = ${q.salesOrderId}::uuid`);
    if (q.jobWorkOrderId) filters.push(sql`jl.job_work_order_id = ${q.jobWorkOrderId}::uuid`);
    const rows = (await tx.execute(sql`
      SELECT c.id, c.so_line_id AS "soLineId", c.jw_line_id AS "jwLineId",
             COALESCE(so.code, jw.code) AS "docCode", COALESCE(sl.line_no, jl.line_no) AS "lineNo",
             c.from_item_revision_id AS "fromId", fi.code AS "fromCode", fr.rev AS "fromRev",
             c.to_item_revision_id AS "toId", ti.code AS "toCode", tr.rev AS "toRev",
             c.moved_docs AS "movedDocs", c.kept_docs AS "keptDocs",
             c.created_at AS "createdAt", c.created_by AS "createdBy",
             ${nameSql('u')} AS "createdByName"
        FROM public.item_revision_changes c
        LEFT JOIN public.sales_order_lines sl ON sl.id = c.so_line_id
        LEFT JOIN public.sales_orders so ON so.id = sl.sales_order_id
        LEFT JOIN public.job_work_order_lines jl ON jl.id = c.jw_line_id
        LEFT JOIN public.job_work_orders jw ON jw.id = jl.job_work_order_id
        LEFT JOIN public.item_revisions fr ON fr.id = c.from_item_revision_id
        LEFT JOIN public.items fi ON fi.id = fr.item_id
        JOIN public.item_revisions tr ON tr.id = c.to_item_revision_id
        JOIN public.items ti ON ti.id = tr.item_id
        LEFT JOIN public.users u ON u.id = c.created_by
       WHERE c.company_id = ${companyId}::uuid AND c.deleted_at IS NULL
         AND (${sql.join(filters, sql` OR `)})
       ORDER BY c.created_at DESC`)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r['id'] as string,
      soLineId: (r['soLineId'] as string | null) ?? null,
      jwLineId: (r['jwLineId'] as string | null) ?? null,
      docCode: (r['docCode'] as string | null) ?? null,
      lineNo: r['lineNo'] == null ? null : Number(r['lineNo']),
      fromItemRevisionId: (r['fromId'] as string | null) ?? null,
      fromLabel: r['fromId'] ? itemRevLabel(r['fromCode'] as string, r['fromRev'] as string) : null,
      toItemRevisionId: r['toId'] as string,
      toLabel: itemRevLabel(r['toCode'] as string, r['toRev'] as string),
      movedDocs: (r['movedDocs'] as string[] | null) ?? [],
      keptDocs: (r['keptDocs'] as string[] | null) ?? [],
      createdAt: ts(r['createdAt']),
      createdBy: (r['createdBy'] as string | null) ?? null,
      createdByName: (r['createdByName'] as string | null) ?? null,
    }));
  });
}
