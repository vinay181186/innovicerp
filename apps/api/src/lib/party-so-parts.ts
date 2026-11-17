// Customer-supplied BOM parts of an Equipment SO — ADR-307.
//
// THE ONE place the per-SO customer-part figures are computed
// (packages/shared/src/schemas/so-customer-part.ts). SO Status, BOM Planning,
// the Assembly Tracker, the Party GRN "Against Equipment SO" picker and its
// receive cap, the Issue Customer Part cap, the Customer Material Return
// returnable rows and the Home check all read them from here — never recompute.
//
// A customer part = a LIVE BOM line with bom_type 'party_supplied' on the SO's
// header BOM (sales_orders.bom_master_id, BOM header not deleted — a trashed
// BOM must not answer, ADR-215 pattern 4). Need = Σ qty_per_set × Σ live SO
// line order_qty (the SO Status equipmentQty rule).
//
//   received / accepted / deviated  live party_grn_lines of live party_grn rows
//                                   with party_grn.sales_order_id = the SO,
//                                   matched to the part by party_materials.item_id
//   issued    Σ (qty − returned_to_store_qty) of live party_material_issues
//             with sales_order_id = the SO
//   fitted    Σ assembly_unit_consumptions (live) of the SO for the RM item
//   returned  Σ good lines of live, issued customer_material_returns of the SO
//
// Read-only. Callers that WRITE against a cap call this inside their
// transaction AFTER lockSoRow (lib/assembly-parts.ts) — §20.3.

import type { CustomerPartGrnStatus, SoCustomerPartFigures } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

export interface SoCustomerPart {
  rmItemId: string;
  rmItemCode: string;
  rmItemName: string;
  qtyPerSet: number;
  figures: SoCustomerPartFigures;
}

const n = (v: unknown): number => Math.max(0, Math.trunc(Number(v ?? 0)));

function grnStatus(accepted: number, need: number): CustomerPartGrnStatus {
  if (need > 0 && accepted >= need) return 'done';
  if (accepted > 0) return 'part_done';
  return 'not_done';
}

/** Customer parts per SO (map key = SO id), each keyed by RM item id. SOs with
 *  no party_supplied BOM line are absent from the result. */
