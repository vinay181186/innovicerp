// Multi-Level Plan (ADR-225 phase 3) — the snapshot: copy the tree, read the
// pools ONCE, work the figures out (snapshot-math.ts), replace the plan's
// nodes. Used by create, update and refresh — the one writer of
// ml_plan_nodes (CLAUDE.md §20.1).
//
// Two sources for the tree:
//   'bom'    — walk the Multi-Level BOM as it is NOW (create / refresh). The
//              walk is ml-bom/tree.ts loadMlBomTree (depth-first by line no.,
//              live child_ml_bom_id links, capped at ML_BOM_MAX_LEVELS) —
//              reused, not copied. The caller holds the ML BOM tree lock, so
//              the walk and the BOM Rev it pins come from ONE committed state.
//   'stored' — the plan's own live nodes (update): the structure copied at
//              the last snapshot is kept, so a Plan Qty change never quietly
//              swaps in BOM edits made since — that is what Refresh is for.
//
// Pools (read once for every item in the tree — no N+1):
//   free stock = GREATEST(0, v_item_stock_availability.available_qty)
//                (available = physical − reserved for sales / assembly)
//   On PO / PR = FREE supply still to come, two parts that never overlap:
//     PO part — lib/po-pending.ts onPoLinesFromSql, the SAME line set as
//               onPoByItemSql (qty − ACCEPTED on issued purchase POs, no
//               job-card-op / service lines), MINUS PO lines raised from a PR
//               bound to demand (BOUND_PO_LINE_SQL, incl. the legacy po_id link)
//     PR part — store-inventory/reorder-rule.ts openPrBalancesFromSql, the
//               SAME set as readOpenPrsByItem (open standard PR, balance =
//               qty − what is already on live PO lines from it), MINUS PRs
//               bound to demand
//   "Bound to demand" = purchase_requests.source_so_line_id IS NOT NULL: that
//   PR (and any PO line made from it) is someone else's supply, not free.
//   A PR converted to a PO counts once — its converted part is taken off the
//   PR balance and appears on the PO side. Phase 4 adds the plan-node binding
//   (ml_plan_node_id) to the same exclusion.

import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BomLineType } from '@innovic/shared';
import { mlPlanNodes } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ON_PO_LINE_PENDING_SQL, onPoLinesFromSql } from '../../lib/po-pending';
import { softDeleteStamp } from '../../lib/audit-trail';
import { loadMlBomTree } from '../ml-bom/tree';
import { openPrBalancesFromSql } from '../store-inventory/reorder-rule';
import {
  type ComputedNode,
  type WalkNode,
  computePlanFigures,
  milliToText,
  toMilli,
} from './snapshot-math';

/** Rows per INSERT — keeps far below Postgres' 65535 bind parameters. Parents
 *  always precede children (depth-first), so a parent is in an earlier or the
 *  same statement as its child. */
const INSERT_CHUNK = 1000;

// ─── Tree sources ────────────────────────────────────────────────────────

/** The BOM as it is now, as WalkNodes (top row first). */
export async function walkFromBom(
  tx: DbTransaction,
  companyId: string,
  mlBomId: string,
): Promise<{ nodes: WalkNode[]; revision: number }> {
  const tree = await loadMlBomTree(tx, companyId, mlBomId, 1);
  const bomIds = Array.from(
    new Set([mlBomId, ...tree.nodes.flatMap((n) => (n.mlBomId ? [n.mlBomId] : []))]),
  );
  const revRows = (await tx.execute(sql`
    SELECT id, revision FROM public.ml_boms
    WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      AND id = ANY(${sql.param(bomIds)}::uuid[])
  `)) as unknown as Array<{ id: string; revision: number }>;
  const revById = new Map(revRows.map((r) => [r.id, Number(r.revision)]));
  const revision = revById.get(mlBomId);
  if (revision === undefined) throw new Error('ml-plan snapshot: pinned BOM vanished mid-walk');

  // Keys of rows the walk actually EXPANDED (something hangs under them).
  const expanded = new Set<string>();
  for (const n of tree.nodes) {
    if (n.depth === 0) continue;
    const slash = n.key.lastIndexOf('/');
    if (slash >= 0) expanded.add(n.key.slice(0, slash));
  }

  const nodes: WalkNode[] = tree.nodes.map((n) => {
    if (n.depth === 0) {
      return {
        key: '',
        parentKey: null,
        depth: 0,
        itemId: n.itemId,
        uom: n.uom,
        bomType: null,
        isSubAssembly: true,
        mlBomId,
        mlBomRevision: revision,
        qtyPerSet: null,
        rawMaterialGradeText: null,
        rawMaterialSizeText: null,
      };
    }
    // A sub-assembly only when the walk EXPANDED it: its child BOM is live
    // and has lines under it here. A linked row the walk did not expand (BOM
    // in Trash, an empty BOM, the depth cap) is stored as a plain row.
    const childRev = n.mlBomId && expanded.has(n.key) ? revById.get(n.mlBomId) : undefined;
    const slash = n.key.lastIndexOf('/');
    return {
      key: n.key,
      parentKey: slash < 0 ? '' : n.key.slice(0, slash),
      depth: Number(n.depth),
      itemId: n.itemId,
      uom: n.uom,
      bomType: n.bomType as BomLineType,
      isSubAssembly: childRev !== undefined,
      mlBomId: childRev !== undefined ? n.mlBomId : null,
      mlBomRevision: childRev ?? null,
      qtyPerSet: n.qtyPerSet,
      rawMaterialGradeText: n.rawMaterialGradeText,
      rawMaterialSizeText: n.rawMaterialSizeText,
    };
  });
  return { nodes, revision };
}

