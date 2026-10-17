// Client PO No. is unique WITHIN its own list (owner rule 2026-10-17):
//   - an SO's Client PO No. may not be on another live SO;
//   - a JWSO's Client PO No. may not be on another live JWSO;
//   - the same number on one SO and one JWSO is allowed.
// "Live" = not deleted; cancelled documents still count. Compared trimmed and
// case-insensitive. Blank is never checked.
//
// §20: the advisory lock (same pattern as lockDocSeries) serialises two saves
// of the same number, so the second one sees the first and is refused. No DB
// unique index — legacy duplicates may exist and must not block a release; an
// old duplicate can still be saved as long as its number is not CHANGED (pass
// the stored value as `currentPoNo`).

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError } from './errors';

const LIST = {
  so: sql`sales_orders`,
  jwso: sql`job_work_orders`,
} as const;

export async function assertClientPoNoFree(
  tx: DbTransaction,
  list: keyof typeof LIST,
  companyId: string,
  poNo: string | null | undefined,
  /** On edit: this document's id and its stored Client PO No. */
  self?: { id: string; currentPoNo: string | null },
): Promise<void> {
  const key = poNo?.trim().toLowerCase();
  if (!key) return;
  if (self && self.currentPoNo?.trim().toLowerCase() === key) return;

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`client_po:${list}:${companyId}:${key}`}, 0))`,
  );
  const rows = (await tx.execute(sql`
    SELECT code FROM public.${LIST[list]}
     WHERE company_id = ${companyId}::uuid
       AND deleted_at IS NULL
       AND lower(trim(client_po_no)) = ${key}
       ${self ? sql`AND id <> ${self.id}::uuid` : sql``}
     LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  const hit = rows[0]?.code;
  if (hit) {
    throw new ConflictError(
      `Client PO No. "${poNo!.trim()}" already exists in ${hit}. Duplicate not allowed.`,
    );
  }
}
