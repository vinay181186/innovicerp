// Edit-approval engine (ADR-202) — the reads: the inbox list + per-document
// lookup, plus the isStale flag. Writers live in ./service.ts.

import { type SQL, and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  DocumentEditCountsResponse,
  DocumentEditEntity,
  DocumentEditRow,
  ListDocumentEditsQuery,
  ListDocumentEditsResponse,
} from '@innovic/shared';
import { documentEditRequests } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireCompany, selectDocumentEditRows } from './helpers';
import { DOC_EDIT_REGISTRY } from './registry';

export async function listDocumentEdits(
  query: ListDocumentEditsQuery,
  user: AuthContext,
): Promise<ListDocumentEditsResponse> {
  const companyId = requireCompany(user);
  // limit/offset are z.coerce fields — the shared input type leaves them untyped,
  // so coerce to number here (the route has already validated the bounds).
  const limit = Number(query.limit ?? 50);
  const offset = Number(query.offset ?? 0);
  const filter = {
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  return withUserContext(user, async (tx) => {
    const where: SQL[] = [
      eq(documentEditRequests.companyId, companyId),
      isNull(documentEditRequests.deletedAt),
    ];
    if (query.entity) where.push(eq(documentEditRequests.entity, query.entity));
    if (query.entityId) where.push(eq(documentEditRequests.entityId, query.entityId));
    if (query.status) where.push(eq(documentEditRequests.status, query.status));

    const [rows, totals] = await Promise.all([
      selectDocumentEditRows(tx, companyId, filter, { limit, offset }),
      tx.select({ value: count() }).from(documentEditRequests).where(and(...where)),
    ]);

    await markStale(tx, companyId, rows);
    return { rows, total: totals[0]?.value ?? 0 };
  });
}

/** GET /document-edits/counts — per-document-type edit-request counts split by
 *  status (pending / approved / rejected). ONE grouped query with conditional
 *  (FILTER) aggregates, company-scoped, active rows only. The WHERE keeps only
 *  the three reported statuses, so grouping by entity returns a row only for
 *  entities that have at least one request in one of them (withdrawn / superseded
 *  alone never appear). No HAVING, no N+1. An entity with none is simply absent —
 *  the frontend shows 0. Drives the Approvals page tabs and per-tab filter counts. */
export async function documentEditCounts(user: AuthContext): Promise<DocumentEditCountsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        entity: documentEditRequests.entity,
        pending: sql<number>`count(*) filter (where ${documentEditRequests.status} = 'pending')`,
        approved: sql<number>`count(*) filter (where ${documentEditRequests.status} = 'approved')`,
        rejected: sql<number>`count(*) filter (where ${documentEditRequests.status} = 'rejected')`,
      })
      .from(documentEditRequests)
      .where(
        and(
          eq(documentEditRequests.companyId, companyId),
          inArray(documentEditRequests.status, ['pending', 'approved', 'rejected']),
          isNull(documentEditRequests.deletedAt),
        ),
      )
      .groupBy(documentEditRequests.entity);

    return {
      counts: rows.map((r) => ({
        entity: r.entity as DocumentEditEntity,
        pending: Number(r.pending),
        approved: Number(r.approved),
        rejected: Number(r.rejected),
      })),
    };
  });
}

/** Sets isStale on pending rows whose document's current updated_at differs from
 *  the token captured when the edit was requested. Conservative: a change to an
 *  unrelated field also marks the request stale (the decide path then resolves
 *  each change precisely as approved / superseded). One query per entity type —
 *  no per-row lookup (§6). */
async function markStale(
  tx: DbTransaction,
  companyId: string,
  rows: DocumentEditRow[],
): Promise<void> {
  const pending = rows.filter((r) => r.status === 'pending');
  if (pending.length === 0) return;

  const byEntity = new Map<string, DocumentEditRow[]>();
  for (const r of pending) {
    const list = byEntity.get(r.entity) ?? [];
    list.push(r);
    byEntity.set(r.entity, list);
  }

  // The list projection omits the token; re-read it for the pending rows.
  const tokenRows = await tx
    .select({
      id: documentEditRequests.id,
      expectedUpdatedAt: documentEditRequests.expectedUpdatedAt,
    })
    .from(documentEditRequests)
    .where(
      and(
        eq(documentEditRequests.companyId, companyId),
        eq(documentEditRequests.status, 'pending'),
        isNull(documentEditRequests.deletedAt),
      ),
    );
  const tokenById = new Map(tokenRows.map((t) => [t.id, t.expectedUpdatedAt]));

  for (const [entity, list] of byEntity) {
    const entry = DOC_EDIT_REGISTRY[entity as DocumentEditEntity];
    if (!entry) continue;
    const currentById = await entry.loadUpdatedAts(
      tx,
      companyId,
      list.map((r) => r.entityId),
    );
    for (const r of list) {
      const current = currentById.get(r.entityId);
      if (!current) {
        r.isStale = true;
        continue;
      }
      r.isStale = !tokensEqual(tokenById.get(r.id), current);
    }
  }
}

function tokensEqual(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null;
  return new Date(a).getTime() === new Date(b).getTime();
}
