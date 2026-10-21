// Customer Challan No. (party_grn.dc_no) is unique PER CUSTOMER (owner rule
// 2026-10-21): the same challan number may not be on two live Party GRNs of
// the same customer. Two different customers may use the same number.
// Compared trimmed and case-insensitive. Blank is never checked (the shared
// schema already refuses a blank challan).
//
// Differs from the Client PO No. rule (client-po-unique.ts): a cancelled Party
// GRN is soft-deleted (deleted_at set), and that FREES its challan number — so
// "live" here = deleted_at IS NULL, and nothing else.
//
// §20: the advisory lock (same pattern as lockDocSeries / client-po-unique)
// serialises two saves of the same number for the same customer, so the second
// one sees the first and is refused. No DB unique index — an old duplicate can
// still be saved as long as its number is not CHANGED (pass the stored value
// as `currentDcNo`).

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError } from './errors';

export async function assertPartyGrnDcNoFree(
  tx: DbTransaction,
  companyId: string,
  clientId: string | null,
  dcNo: string | null | undefined,
  /** On edit: this Party GRN's id and its stored Customer Challan No. */
  self?: { id: string; currentDcNo: string | null },
): Promise<void> {
  const key = dcNo?.trim().toLowerCase();
  if (!key) return;
  if (self && self.currentDcNo?.trim().toLowerCase() === key) return;

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`party_grn_dc:${companyId}:${clientId ?? 'none'}:${key}`}, 0))`,
  );
  const rows = (await tx.execute(sql`
    SELECT code FROM public.party_grn
     WHERE company_id = ${companyId}::uuid
       AND client_id IS NOT DISTINCT FROM ${clientId}::uuid
       AND deleted_at IS NULL
       AND lower(trim(dc_no)) = ${key}
       ${self ? sql`AND id <> ${self.id}::uuid` : sql``}
     LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  const hit = rows[0]?.code;
  if (hit) {
    throw new ConflictError(
      `Customer Challan No. "${dcNo!.trim()}" is already on ${hit} for this customer. Duplicate not allowed.`,
    );
  }
}
