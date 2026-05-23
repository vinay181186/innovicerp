// QC Documents service (QC Wave 5). Mirrors legacy renderQCDocuments L23039.
// CRUD over qc_documents (migration 0039). Files themselves live in the
// `qc-docs` Storage bucket — the client uploads direct, then registers metadata.

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateQcDocumentInput,
  ListQcDocumentsQuery,
  ListQcDocumentsResponse,
  QcDocument,
} from '@innovic/shared';
import { qcDocuments } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

type Row = typeof qcDocuments.$inferSelect;

function toItem(r: Row): QcDocument {
  return {
    id: r.id,
    companyId: r.companyId,
    jobCardId: r.jobCardId ?? null,
    jcCodeText: r.jcCodeText ?? null,
    salesOrderId: r.salesOrderId ?? null,
    soCodeText: r.soCodeText ?? null,
    category: r.category,
    docType: r.docType,
    fileName: r.fileName,
    storagePath: r.storagePath,
    uploadedByText: r.uploadedByText ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

export async function listQcDocuments(
  input: ListQcDocumentsQuery,
  user: AuthContext,
): Promise<ListQcDocumentsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conds = [eq(qcDocuments.companyId, companyId), isNull(qcDocuments.deletedAt)];
    if (input.category) conds.push(eq(qcDocuments.category, input.category));
    if (input.jobCardId) conds.push(eq(qcDocuments.jobCardId, input.jobCardId));
    if (input.search) {
      const term = `%${input.search}%`;
      conds.push(
        sql`(${qcDocuments.fileName} ILIKE ${term} OR ${qcDocuments.docType} ILIKE ${term} OR ${qcDocuments.jcCodeText} ILIKE ${term} OR ${qcDocuments.soCodeText} ILIKE ${term})`,
      );
    }
    const rows = await tx
      .select()
      .from(qcDocuments)
      .where(and(...conds))
      .orderBy(desc(qcDocuments.createdAt));
    return { items: rows.map(toItem) };
  });
}

export async function createQcDocument(
  input: CreateQcDocumentInput,
  user: AuthContext,
): Promise<QcDocument> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const inserted = await tx
      .insert(qcDocuments)
      .values({
        companyId,
        jobCardId: input.jobCardId ?? null,
        jcCodeText: input.jcCodeText ?? null,
        salesOrderId: input.salesOrderId ?? null,
        soCodeText: input.soCodeText ?? null,
        category: input.category,
        docType: input.docType,
        fileName: input.fileName,
        storagePath: input.storagePath,
        uploadedByText: user.email ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return toItem(inserted[0] as Row);
  });
}

export async function deleteQcDocument(id: string, user: AuthContext): Promise<{ id: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const updated = await tx
      .update(qcDocuments)
      .set({ deletedAt: new Date(), updatedBy: user.id, updatedAt: new Date() })
      .where(
        and(
          eq(qcDocuments.id, id),
          eq(qcDocuments.companyId, companyId),
          isNull(qcDocuments.deletedAt),
        ),
      )
      .returning({ id: qcDocuments.id });
    if (updated.length === 0) throw new NotFoundError(`QC document ${id} not found`);
    return { id };
  });
}
