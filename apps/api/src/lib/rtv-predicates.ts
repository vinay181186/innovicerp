// Return-to-vendor challan predicates (ADR-211) — the ONE SQL definition.
//
// "An NC is ready for its return-to-vendor challan" mirrors the guards that
// createNcDc (nc-register/service.ts) enforces before it raises the challan:
//   - disposition guard   nc.disposition = 'return_to_vendor'
//   - status guard        nc.status      = 'disposed'
//   - one-challan lock    nc.delivery_challan_id IS NULL
//   - active-challan check  no delivery_challans row with nc_id = nc.id,
//                           deleted_at IS NULL and status <> 'cancelled'
// createNcDc keeps its own TypeScript checks (it needs the NC row it read
// FOR UPDATE); this SQL mirrors them for the readers. Keep in lock-step with
// createNcDc's guards — if one changes, change the other in the same commit.
// Readers, which must never disagree with createNcDc or each other:
//   - the NC list's pendingRtvChallan filter (+New DC → Against NC) — intended,
//     so an NC the list offers is one createNcDc will accept, and
//   - GET /delivery-challans/rtv-candidates + the Against PO guard
//     (delivery-challans/rtv-candidates.ts).

import { sql, type SQL } from 'drizzle-orm';

/** Parenthesised boolean SQL (no leading AND) for the NC row aliased `ncAlias`. */
export function rtvReadyForChallanSql(ncAlias = 'nc'): SQL {
  const nc = sql.identifier(ncAlias);
  return sql`(${nc}.disposition = 'return_to_vendor'::nc_disposition
    AND ${nc}.status = 'disposed'::nc_status
    AND ${nc}.delivery_challan_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_challans adc
       WHERE adc.nc_id = ${nc}.id
         AND adc.deleted_at IS NULL
         AND adc.status <> 'cancelled'
    ))`;
}
