// SO Documents service (ADR-047). Mirrors legacy renderSODocs (L19478): an
// all-SOs overview with file counts, then per-SO files grouped by line →
// category. Backed by the unified file_registry (migration 0055). Files live in
// the `qc-docs` Storage bucket — the client uploads direct, then registers
// metadata here. QC docs keep their own qc_documents table and are surfaced
// read-only via UNION (source='qc', no delete here).

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateSoDocumentInput,
  SoDocumentDetailResponse,
  SoDocumentFile,
  SoDocumentLine,
  SoDocumentOverviewResponse,
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

/** All-SOs overview table (legacy L19499-19513): per-SO active file count +
 *  size, archived count, and a read-only QC-doc count. */
export async function listSoDocumentOverview(
  user: AuthContext,
): Promise<SoDocumentOverviewResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rs = await tx.execute(sql`
      SELECT
        so.id, so.code AS "soCode", so.customer_name AS "customerName", so.status,
        COALESCE(fr.cnt, 0)  AS "fileCount",
        COALESCE(fr.sz, 0)   AS "totalSize",
        COALESCE(fa.cnt, 0)  AS "archivedCount",
        COALESCE(qd.cnt, 0)  AS "qcCount"
      FROM public.sales_orders so
      LEFT JOIN (
        SELECT sales_order_id, COUNT(*) AS cnt, COALESCE(SUM(file_size), 0) AS sz
        FROM public.file_registry
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL AND status = 'active'
        GROUP BY sales_order_id
      ) fr ON fr.sales_order_id = so.id
      LEFT JOIN (
        SELECT sales_order_id, COUNT(*) AS cnt
        FROM public.file_registry
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL AND status = 'archived'
        GROUP BY sales_order_id
      ) fa ON fa.sales_order_id = so.id
      LEFT JOIN (
        SELECT sales_order_id, COUNT(*) AS cnt
        FROM public.qc_documents
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL AND sales_order_id IS NOT NULL
        GROUP BY sales_order_id
      ) qd ON qd.sales_order_id = so.id
      WHERE so.company_id = ${companyId}::uuid AND so.deleted_at IS NULL
      ORDER BY so.code DESC
    `);
    return {
      rows: rows(rs).map((r) => ({
        salesOrderId: r['id'] as string,
        soCode: r['soCode'] as string,
        customerName: (r['customerName'] as string | null) ?? null,
        status: (r['status'] as string | null) ?? 'open',
        fileCount: num(r['fileCount']),
        qcCount: num(r['qcCount']),
        totalSize: num(r['totalSize']),
        archivedCount: num(r['archivedCount']),
      })),
    };
  });
}

/** One SO's documents (legacy L19522-19645): header, lines, and all files
 *  (file_registry rows + read-only QC docs), for the client to group. */