/** The plan's own live nodes, in seq order, as WalkNodes. */
export async function walkFromStoredNodes(
  tx: DbTransaction,
  companyId: string,
  planId: string,
): Promise<WalkNode[]> {
  const rows = (await tx.execute(sql`
    SELECT n.id, n.parent_node_id, n.depth, n.item_id, i.uom::text AS uom,
           n.bom_type::text AS bom_type, n.is_sub_assembly, n.ml_bom_id,
           n.ml_bom_revision, n.qty_per_set::text AS qty_per_set,
           n.raw_material_grade_text, n.raw_material_size_text
    FROM public.ml_plan_nodes n
    LEFT JOIN public.items i ON i.id = n.item_id
    WHERE n.ml_plan_id = ${planId}::uuid AND n.company_id = ${companyId}::uuid
      AND n.deleted_at IS NULL
    ORDER BY n.seq
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    key: String(r['id']),
    parentKey: (r['parent_node_id'] as string | null) ?? null,
    depth: Number(r['depth']),
    itemId: String(r['item_id']),
    uom: (r['uom'] as string | null) ?? null,
    bomType: (r['bom_type'] as BomLineType | null) ?? null,
    isSubAssembly: Boolean(r['is_sub_assembly']),
    mlBomId: (r['ml_bom_id'] as string | null) ?? null,
    mlBomRevision: r['ml_bom_revision'] == null ? null : Number(r['ml_bom_revision']),
    qtyPerSet: (r['qty_per_set'] as string | null) ?? null,
    rawMaterialGradeText: (r['raw_material_grade_text'] as string | null) ?? null,
    rawMaterialSizeText: (r['raw_material_size_text'] as string | null) ?? null,
  }));
}

// ─── Pools ───────────────────────────────────────────────────────────────

/**
 * A PO line (alias pol, header po) that is someone else's supply: raised from
 * a PR bound to demand (purchase_requests.source_so_line_id set) —
 *   (a) linked by the line: pol.source_pr_id → that PR, or
 *   (b) the legacy way: the PR's po_id is this PO, the PR has NO PO line
 *       pointing back at it (pre-line-link conversion), and this line is for
 *       the same item and carries no source_pr_id of its own.
 * Phase 4 adds the ml_plan_node_id binding here.
 */
const BOUND_PO_LINE_SQL = sql`(
      EXISTS (SELECT 1 FROM public.purchase_requests bpr
              WHERE bpr.id = pol.source_pr_id AND bpr.source_so_line_id IS NOT NULL)
      OR (pol.source_pr_id IS NULL AND EXISTS (
            SELECT 1 FROM public.purchase_requests lpr
            WHERE lpr.po_id = po.id AND lpr.item_id = pol.item_id
              AND lpr.source_so_line_id IS NOT NULL AND lpr.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines lpl
                              WHERE lpl.source_pr_id = lpr.id AND lpl.deleted_at IS NULL)))
    )`;

export interface Pools {
  stock: Map<string, string>;
  onPoPr: Map<string, string>;
}

/** Free stock and On PO / PR qty for these items — three reads in all. */
export async function readPools(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Pools> {
  const ids = Array.from(new Set(itemIds));
  const stock = new Map<string, string>();
  const onPoPr = new Map<string, string>();
  if (ids.length === 0) return { stock, onPoPr };

  const stockRows = (await tx.execute(sql`
    SELECT a.item_id, round(GREATEST(0, a.available_qty), 3)::text AS qty
    FROM public.v_item_stock_availability a
    WHERE a.company_id = ${companyId}::uuid
      AND a.item_id = ANY(${sql.param(ids)}::uuid[])
  `)) as unknown as Array<{ item_id: string; qty: string }>;
  for (const r of stockRows) stock.set(String(r.item_id), String(r.qty));

  // PO part: the ONE On PO line set (lib/po-pending.ts onPoLinesFromSql),
  // narrowed to these items and to FREE supply (see BOUND_PO_LINE_SQL).
  const poRows = (await tx.execute(sql`
    SELECT pol.item_id, round(SUM(${ON_PO_LINE_PENDING_SQL}), 3)::text AS qty${onPoLinesFromSql(
      companyId,
      sql`
      AND pol.item_id = ANY(${sql.param(ids)}::uuid[])
      AND NOT ${BOUND_PO_LINE_SQL}`,
    )}
    GROUP BY pol.item_id
  `)) as unknown as Array<{ item_id: string; qty: string }>;

  // PR part: the ONE open-PR set (reorder-rule.ts openPrBalancesFromSql),
  // minus PRs bound to demand.
  const prRows = (await tx.execute(sql`
    SELECT x.item_id, round(SUM(x.qty - x.ordered), 3)::text AS qty${openPrBalancesFromSql(
      companyId,
      ids,
      sql`
        AND pr.source_so_line_id IS NULL`,
    )}
    GROUP BY x.item_id
  `)) as unknown as Array<{ item_id: string; qty: string }>;

  // PO + PR per item, in thousandths (no float drift).
  const milli = new Map<string, bigint>();
  for (const r of [...poRows, ...prRows]) {
    const k = String(r.item_id);
    milli.set(k, (milli.get(k) ?? 0n) + toMilli(r.qty));
  }
  for (const [itemId, m] of milli) onPoPr.set(itemId, milliToText(m));
  return { stock, onPoPr };
}

// ─── Replace the nodes ───────────────────────────────────────────────────

/**
 * Work out `walk` for `planQty` with fresh pools and make it the plan's live
 * node set: the old live nodes are SOFT-deleted (rule 8), the new ones
 * inserted. Returns the computed rows.
 */
export async function snapshotPlanNodes(
  tx: DbTransaction,
  args: { companyId: string; planId: string; planQty: number; walk: WalkNode[] },
  user: AuthContext,
): Promise<ComputedNode[]> {
  const { companyId, planId, planQty, walk } = args;
  const pools = await readPools(
    tx,
    companyId,
    walk.filter((n) => n.depth > 0).map((n) => n.itemId),
  );
  const computed = computePlanFigures(walk, planQty, pools.stock, pools.onPoPr);

  await tx
    .update(mlPlanNodes)
    .set({ ...softDeleteStamp(user), updatedBy: user.id })
    .where(
      and(
        eq(mlPlanNodes.mlPlanId, planId),
        eq(mlPlanNodes.companyId, companyId),
        isNull(mlPlanNodes.deletedAt),
      ),
    );

  // New ids up front so parent_node_id can be set in the same INSERT (the FK
  // is checked at the end of each statement).
  const idByKey = new Map<string, string>();
  for (const n of computed) idByKey.set(n.key, randomUUID());
  const values = computed.map((n) => ({
    id: idByKey.get(n.key)!,
    companyId,
    mlPlanId: planId,
    parentNodeId: n.parentKey === null ? null : (idByKey.get(n.parentKey) ?? null),
    depth: n.depth,
    seq: n.seq,
    itemId: n.itemId,
    bomType: n.bomType,
    isSubAssembly: n.isSubAssembly,
    mlBomId: n.mlBomId,
    mlBomRevision: n.mlBomRevision,
    qtyPerSet: n.qtyPerSet,
    grossNeedQty: n.grossNeedQty,
    fromStockQty: n.fromStockQty,
    onPoPrQty: n.onPoPrQty,
    netNeedQty: n.netNeedQty,
    rawMaterialGradeText: n.rawMaterialGradeText,
    rawMaterialSizeText: n.rawMaterialSizeText,
    createdBy: user.id,
    updatedBy: user.id,
  }));
  for (let i = 0; i < values.length; i += INSERT_CHUNK) {
    await tx.insert(mlPlanNodes).values(values.slice(i, i + INSERT_CHUNK));
  }
  return computed;
}
