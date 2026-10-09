// Multi-Level BOM (ADR-225 phase 6) — GET /ml-boms/:id/cost?qty=
//
// The cost estimate for `qty` sets of a BOM. Rows are the Tree tab's rows
// (loadMlBomTree — same keys, depth, Exploded Qty); the rates for every item
// in the tree are read in ONE more query:
//   - each tree item's live Route Card: raw-material item, RM Qty per Piece,
//     Σ op Cycle Time (min) × machine Hour Rate over its in-house steps, and
//     whether any step has no rate: an Outsource (OSP) step — a Route Card
//     step carries no OSP rate, so it adds 0 — or an in-house step with no
//     machine, a machine in Trash, or a machine Hour Rate of 0;
//   - the bought rate of every tree item and every Route Card RM item, by the
//     Stock Valuation rule (stock-valuation/rate-rule.ts — the same SQL).
// The roll-up maths lives in cost-math.ts (pure, unit-tested).
//
// Access: view on `mlbom_create` AND its price right (canSeeFormPrice) — the
// same price gate as every money figure. Without it: 403.

import type { MlBomCostQuery, MlBomCostResponse } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { canSeeFormPrice, requireFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { itemRateCtes } from '../stock-valuation/rate-rule';
import { computeMlBomCost, type ItemRate, type RouteCardCost } from './cost-math';
import { requireCompany } from './helpers';
import { loadMlBomTree } from './tree';

const FORM = 'mlbom_create';

interface CardRow {
  item_id: string;
  raw_material_item_id: string | null;
  rm_qty: string | null;
  op_minute_rate: string;
  op_rate_missing: boolean;
}
interface RateRow {
  item_id: string;
  rate: string;
  source: 'grn' | 'po';
  ref: string | null;
}

async function readCostInputs(
  tx: DbTransaction,
  companyId: string,
  itemIds: string[],
): Promise<{ routeCards: Map<string, RouteCardCost>; rates: Map<string, ItemRate> }> {
  const res = (await tx.execute(sql`
    WITH tree_items AS (
      SELECT DISTINCT unnest(${sql.param(itemIds)}::uuid[]) AS item_id
    ),
    rc AS (
      SELECT rc.item_id, rc.raw_material_item_id, rc.rm_qty_per_piece::text AS rm_qty,
             ops.op_minute_rate, ops.op_rate_missing
      FROM public.route_cards rc
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(SUM(o.cycle_time_min * COALESCE(m.hour_rate, 0))
                   FILTER (WHERE o.op_type <> 'outsource'), 0)::text AS op_minute_rate,
          COALESCE(bool_or(o.op_type = 'outsource' OR (COALESCE(o.cycle_time_min, 0) > 0 AND COALESCE(m.hour_rate, 0) <= 0)), false)
            AS op_rate_missing
        FROM public.route_card_ops o
        LEFT JOIN public.machines m
          ON m.id = o.machine_id AND m.company_id = rc.company_id AND m.deleted_at IS NULL
        WHERE o.route_card_id = rc.id AND o.deleted_at IS NULL
      ) ops
      WHERE rc.company_id = ${companyId}::uuid AND rc.deleted_at IS NULL
        AND rc.item_id IN (SELECT item_id FROM tree_items)
    ),
    wanted AS (
      SELECT item_id FROM tree_items
      UNION
      SELECT raw_material_item_id FROM rc WHERE raw_material_item_id IS NOT NULL
    ),
    ${itemRateCtes(sql`${companyId}::uuid`, {
      withRefs: true,
      itemIdIn: sql`SELECT item_id FROM wanted`,
    })}
    SELECT
      (SELECT COALESCE(json_agg(json_build_object(
          'item_id', rc.item_id,
          'raw_material_item_id', rc.raw_material_item_id,
          'rm_qty', rc.rm_qty,
          'op_minute_rate', rc.op_minute_rate,
          'op_rate_missing', rc.op_rate_missing)), '[]'::json)
       FROM rc) AS cards,
      (SELECT COALESCE(json_agg(json_build_object(
          'item_id', w.item_id,
          'rate', COALESCE(lg.rate, lp.rate)::text,
          'source', CASE WHEN lg.rate IS NOT NULL THEN 'grn' ELSE 'po' END,
          'ref', CASE WHEN lg.rate IS NOT NULL THEN lg.grn_code ELSE lp.po_code END)), '[]'::json)
       FROM wanted w
       LEFT JOIN last_grn_rate lg ON lg.item_id = w.item_id
       LEFT JOIN last_po_rate lp ON lp.item_id = w.item_id
       WHERE lg.rate IS NOT NULL OR lp.rate IS NOT NULL) AS rates
  `)) as unknown as Array<{ cards: CardRow[]; rates: RateRow[] }>;

  const routeCards = new Map<string, RouteCardCost>();
  for (const c of res[0]?.cards ?? []) {
    routeCards.set(c.item_id, {
      rawMaterialItemId: c.raw_material_item_id,
      rmQtyPerPiece: c.rm_qty,
      opMinuteRate: c.op_minute_rate,
      opRateMissing: c.op_rate_missing === true,
    });
  }
  const rates = new Map<string, ItemRate>();
  for (const r of res[0]?.rates ?? []) {
    rates.set(r.item_id, { rate: r.rate, source: r.source, ref: r.ref });
  }
  return { routeCards, rates };
}

export async function getMlBomCost(
  id: string,
  query: MlBomCostQuery,
  user: AuthContext,
): Promise<MlBomCostResponse> {
  await requireFormAccess(user, FORM, 'view');
  if (!(await canSeeFormPrice(user, FORM))) {
    throw new AuthorizationError('You do not have the right to see prices on Multi-Level BOM.');
  }
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const tree = await loadMlBomTree(tx, companyId, id, query.qty);
    const itemIds = Array.from(new Set(tree.nodes.map((n) => n.itemId)));
    const { routeCards, rates } = await readCostInputs(tx, companyId, itemIds);
    return computeMlBomCost({ qty: query.qty, nodes: tree.nodes, routeCards, rates });
  });
}