export async function getSoDocumentDetail(
  salesOrderId: string,
  user: AuthContext,
): Promise<SoDocumentDetailResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const soRows = await tx.execute(sql`
      SELECT so.id, so.code, so.customer_name AS "customerName", so.status
      FROM public.sales_orders so
      WHERE so.id = ${salesOrderId}::uuid AND so.company_id = ${companyId}::uuid
        AND so.deleted_at IS NULL
    `);
    const soRow = rows(soRows)[0];
    if (!soRow) throw new NotFoundError(`Sales order ${salesOrderId} not found`);

    const lineRows = await tx.execute(sql`
      SELECT
        sol.id AS "soLineId", sol.line_no AS "lineNo",
        sol.client_po_line_no AS "clientPoLineNo",
        COALESCE(i.code, sol.item_code_text) AS "itemCode",
        COALESCE(i.name, sol.part_name) AS "itemName",
        sol.order_qty AS "orderQty"
      FROM public.sales_order_lines sol
      LEFT JOIN public.items i ON i.id = sol.item_id
      WHERE sol.sales_order_id = ${salesOrderId}::uuid AND sol.deleted_at IS NULL
      ORDER BY sol.line_no
    `);
    const lines: SoDocumentLine[] = rows(lineRows).map((r) => ({
      soLineId: r['soLineId'] as string,
      lineNo: num(r['lineNo']),
      itemCode: (r['itemCode'] as string | null) ?? null,
      itemName: (r['itemName'] as string | null) ?? null,
      orderQty: num(r['orderQty']),
      clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
    }));

    // file_registry rows for the SO (editable).
    const frRows = rows(
      await tx.execute(sql`
        SELECT
          fr.id, fr.so_line_id AS "soLineId", fr.so_line_no AS "soLineNo",
          fr.job_card_id AS "jobCardId", fr.jc_code_text AS "jcCodeText",
          fr.category, fr.doc_type AS "docType", fr.file_name AS "fileName",
          fr.storage_path AS "storagePath", fr.file_size AS "fileSize",
          fr.file_type AS "fileType", fr.status, fr.uploaded_by_text AS "uploadedByText",
          fr.created_at AS "createdAt"
        FROM public.file_registry fr
        WHERE fr.company_id = ${companyId}::uuid AND fr.deleted_at IS NULL
          AND fr.sales_order_id = ${salesOrderId}::uuid
        ORDER BY fr.created_at DESC
      `),
    );

    // QC docs for the SO (read-only). Linked to a line via their JC's
    // source_so_line_id when available, else surfaced at SO level.
    const qcRows = rows(
      await tx.execute(sql`
        SELECT
          qd.id, qd.job_card_id AS "jobCardId", qd.jc_code_text AS "jcCodeText",
          qd.category, qd.doc_type AS "docType", qd.file_name AS "fileName",
          qd.storage_path AS "storagePath", qd.uploaded_by_text AS "uploadedByText",
          qd.created_at AS "createdAt",
          sol.id AS "soLineId", sol.line_no AS "soLineNo"
        FROM public.qc_documents qd
        LEFT JOIN public.job_cards jc ON jc.id = qd.job_card_id AND jc.deleted_at IS NULL
        LEFT JOIN public.sales_order_lines sol
          ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
        WHERE qd.company_id = ${companyId}::uuid AND qd.deleted_at IS NULL
          AND qd.sales_order_id = ${salesOrderId}::uuid
        ORDER BY qd.created_at DESC
      `),
    );

    const registryFiles: SoDocumentFile[] = frRows.map((r) => ({
      id: r['id'] as string,
      source: 'registry',
      salesOrderId,
      soLineId: (r['soLineId'] as string | null) ?? null,
      soLineNo: r['soLineNo'] == null ? null : num(r['soLineNo']),
      jobCardId: (r['jobCardId'] as string | null) ?? null,
      jcCodeText: (r['jcCodeText'] as string | null) ?? null,
      category: (r['category'] as string) ?? 'other',
      docType: (r['docType'] as string | null) ?? null,
      fileName: (r['fileName'] as string) ?? '',
      storagePath: (r['storagePath'] as string) ?? '',
      fileSize: r['fileSize'] == null ? null : num(r['fileSize']),
      fileType: (r['fileType'] as string | null) ?? null,
      status: (r['status'] as string) ?? 'active',
      uploadedByText: (r['uploadedByText'] as string | null) ?? null,
      createdAt: isoLike(r['createdAt']),
    }));

    const qcFiles: SoDocumentFile[] = qcRows.map((r) => ({
      id: r['id'] as string,
      source: 'qc',
      salesOrderId,
      soLineId: (r['soLineId'] as string | null) ?? null,
      soLineNo: r['soLineNo'] == null ? null : num(r['soLineNo']),
      jobCardId: (r['jobCardId'] as string | null) ?? null,
      jcCodeText: (r['jcCodeText'] as string | null) ?? null,
      category: (r['category'] as string) ?? 'qc-docs',
      docType: (r['docType'] as string | null) ?? null,
      fileName: (r['fileName'] as string) ?? '',
      storagePath: (r['storagePath'] as string) ?? '',
      fileSize: null,
      fileType: null,
      status: 'active',
      uploadedByText: (r['uploadedByText'] as string | null) ?? null,
      createdAt: isoLike(r['createdAt']),
    }));

    const activeRegistry = registryFiles.filter((f) => f.status === 'active');
    const totals = {
      fileCount: activeRegistry.length,
      totalSize: activeRegistry.reduce((s, f) => s + (f.fileSize ?? 0), 0),
      archivedCount: registryFiles.filter((f) => f.status === 'archived').length,
      qcCount: qcFiles.length,
    };

    return {
      so: {
        id: soRow['id'] as string,
        code: soRow['code'] as string,
        customerName: (soRow['customerName'] as string | null) ?? null,
        status: (soRow['status'] as string | null) ?? 'open',
      },
      lines,
      files: [...registryFiles, ...qcFiles],
      totals,
    };
  });
}

/** Register an uploaded file (client already pushed bytes to Storage). */
export async function createSoDocument(
  input: CreateSoDocumentInput,
  user: AuthContext,
): Promise<SoDocumentFile> {
  const companyId = requireCompany(user);
  if (user.role === 'viewer') {
    throw new AuthorizationError('Viewers cannot upload documents');
  }
  return withUserContext(user, async (tx) => {
    const inserted = await tx
      .insert(fileRegistry)
      .values({
        companyId,
        salesOrderId: input.salesOrderId,
        soCodeText: input.soCodeText ?? null,
        soLineId: input.soLineId ?? null,
        soLineNo: input.soLineNo ?? null,
        jobCardId: input.jobCardId ?? null,
        jcCodeText: input.jcCodeText ?? null,
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
      source: 'registry',
      salesOrderId: r.salesOrderId ?? null,
      soLineId: r.soLineId ?? null,
      soLineNo: r.soLineNo ?? null,
      jobCardId: r.jobCardId ?? null,
      jcCodeText: r.jcCodeText ?? null,
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

/** Soft-delete a registered file (file_registry only; QC docs are managed in
 *  the QC module and cannot be deleted here). */
export async function deleteSoDocument(id: string, user: AuthContext): Promise<{ id: string }> {
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