export async function readSoCustomerPartsMany(
  tx: DbTransaction,
  companyId: string,
  soIds: readonly string[],
): Promise<Map<string, Map<string, SoCustomerPart>>> {
  const out = new Map<string, Map<string, SoCustomerPart>>();
  if (soIds.length === 0) return out;
  const ids = sql.param(soIds as string[]);
  const rows = (await tx.execute(sql`
    WITH parts AS (
      SELECT so.id AS so_id, bml.child_item_id AS item_id,
             SUM(bml.qty_per_set)::numeric AS qty_per_set
        FROM public.sales_orders so
        JOIN public.bom_masters bm ON bm.id = so.bom_master_id AND bm.deleted_at IS NULL
        JOIN public.bom_master_lines bml ON bml.bom_master_id = bm.id AND bml.deleted_at IS NULL
       WHERE so.company_id = ${companyId}::uuid AND so.id = ANY(${ids}::uuid[])
         AND bml.bom_type = 'party_supplied'
       GROUP BY so.id, bml.child_item_id
    ), sets AS (
      SELECT sol.sales_order_id AS so_id, SUM(sol.order_qty)::numeric AS order_qty
        FROM public.sales_order_lines sol
       WHERE sol.company_id = ${companyId}::uuid AND sol.deleted_at IS NULL
         AND sol.sales_order_id = ANY(${ids}::uuid[])
       GROUP BY sol.sales_order_id
    ), grn AS (
      SELECT g.sales_order_id AS so_id, pm.item_id,
             SUM(l.received_qty) AS received, SUM(l.accepted_qty) AS accepted,
             SUM(l.rejected_qty) AS rejected, SUM(l.rejected_returned_qty) AS rej_returned
        FROM public.party_grn_lines l
        JOIN public.party_grn g ON g.id = l.party_grn_id AND g.deleted_at IS NULL
        JOIN public.party_materials pm ON pm.id = l.party_material_id
       WHERE g.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
         AND g.sales_order_id = ANY(${ids}::uuid[])
       GROUP BY g.sales_order_id, pm.item_id
    ), iss AS (
      SELECT i.sales_order_id AS so_id, pm.item_id,
             SUM(i.qty - i.returned_to_store_qty) AS issued
        FROM public.party_material_issues i
        JOIN public.party_materials pm ON pm.id = i.party_material_id
       WHERE i.company_id = ${companyId}::uuid AND i.deleted_at IS NULL
         AND i.sales_order_id = ANY(${ids}::uuid[])
       GROUP BY i.sales_order_id, pm.item_id
    ), fit AS (
      SELECT c.sales_order_id AS so_id, c.item_id, SUM(c.qty) AS fitted
        FROM public.assembly_unit_consumptions c
       WHERE c.company_id = ${companyId}::uuid AND c.deleted_at IS NULL
         AND c.sales_order_id = ANY(${ids}::uuid[])
       GROUP BY c.sales_order_id, c.item_id
    ), ret AS (
      SELECT r.sales_order_id AS so_id, pm.item_id, SUM(rl.qty) AS returned
        FROM public.customer_material_return_lines rl
        JOIN public.customer_material_returns r ON r.id = rl.return_id
        JOIN public.party_materials pm ON pm.id = rl.party_material_id
       WHERE r.company_id = ${companyId}::uuid AND r.deleted_at IS NULL
         AND r.status = 'issued' AND rl.deleted_at IS NULL AND rl.kind = 'good'
         AND r.sales_order_id = ANY(${ids}::uuid[])
       GROUP BY r.sales_order_id, pm.item_id
    )
    SELECT p.so_id, p.item_id, i.code AS item_code, i.name AS item_name,
           p.qty_per_set, COALESCE(s.order_qty, 0) AS order_qty,
           COALESCE(g.received, 0) AS received, COALESCE(g.accepted, 0) AS accepted,
           COALESCE(g.rejected, 0) AS rejected, COALESCE(g.rej_returned, 0) AS rej_returned,
           COALESCE(x.issued, 0) AS issued, COALESCE(f.fitted, 0) AS fitted,
           COALESCE(r.returned, 0) AS returned
      FROM parts p
      JOIN public.items i ON i.id = p.item_id
      LEFT JOIN sets s ON s.so_id = p.so_id
      LEFT JOIN grn g ON g.so_id = p.so_id AND g.item_id = p.item_id
      LEFT JOIN iss x ON x.so_id = p.so_id AND x.item_id = p.item_id
      LEFT JOIN fit f ON f.so_id = p.so_id AND f.item_id = p.item_id
      LEFT JOIN ret r ON r.so_id = p.so_id AND r.item_id = p.item_id
     ORDER BY i.code
  `)) as unknown as Array<Record<string, unknown>>;

  for (const r of rows) {
    const qtyPerSet = Number(r.qty_per_set ?? 0);
    const needQty = n(Math.ceil(qtyPerSet * Number(r.order_qty ?? 0)));
    const receivedQty = n(r.received);
    const acceptedQty = n(r.accepted);
    const rejected = n(r.rejected);
    const waitingQcQty = n(receivedQty - acceptedQty - rejected);
    const issuedQty = n(r.issued);
    const returnedQty = n(r.returned);
    const figures: SoCustomerPartFigures = {
      needQty,
      receivedQty,
      waitingQcQty,
      acceptedQty,
      deviatedHeldQty: n(rejected - n(r.rej_returned)),
      issuedQty,
      fittedQty: n(r.fitted),
      returnedQty,
      inStoreQty: n(acceptedQty - issuedQty - returnedQty),
      pendingQty: n(needQty - acceptedQty - waitingQcQty),
      shortQty: n(needQty - acceptedQty),
      partyGrnStatus: grnStatus(acceptedQty, needQty),
    };
    const soId = String(r.so_id);
    const m = out.get(soId) ?? new Map<string, SoCustomerPart>();
    m.set(String(r.item_id), {
      rmItemId: String(r.item_id),
      rmItemCode: String(r.item_code),
      rmItemName: String(r.item_name),
      qtyPerSet,
      figures,
    });
    out.set(soId, m);
  }
  return out;
}

/** Customer parts of one SO, keyed by RM item id (empty map = none). */
export async function readSoCustomerParts(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<Map<string, SoCustomerPart>> {
  return (await readSoCustomerPartsMany(tx, companyId, [soId])).get(soId) ?? new Map();
}
