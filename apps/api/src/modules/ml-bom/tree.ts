// Multi-Level BOM (ADR-225) — GET /ml-boms/:id/tree?qty=
//
// ONE recursive query walks child_ml_bom_id from the BOM down, depth-first by
// the line-no path, capped at ML_BOM_MAX_LEVELS, with the item path carried
// for loop safety (the write guards refuse loops; this is the belt to their
// braces). Qty is multiplied in full numeric precision down the chain and
// rounded to 3 decimals ONCE, at output. The same CTE feeds both the tree rows
// and the exploded list (leaf rows = rows no other row hangs under, summed
// by item + BOM type) — Postgres evaluates a CTE referenced twice only once.

import { sql } from 'drizzle-orm';
import { ML_BOM_MAX_LEVELS } from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
import type { MlBomExplodedItem, MlBomTreeNode, MlBomTreeResponse } from './schema';

interface HeaderRow {
  id: string;
  code: string;
  item_id: string;
  item_code: string | null;
  item_name: string | null;
  uom: string | null;
}

/** The requested qty as a numeric literal. String(n) can be exponent notation
 *  ("1e-7"), which Postgres numeric reads exactly — no rounding in JS. */
const qtyText = (qty: number): string => String(qty);

export async function loadMlBomTree(
  tx: DbTransaction,
  companyId: string,
  id: string,
  qty: number,
): Promise<MlBomTreeResponse> {
  const headers = (await tx.execute(sql`
    SELECT b.id, b.code, b.item_id, i.code AS item_code, i.name AS item_name, i.uom
    FROM public.ml_boms b
    LEFT JOIN public.items i ON i.id = b.item_id
    WHERE b.id = ${id}::uuid AND b.company_id = ${companyId}::uuid AND b.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as HeaderRow[];
  const h = headers[0];
  if (!h) throw new NotFoundError('Multi-Level BOM not found. It may have been moved to Trash.');

  const q = qtyText(qty);
  const rows = (await tx.execute(sql`
    WITH RECURSIVE t AS (
      SELECT l.id, l.child_item_id, l.qty_per_set, l.bom_type, l.child_ml_bom_id,
             l.raw_material_grade_text, l.raw_material_size_text,
             1 AS depth,
             (l.qty_per_set * ${q}::numeric)::numeric AS qty_exact,
             ARRAY[b.item_id, l.child_item_id]::uuid[] AS item_path,
             ARRAY[l.line_no]::int[] AS sort_path,
             l.id::text AS node_key,
             ''::text AS parent_key
      FROM public.ml_bom_lines l
      JOIN public.ml_boms b ON b.id = l.ml_bom_id
      WHERE l.ml_bom_id = ${id}::uuid
        AND l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
      UNION ALL
      SELECT c.id, c.child_item_id, c.qty_per_set, c.bom_type, c.child_ml_bom_id,
             c.raw_material_grade_text, c.raw_material_size_text,
             t.depth + 1,
             (t.qty_exact * c.qty_per_set)::numeric,
             t.item_path || c.child_item_id,
             t.sort_path || c.line_no,
             t.node_key || '/' || c.id::text,
             t.node_key
      FROM t
      JOIN public.ml_boms cb
        ON cb.id = t.child_ml_bom_id
       AND cb.company_id = ${companyId}::uuid
       AND cb.deleted_at IS NULL
      JOIN public.ml_bom_lines c ON c.ml_bom_id = cb.id AND c.deleted_at IS NULL
      WHERE t.depth < ${ML_BOM_MAX_LEVELS}
        AND NOT (c.child_item_id = ANY(t.item_path))
    )
    SELECT
      round(${q}::numeric, 3)::text AS top_qty,
      (SELECT COALESCE(json_agg(json_build_object(
          'key', t.node_key,
          'depth', t.depth,
          'itemId', t.child_item_id,
          'itemCode', i.code,
          'itemName', i.name,
          'uom', i.uom,
          'bomType', t.bom_type,
          'qtyPerSet', t.qty_per_set::text,
          'explodedQty', round(t.qty_exact, 3)::text,
          'mlBomId', t.child_ml_bom_id,
          'mlBomCode', cb.code,
          'rawMaterialGradeText', t.raw_material_grade_text,
          'rawMaterialSizeText', t.raw_material_size_text
        ) ORDER BY t.sort_path), '[]'::json)
       FROM t
       LEFT JOIN public.items i ON i.id = t.child_item_id
       LEFT JOIN public.ml_boms cb ON cb.id = t.child_ml_bom_id AND cb.deleted_at IS NULL
      ) AS nodes,
      (SELECT COALESCE(json_agg(json_build_object(
          'itemId', e.child_item_id,
          'itemCode', i.code,
          'itemName', i.name,
          'uom', i.uom,
          'bomType', e.bom_type,
          'explodedQty', round(e.qty_sum, 3)::text
        ) ORDER BY i.code, e.bom_type), '[]'::json)
       FROM (
         SELECT t.child_item_id, t.bom_type, SUM(t.qty_exact) AS qty_sum
         FROM t
         -- A leaf is a row nothing in the walk hangs under (not merely "no
         -- link"): a linked row that was not expanded still counts.
         WHERE NOT EXISTS (SELECT 1 FROM t k WHERE k.parent_key = t.node_key)
         GROUP BY t.child_item_id, t.bom_type
       ) e
       LEFT JOIN public.items i ON i.id = e.child_item_id
      ) AS exploded
  `)) as unknown as Array<{
    top_qty: string;
    nodes: MlBomTreeNode[];
    exploded: MlBomExplodedItem[];
  }>;

  const lineNodes = rows[0]?.nodes ?? [];
  const exploded = rows[0]?.exploded ?? [];
  const top: MlBomTreeNode = {
    key: '',
    depth: 0,
    itemId: h.item_id,
    itemCode: h.item_code,
    itemName: h.item_name,
    uom: h.uom,
    bomType: null,
    qtyPerSet: null,
    explodedQty: rows[0]?.top_qty ?? String(qty),
    mlBomId: h.id,
    mlBomCode: h.code,
    rawMaterialGradeText: null,
    rawMaterialSizeText: null,
  };
  const levels = lineNodes.reduce((m, n) => Math.max(m, Number(n.depth)), 0);
  return { qty, levels, nodes: [top, ...lineNodes], exploded };
}

/**
 * The `levels` of every live BOM of a company (deepest line level under it) as
 * a CTE fragment `lv(ml_bom_id, levels)` for the list query — one walk for the
 * whole list, never one per row.
 */
export function levelsCte(companyId: string) {
  return sql`
    WITH RECURSIVE walk AS (
      SELECT b.id AS root_id, l.child_ml_bom_id AS next_id, 1 AS depth,
             ARRAY[b.id]::uuid[] AS path
      FROM public.ml_boms b
      JOIN public.ml_bom_lines l ON l.ml_bom_id = b.id AND l.deleted_at IS NULL
      WHERE b.company_id = ${companyId}::uuid AND b.deleted_at IS NULL
      UNION ALL
      SELECT w.root_id, l.child_ml_bom_id, w.depth + 1, w.path || w.next_id
      FROM walk w
      JOIN public.ml_boms cb ON cb.id = w.next_id AND cb.deleted_at IS NULL
      JOIN public.ml_bom_lines l ON l.ml_bom_id = cb.id AND l.deleted_at IS NULL
      WHERE w.depth < ${ML_BOM_MAX_LEVELS} AND NOT (w.next_id = ANY(w.path))
    ),
    lv AS (
      SELECT root_id AS ml_bom_id, MAX(depth)::int AS levels FROM walk GROUP BY root_id
    )`;
}
