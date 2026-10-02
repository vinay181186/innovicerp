// Shared helpers for the edit-approval engine (ADR-202) — the company guard, the
// registry lookup, and the one projection that turns stored request rows into
// DocumentEditRow (used by both the writers in ./service.ts and the reads in
// ./list.ts). Kept here so neither of those imports the other.

import { type SQL, and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  DocumentEditChange,
  DocumentEditDecision,
  DocumentEditEntity,
  DocumentEditRow,
  DocumentEditStatus,
} from '@innovic/shared';
import { documentEditRequests, users } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { AuthorizationError, ValidationError } from '../../lib/errors';
import { DOC_EDIT_REGISTRY, type DocEditRegistryEntry } from './registry';

export const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export function getEntry(entity: string): DocEditRegistryEntry {
  const entry = DOC_EDIT_REGISTRY[entity as DocumentEditEntity];
  if (!entry) throw new ValidationError(`Edit approval is not enabled for ${entity}.`);
  return entry;
}

/** Projects stored request rows + requester/decider names into DocumentEditRow.
 *  isStale is left false here; ./list.ts fills it for the inbox. */
export async function selectDocumentEditRows(
  tx: DbTransaction,
  companyId: string,
  filter: { id?: string; entity?: string; entityId?: string; status?: DocumentEditStatus },
  page?: { limit: number; offset: number },
): Promise<DocumentEditRow[]> {
  const ru = alias(users, 'ru');
  const du = alias(users, 'du');
  const where: SQL[] = [
    eq(documentEditRequests.companyId, companyId),
    isNull(documentEditRequests.deletedAt),
  ];
  if (filter.id) where.push(eq(documentEditRequests.id, filter.id));
  if (filter.entity) where.push(eq(documentEditRequests.entity, filter.entity));
  if (filter.entityId) where.push(eq(documentEditRequests.entityId, filter.entityId));
  if (filter.status) where.push(eq(documentEditRequests.status, filter.status));

  const q = tx
    .select({
      id: documentEditRequests.id,
      entity: documentEditRequests.entity,
      entityId: documentEditRequests.entityId,
      docCode: documentEditRequests.docCode,
      status: documentEditRequests.status,
      changes: documentEditRequests.changes,
      decisions: documentEditRequests.decisions,
      requestedById: documentEditRequests.requestedBy,
      requestedByName: sql<string | null>`COALESCE(${ru.fullName}, ${ru.email})`,
      requestedAt: documentEditRequests.requestedAt,
      decidedById: documentEditRequests.decidedBy,
      decidedByName: sql<string | null>`COALESCE(${du.fullName}, ${du.email})`,
      decidedAt: documentEditRequests.decidedAt,
      decisionReason: documentEditRequests.decisionReason,
    })
    .from(documentEditRequests)
    .leftJoin(ru, eq(ru.id, documentEditRequests.requestedBy))
    .leftJoin(du, eq(du.id, documentEditRequests.decidedBy))
    .where(and(...where))
    .orderBy(desc(documentEditRequests.requestedAt), desc(documentEditRequests.id));
  const rows = page ? await q.limit(page.limit).offset(page.offset) : await q;

  return rows.map((r) => ({
    id: r.id,
    entity: r.entity as DocumentEditEntity,
    entityId: r.entityId,
    docCode: r.docCode,
    status: r.status,
    changes: (r.changes as DocumentEditChange[] | null) ?? [],
    decisions: (r.decisions as DocumentEditDecision[] | null) ?? [],
    requestedById: r.requestedById,
    requestedByName: r.requestedByName ?? 'Unknown',
    requestedAt: r.requestedAt.toISOString(),
    decidedById: r.decidedById,
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionReason: r.decisionReason,
    isStale: false,
  }));
}
