// OW-143 — where the customer's own raw material (Customer RM) is, per JWSO
// line. ONE read, ONE SQL statement for every given JWSO's live lines (no N+1);
// the JWSO list and the JWSO detail both call it. The status word comes from
// the shared rule (packages/shared lib/customer-rm-status.ts) — nothing is
// stored, so no writer can leave it out of step.
//
// The figures copy the filters of the write-path caps on purpose, so the
// screen and the caps agree:
//   - accepted / netIssued / goodReturned = party-material-issues/register.ts
//     `jwLineRegister` (the Issue-to-JC cap; that file stays untouched).
//     Accepted has NO qc_at filter — grandfathered pre-QC receipts carry
//     accepted = received with qc_at NULL (migration 0173) and are in store.
//   - qcPending = Σ party-grn QC_PENDING_QTY_SQL (received − accepted −
//     rejected; partial QC 0233 — a part-inspected line counts what is left).
//   - deviated  = the pending-NC half of party-grn `partyCommittedQtySql`
//     (ADR-247), same joins.
// Every table is company-filtered and soft-delete-filtered; a cancelled Party
// GRN stamps its header's deleted_at, so the header join drops it.

import { sql } from 'drizzle-orm';
import type { CustomerRmQty } from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { QC_PENDING_QTY_SQL } from '../party-grn/qc-state';

export interface CustomerRmLineRow {
  jwId: string;
  lineId: string;
  qty: CustomerRmQty;
}

/** Customer RM quantities for every live line of the given JWSOs. */
export async function customerRmByJw(
  tx: DbTransaction,
  companyId: string,
  jwIds: readonly string[],
): Promise<CustomerRmLineRow[]> {
  if (jwIds.length === 0) return [];
  const idList = sql.join(
    jwIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await tx.execute(sql`
    WITH ln AS (
      SELECT l.id, l.job_work_order_id,
             -- A short-closed or cancelled line needs nothing more from the
             -- customer (the Party GRN picker drops it too).
             CASE WHEN (l.rm_item_id IS NOT NULL OR l.party_material_id IS NOT NULL)
                       AND l.short_closed_at IS NULL AND l.status <> 'cancelled'
                  THEN l.order_qty ELSE 0 END AS required_qty
        FROM public.job_work_order_lines l
       WHERE l.company_id = ${companyId}::uuid
         AND l.deleted_at IS NULL
         AND l.job_work_order_id IN (${idList})
    ),
    grn AS (
      SELECT pgl.jw_line_id,
             SUM(pgl.received_qty) AS received_qty,
             SUM(${QC_PENDING_QTY_SQL}) AS qc_pending_qty,
             SUM(pgl.accepted_qty) AS accepted_qty
        FROM public.party_grn_lines pgl
        JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
       WHERE pgl.jw_line_id IN (SELECT id FROM ln)
         AND pgl.company_id = ${companyId}::uuid
         AND pgl.deleted_at IS NULL
       GROUP BY pgl.jw_line_id
    ),
    nc AS (
      SELECT pglc.jw_line_id, SUM(ncc.rejected_qty) AS deviated_qty
        FROM public.nc_register ncc
        JOIN public.party_grn_lines pglc ON pglc.id = ncc.party_grn_line_id
             AND pglc.deleted_at IS NULL
        JOIN public.party_grn pgn ON pgn.id = pglc.party_grn_id AND pgn.deleted_at IS NULL
       WHERE pglc.jw_line_id IN (SELECT id FROM ln)
         AND ncc.company_id = ${companyId}::uuid
         AND ncc.deleted_at IS NULL
         AND ncc.status = 'pending'
       GROUP BY pglc.jw_line_id
    ),
    iss AS (
      SELECT mi.jw_line_id, SUM(mi.qty - mi.returned_to_store_qty) AS issued_qty
        FROM public.party_material_issues mi
       WHERE mi.jw_line_id IN (SELECT id FROM ln)
         AND mi.company_id = ${companyId}::uuid
         AND mi.deleted_at IS NULL
       GROUP BY mi.jw_line_id
    ),
    cmr AS (
      SELECT cl.jw_line_id,
             SUM(cl.qty) AS returned_qty,
             SUM(cl.qty) FILTER (WHERE cl.kind = 'good') AS good_returned_qty
        FROM public.customer_material_return_lines cl
        JOIN public.customer_material_returns c
          ON c.id = cl.return_id AND c.deleted_at IS NULL AND c.status <> 'cancelled'
       WHERE cl.jw_line_id IN (SELECT id FROM ln)
         AND cl.company_id = ${companyId}::uuid
         AND cl.deleted_at IS NULL
       GROUP BY cl.jw_line_id
    )
    SELECT ln.job_work_order_id AS "jwId", ln.id AS "lineId",
           COALESCE(ln.required_qty, 0)::int AS "requiredQty",
           COALESCE(grn.received_qty, 0)::int AS "receivedQty",
           COALESCE(grn.qc_pending_qty, 0)::int AS "qcPendingQty",
           COALESCE(nc.deviated_qty, 0)::int AS "deviatedQty",
           COALESCE(grn.accepted_qty, 0)::int AS "acceptedQty",
           COALESCE(iss.issued_qty, 0)::int AS "issuedQty",
           COALESCE(cmr.returned_qty, 0)::int AS "returnedQty",
           COALESCE(cmr.good_returned_qty, 0)::int AS "goodReturnedQty"
      FROM ln
      LEFT JOIN grn ON grn.jw_line_id = ln.id
      LEFT JOIN nc ON nc.jw_line_id = ln.id
      LEFT JOIN iss ON iss.jw_line_id = ln.id
      LEFT JOIN cmr ON cmr.jw_line_id = ln.id
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const acceptedQty = Number(r['acceptedQty'] ?? 0);
    const issuedQty = Number(r['issuedQty'] ?? 0);
    const goodReturned = Number(r['goodReturnedQty'] ?? 0);
    return {
      jwId: String(r['jwId']),
      lineId: String(r['lineId']),
      qty: {
        requiredQty: Number(r['requiredQty'] ?? 0),
        receivedQty: Number(r['receivedQty'] ?? 0),
        qcPendingQty: Number(r['qcPendingQty'] ?? 0),
        deviatedQty: Number(r['deviatedQty'] ?? 0),
        acceptedQty,
        // Same formula as jwLineRegister's balance — never clamped.
        inStoreQty: acceptedQty - issuedQty - goodReturned,
        issuedQty,
        returnedQty: Number(r['returnedQty'] ?? 0),
      },
    };
  });
}
