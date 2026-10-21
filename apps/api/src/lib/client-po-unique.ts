// Client PO No. is unique per CUSTOMER within its own list (owner rule
// 2026-10-17, narrowed to per customer by ADR-245 on 2026-10-21):
//   - an SO's Client PO No. may not be on another live SO of the SAME customer;
//   - a JWSO's Client PO No. may not be on another live JWSO of the SAME customer;
//   - a different customer may use the same number (it is the customer's own
//     PO numbering), and the same number on one SO and one JWSO is allowed.
// "Live" = not deleted; cancelled documents still count. Compared with every
// run of white space (tabs, NBSP from a pasted e-mail) as one space, trimmed
// and case-insensitive — the same on both sides (keyOf / SQL_KEY). Blank is never checked. A legacy order with no customer
// link is compared only with other unlinked orders.
//
// §20: the advisory lock (same pattern as lockDocSeries) serialises two saves
// of the same number for the same customer, so the second one sees the first
// and is refused. No DB unique index — legacy duplicates may exist and must
// not block a release; an old duplicate can still be saved as long as neither
// its number nor its customer is CHANGED (pass the stored values in `self`).

import { sql } from 'drizzle-orm';
import type { ClientPoCheckResponse } from '@innovic/shared';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError } from './errors';

const LIST = {
  so: sql`sales_orders`,
  jwso: sql`job_work_orders`,
} as const;

export type ClientPoList = keyof typeof LIST;

/** On edit: this document's id and its stored Client PO No. + customer. */
export interface ClientPoSelf {
  id: string;
  currentPoNo: string | null;
  currentClientId: string | null;
}

const keyOf = (poNo: string | null | undefined): string | null =>
  poNo?.replace(/\s+/g, ' ').trim().toLowerCase() || null;

/** The stored number normalised exactly like keyOf (JS \s covers tabs and NBSP; Postgres needs [[:space:]] + NBSP). */
const SQL_KEY = sql`lower(btrim(regexp_replace(coalesce(client_po_no, ''), ${'[[:space:]\\u00a0]+'}, ' ', 'g')))`;

/** The live order of the same customer already holding this number, or null.
 *  Read-only — the live check while typing and the save both use it. */
export async function findClientPoNoHolder(
  tx: DbTransaction,
  list: ClientPoList,
  companyId: string,
  clientId: string | null | undefined,
  poNo: string | null | undefined,
  excludeId?: string,
): Promise<ClientPoCheckResponse> {
  const key = keyOf(poNo);
  if (!key) return { taken: false, code: null };
  const rows = (await tx.execute(sql`
    SELECT code FROM public.${LIST[list]}
     WHERE company_id = ${companyId}::uuid
       AND deleted_at IS NULL
       AND ${SQL_KEY} = ${key}
       AND ${clientId ? sql`client_id = ${clientId}::uuid` : sql`client_id IS NULL`}
       ${excludeId ? sql`AND id <> ${excludeId}::uuid` : sql``}
     LIMIT 1
  `)) as unknown as Array<{ code: string }>;
  const code = rows[0]?.code ?? null;
  return { taken: code !== null, code };
}

/** The live check the SO / JWSO form runs while typing. On edit an order
 *  whose stored number AND customer are unchanged is never flagged — the save
 *  lets such a legacy duplicate through too (assertClientPoNoFree `self`). */
export async function checkClientPoNo(
  tx: DbTransaction,
  list: ClientPoList,
  companyId: string,
  query: { clientId?: string | undefined; clientPoNo: string; excludeId?: string | undefined },
): Promise<ClientPoCheckResponse> {
  if (query.excludeId) {
    const own = (await tx.execute(sql`
      SELECT client_po_no AS "clientPoNo", client_id AS "clientId" FROM public.${LIST[list]}
       WHERE id = ${query.excludeId}::uuid AND company_id = ${companyId}::uuid
    `)) as unknown as Array<{ clientPoNo: string | null; clientId: string | null }>;
    const o = own[0];
    if (
      o &&
      keyOf(o.clientPoNo) === keyOf(query.clientPoNo) &&
      (o.clientId ?? null) === (query.clientId ?? null)
    ) {
      return { taken: false, code: null };
    }
  }
  return findClientPoNoHolder(
    tx,
    list,
    companyId,
    query.clientId,
    query.clientPoNo,
    query.excludeId,
  );
}

export async function assertClientPoNoFree(
  tx: DbTransaction,
  list: ClientPoList,
  companyId: string,
  clientId: string | null | undefined,
  poNo: string | null | undefined,
  self?: ClientPoSelf,
): Promise<void> {
  const key = keyOf(poNo);
  if (!key) return;
  if (
    self &&
    keyOf(self.currentPoNo) === key &&
    (self.currentClientId ?? null) === (clientId ?? null)
  ) {
    return;
  }

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`client_po:${list}:${companyId}:${clientId ?? '-'}:${key}`}, 0))`,
  );
  const hit = await findClientPoNoHolder(tx, list, companyId, clientId, poNo, self?.id);
  if (hit.code) {
    throw new ConflictError(
      `Client PO No. "${poNo!.trim()}" already exists in ${hit.code} for this customer. Duplicate not allowed.`,
    );
  }
}
