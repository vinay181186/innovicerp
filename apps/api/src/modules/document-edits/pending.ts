// Edit-approval (ADR-202) — "does this document already have an edit waiting?"
// A leaf file (schema + drizzle only), so a module's own writer can ask without
// importing the engine (which sits in an import cycle with the registries).

import { and, eq, isNull, sql } from 'drizzle-orm';
import { documentEditRequests } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

/** True when a PENDING edit request is open on the document. While one is, the
 *  document counts as live for edit-approval (the JWSO / SO registries'
 *  isLive): a further edit goes through the engine and is refused there ("…
 *  already has an edit waiting") instead of writing beside the stale request. */
export async function hasPendingDocumentEdit(
  tx: DbTransaction,
  companyId: string,
  entity: string,
  entityId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ one: sql<number>`1` })
    .from(documentEditRequests)
    .where(
      and(
        eq(documentEditRequests.companyId, companyId),
        eq(documentEditRequests.entity, entity),
        eq(documentEditRequests.entityId, entityId),
        eq(documentEditRequests.status, 'pending'),
        isNull(documentEditRequests.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
