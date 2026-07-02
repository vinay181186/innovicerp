// JWSO Documents service (#8). JWSOs live in job_work_orders (not sales_orders),
// so their uploaded documents register against the unified file_registry via the
// job_work_order_id dimension added in migration 0058. Files live in the
// `qc-docs` Storage bucket (client uploads direct, then registers metadata
// here). Mirrors the SO-documents service; company-scoped + RLS via
// withUserContext, viewers cannot write.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateJwDocumentInput,
  JwDocumentFile,
  JwDocumentListResponse,
} from '@innovic/shared';
import { fileRegistry } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function rows(r: unknown): Array<Record<string, unknown>> {
  return r as unknown as Array<Record<string, unknown>>;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

function isoLike(v: unknown): string {
  if (v == null) return '';
  return v instanceof Date ? v.toISOString() : String(v);
}

/** All registered files for one JWSO (most recent first). */
export async function listJwDocuments(
  jobWorkOrderId: string,
  user: AuthContext,
): Promise<JwDocumentListResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the JWSO exists in this company (404 rather than a silent empty).
    const jw = rows(
      await tx.execute(sql`
        SELECT jw.id
        FROM public.job_work_orders jw
        WHERE jw.id = ${jobWorkOrderId}::uuid AND jw.company_id = ${companyId}::uuid
          AND jw.deleted_at IS NULL
      `),
    )[0];
    if (!jw) throw new NotFoundError(`Job-work order ${jobWorkOrderId} not found`);

    const frRows = rows(
      await tx.execute(sql`
        SELECT
          fr.id, fr.job_work_order_id AS "jobWorkOrderId", fr.jw_code_text AS "jwCodeText",
          fr.jw_line_id AS "jwLineId", fr.jw_line_no AS "jwLineNo",
          fr.category, fr.doc_type AS "docType", fr.file_name AS "fileName",
          fr.storage_path AS "storagePath", fr.file_size AS "fileSize",
          fr.file_type AS "fileType", fr.status, fr.uploaded_by_text AS "uploadedByText",
          fr.created_at AS "createdAt"
        FROM public.file_registry fr
        WHERE fr.company_id = ${companyId}::uuid AND fr.deleted_at IS NULL
          AND fr.job_work_order_id = ${jobWorkOrderId}::uuid
        ORDER BY fr.created_at DESC
      `),
    );

    return {
      files: frRows.map((r): JwDocumentFile => ({
        id: r['id'] as string,
        jobWorkOrderId: (r['jobWorkOrderId'] as string | null) ?? null,
        jwCodeText: (r['jwCodeText'] as string | null) ?? null,
        jwLineId: (r['jwLineId'] as string | null) ?? null,
        jwLineNo: r['jwLineNo'] == null ? null : num(r['jwLineNo']),
        category: (r['category'] as string) ?? 'po-docs',
        docType: (r['docType'] as string | null) ?? null,
        fileName: (r['fileName'] as string) ?? '',
        storagePath: (r['storagePath'] as string) ?? '',
        fileSize: r['fileSize'] == null ? null : num(r['fileSize']),
        fileType: (r['fileType'] as string | null) ?? null,
        status: (r['status'] as string) ?? 'active',
        uploadedByText: (r['uploadedByText'] as string | null) ?? null,
        createdAt: isoLike(r['createdAt']),
      })),
    };
  });
}

/** Register an uploaded JWSO file (client already pushed bytes to Storage). */
export async function createJwDocument(
  input: CreateJwDocumentInput,
  user: AuthContext,
): Promise<JwDocumentFile> {
  const companyId = requireCompany(user);
  if (user.role === 'viewer') {
    throw new AuthorizationError('Viewers cannot upload documents');
  }
  return withUserContext(user, async (tx) => {
    // Guard: the JWSO must belong to this company (RLS also enforces it).
    const jw = rows(
      await tx.execute(sql`
        SELECT jw.id
        FROM public.job_work_orders jw
        WHERE jw.id = ${input.jobWorkOrderId}::uuid AND jw.company_id = ${companyId}::uuid
          AND jw.deleted_at IS NULL
      `),
    )[0];
    if (!jw) throw new NotFoundError(`Job-work order ${input.jobWorkOrderId} not found`);

    const inserted = await tx
      .insert(fileRegistry)
      .values({
        companyId,
        jobWorkOrderId: input.jobWorkOrderId,
        jwCodeText: input.jwCodeText ?? null,
        jwLineId: input.jwLineId ?? null,
        jwLineNo: input.jwLineNo ?? null,
        category: input.category,
        docType: input.docType ?? null,
        fileName: input.fileName,
        storagePath: input.storagePath,
        fileSize: input.fileSize ?? null,
        fileType: input.fileType ?? null,
        status: 'active',
        uploadedByText: user.email ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const r = inserted[0];
    if (!r) throw new Error('Insert failed');
    return {
      id: r.id,
      jobWorkOrderId: r.jobWorkOrderId ?? null,
      jwCodeText: r.jwCodeText ?? null,
      jwLineId: r.jwLineId ?? null,
      jwLineNo: r.jwLineNo ?? null,
      category: r.category,
      docType: r.docType ?? null,
      fileName: r.fileName,
      storagePath: r.storagePath,
      fileSize: r.fileSize ?? null,
      fileType: r.fileType ?? null,
      status: r.status,
      uploadedByText: r.uploadedByText ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    };
  });
}

/** Soft-delete a registered JWSO file. */
export async function deleteJwDocument(id: string, user: AuthContext): Promise<{ id: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const updated = await tx
      .update(fileRegistry)
      .set({ deletedAt: new Date(), updatedBy: user.id, updatedAt: new Date() })
      .where(
        and(
          eq(fileRegistry.id, id),
          eq(fileRegistry.companyId, companyId),
          isNull(fileRegistry.deletedAt),
        ),
      )
      .returning({ id: fileRegistry.id });
    if (updated.length === 0) throw new NotFoundError(`Document ${id} not found`);
    return { id };
  });
}
