// Multi-Level BOM (ADR-225) — reads: list, detail, next code.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { NotFoundError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { maybeTsLike, tsLike } from './helpers';
import type {
  ListMlBomsQuery,
  ListMlBomsResponse,
  MlBom,
  MlBomDetail,
  MlBomLine,
  MlBomListItem,
  MlBomRevision,
} from './schema';
import { ML_BOM_SF_COLUMNS } from './sf-columns';
import { levelsCte } from './tree';

export const ML_BOM_NOT_FOUND = 'Multi-Level BOM not found. It may have been moved to Trash.';

// ─── Numbering (IN-MLB-#####, docs/NAMING.md) ────────────────────────────

/** Next IN-MLB-##### — highest number EVER used + 1 (deleted rows included,
 *  so a number in Trash is never handed out again), under the series lock. */
export async function nextMlBomCode(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: queue behind any other save numbering this series (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'ml_boms');
  const rows = (await tx.execute(sql`
    SELECT code FROM public.ml_boms
    WHERE company_id = ${companyId}::uuid
      AND code ~ '^IN-MLB-\\d+$'
    ORDER BY (SUBSTRING(code FROM 8))::int DESC
    LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  const m = rows[0]?.code.match(/^IN-MLB-(\d+)$/);
  const next = m ? parseInt(m[1]!, 10) + 1 : 1;
  return `IN-MLB-${String(next).padStart(5, '0')}`;
}

// ─── Header mapping ──────────────────────────────────────────────────────

const HEADER_COLS = sql`
  b.id, b.company_id AS "companyId", b.code, b.item_id AS "itemId",
  bi.code AS "itemCode", bi.name AS "itemName",
  b.revision, b.is_default AS "isDefault", b.remarks,
  b.created_at AS "createdAt", b.created_by AS "createdBy",
  b.updated_at AS "updatedAt", b.updated_by AS "updatedBy",
  b.deleted_at AS "deletedAt"`;

export function toMlBom(r: Record<string, unknown>): MlBom {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    itemId: r['itemId'] as string,
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
    revision: Number(r['revision'] ?? 1),
    isDefault: Boolean(r['isDefault']),
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
  };
}

// ─── List ────────────────────────────────────────────────────────────────

export async function listMlBomsTx(
  tx: DbTransaction,
  companyId: string,
  input: ListMlBomsQuery,
): Promise<ListMlBomsResponse> {
  const term = input.search ? `%${likeEscape(input.search)}%` : null;
  const searchFrag = term
    ? sql`AND (b.code ILIKE ${term} ESCAPE '\\' OR bi.code ILIKE ${term} ESCAPE '\\'
        OR bi.name ILIKE ${term} ESCAPE '\\')`
    : sql``;
  // Sort & Filter (ADR-200) on the page AND the count (ADR-201).
  const sf = readSf(input.sf);
  const sfFrag = sfWhere(ML_BOM_SF_COLUMNS, sf);
  const orderBy = sfOrderBy(ML_BOM_SF_COLUMNS, sf, sql`b.code DESC, b.id DESC`);

  const fromWhere = sql`
    FROM public.ml_boms b
    LEFT JOIN public.items bi ON bi.id = b.item_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS line_count,
             COUNT(*) FILTER (WHERE cb.id IS NOT NULL) AS sub_count
      FROM public.ml_bom_lines l
      -- a link counts only while the child BOM is live (ADR-225)
      LEFT JOIN public.ml_boms cb ON cb.id = l.child_ml_bom_id AND cb.deleted_at IS NULL
      WHERE l.ml_bom_id = b.id AND l.deleted_at IS NULL
    ) line_agg ON TRUE
    LEFT JOIN lv ON lv.ml_bom_id = b.id
    WHERE b.company_id = ${companyId}::uuid
      AND b.deleted_at IS NULL
      ${searchFrag}
      ${sfFrag}`;

  const result = (await tx.execute(sql`
    ${levelsCte(companyId)}
    SELECT ${HEADER_COLS},
      COALESCE(line_agg.line_count, 0)::int AS "lineCount",
      COALESCE(line_agg.sub_count, 0)::int AS "subAssemblyCount",
      COALESCE(lv.levels, 0)::int AS "levels"
    ${fromWhere}
    ORDER BY ${orderBy}
    LIMIT ${input.limit} OFFSET ${input.offset}
  `)) as unknown as Array<Record<string, unknown>>;

  // The count needs the levels walk only when a filter reads `levels` (a sort
  // never changes the count); otherwise `lv` is an empty stand-in.
  const countNeedsLevels = sf?.filters.some((f) => f.field === 'levels') ?? false;
  const countPrefix = countNeedsLevels
    ? levelsCte(companyId)
    : sql`WITH lv AS (SELECT NULL::uuid AS ml_bom_id, 0 AS levels WHERE FALSE)`;
  const totalRows = (await tx.execute(
    sql`${countPrefix} SELECT COUNT(*)::int AS n ${fromWhere}`,
  )) as unknown as Array<{ n: number }>;

  const itemsList: MlBomListItem[] = result.map((r) => ({
    ...toMlBom(r),
    lineCount: Number(r['lineCount'] ?? 0),
    subAssemblyCount: Number(r['subAssemblyCount'] ?? 0),
    levels: Number(r['levels'] ?? 0),
  }));
  return {
    items: itemsList,
    total: Number(totalRows[0]?.n ?? 0),
    limit: input.limit,
    offset: input.offset,
  };
}

// ─── Detail ──────────────────────────────────────────────────────────────

export async function loadMlBomDetail(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<MlBomDetail> {
  const headers = (await tx.execute(sql`
    SELECT ${HEADER_COLS}
    FROM public.ml_boms b
    LEFT JOIN public.items bi ON bi.id = b.item_id
    WHERE b.id = ${id}::uuid AND b.company_id = ${companyId}::uuid AND b.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  const h = headers[0];
  if (!h) throw new NotFoundError(ML_BOM_NOT_FOUND);

  const lineRows = (await tx.execute(sql`
    SELECT l.id, l.ml_bom_id AS "mlBomId", l.line_no AS "lineNo",
      l.child_item_id AS "childItemId", ci.code AS "childItemCode",
      ci.name AS "childItemName", ci.uom AS "childUom",
      l.qty_per_set::text AS "qtyPerSet", l.bom_type AS "bomType",
      l.child_ml_bom_id AS "childMlBomId", cb.code AS "childMlBomCode",
      l.raw_material_grade_id AS "rawMaterialGradeId",
      l.raw_material_grade_text AS "rawMaterialGradeText",
      l.raw_material_size_id AS "rawMaterialSizeId",
      l.raw_material_size_text AS "rawMaterialSizeText",
      l.remarks, l.updated_at AS "updatedAt"
    FROM public.ml_bom_lines l
    LEFT JOIN public.items ci ON ci.id = l.child_item_id
    LEFT JOIN public.ml_boms cb ON cb.id = l.child_ml_bom_id AND cb.deleted_at IS NULL
    WHERE l.ml_bom_id = ${id}::uuid AND l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
    ORDER BY l.line_no
  `)) as unknown as Array<Record<string, unknown>>;

  const revisionRows = (await tx.execute(sql`
    SELECT r.id, r.ml_bom_id AS "mlBomId", r.revision, r.changed_by_text AS "changedByText",
      r.notes, r.lines_snapshot AS "linesSnapshot",
      r.created_at AS "createdAt", r.created_by AS "createdBy"
    FROM public.ml_bom_revisions r
    WHERE r.ml_bom_id = ${id}::uuid AND r.company_id = ${companyId}::uuid
      AND r.deleted_at IS NULL
    ORDER BY r.revision DESC
  `)) as unknown as Array<Record<string, unknown>>;

  // Live BOMs whose live lines link this one as a sub-assembly.
  const usedInRows = (await tx.execute(sql`
    SELECT DISTINCT p.id AS "mlBomId", p.code, pi.code AS "itemCode"
    FROM public.ml_bom_lines l
    JOIN public.ml_boms p ON p.id = l.ml_bom_id AND p.deleted_at IS NULL
    LEFT JOIN public.items pi ON pi.id = p.item_id
    WHERE l.child_ml_bom_id = ${id}::uuid
      AND l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
    ORDER BY p.code
  `)) as unknown as Array<{ mlBomId: string; code: string; itemCode: string | null }>;

  return {
    ...toMlBom(h),
    lines: lineRows.map(
      (r): MlBomLine => ({
        id: r['id'] as string,
        mlBomId: r['mlBomId'] as string,
        lineNo: Number(r['lineNo']),
        childItemId: r['childItemId'] as string,
        childItemCode: (r['childItemCode'] as string | null) ?? null,
        childItemName: (r['childItemName'] as string | null) ?? null,
        childUom: (r['childUom'] as string | null) ?? null,
        qtyPerSet: r['qtyPerSet'] as string,
        bomType: r['bomType'] as MlBomLine['bomType'],
        childMlBomId: (r['childMlBomId'] as string | null) ?? null,
        childMlBomCode: (r['childMlBomCode'] as string | null) ?? null,
        rawMaterialGradeId: (r['rawMaterialGradeId'] as string | null) ?? null,
        rawMaterialGradeText: (r['rawMaterialGradeText'] as string | null) ?? null,
        rawMaterialSizeId: (r['rawMaterialSizeId'] as string | null) ?? null,
        rawMaterialSizeText: (r['rawMaterialSizeText'] as string | null) ?? null,
        remarks: (r['remarks'] as string | null) ?? null,
        updatedAt: tsLike(r['updatedAt']),
      }),
    ),
    revisions: revisionRows.map(
      (r): MlBomRevision => ({
        id: r['id'] as string,
        mlBomId: r['mlBomId'] as string,
        revision: Number(r['revision']),
        changedByText: r['changedByText'] as string,
        notes: (r['notes'] as string | null) ?? null,
        linesSnapshot: (r['linesSnapshot'] as MlBomRevision['linesSnapshot']) ?? [],
        createdAt: tsLike(r['createdAt']),
        createdBy: r['createdBy'] as string,
      }),
    ),
    usedIn: usedInRows.map((u) => ({ mlBomId: u.mlBomId, code: u.code, itemCode: u.itemCode })),
  };
}
