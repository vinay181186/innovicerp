// Return-to-vendor challan predicates (ADR-208) — the ONE definition.
//
// "An NC is ready for its return-to-vendor challan" is the exact triple that
// createNcDc (nc-register/service.ts) enforces before it raises the challan:
//   - disposition guard   nc.disposition = 'return_to_vendor'
//   - status guard        nc.status      = 'disposed'
//   - one-challan lock    nc.delivery_challan_id IS NULL
// Two readers use it and must never disagree with createNcDc or each other:
//   - the NC list's pendingRtvChallan filter (+New DC → Against NC), and
//   - GET /delivery-challans/rtv-candidates + the Against PO guard
//     (delivery-challans/rtv-candidates.ts).
// If createNcDc's guards ever change, change this fragment in the same commit.

import { sql, type SQL } from 'drizzle-orm';

/** Parenthesised boolean SQL (no leading AND) for the NC row aliased `ncAlias`. */
export function rtvReadyForChallanSql(ncAlias = 'nc'): SQL {
  const nc = sql.identifier(ncAlias);
  return sql`(${nc}.disposition = 'return_to_vendor'::nc_disposition
    AND ${nc}.status = 'disposed'::nc_status
    AND ${nc}.delivery_challan_id IS NULL)`;
}
