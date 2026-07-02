// JWSO Documents schemas (#8). JWSOs live in their own job_work_orders tables
// (not sales_orders), so they get their own document input/query keyed by
// jobWorkOrderId. Backed by the same unified file_registry (migration 0058 adds
// the job_work_order_id dimension). Reuses the SO document category vocabulary
// so both producers share one taxonomy; the JWSO PO-doc upload defaults to
// `po-docs`. Files live in the `qc-docs` Storage bucket, folder `jw-docs`.

import { z } from 'zod';
import { soDocCategorySchema } from './so-document';

/** A registered JWSO file (file_registry row). Mirrors SoDocumentFile but keyed
 *  to a Job-Work Order rather than a Sales Order. */
export interface JwDocumentFile {
  id: string;
  jobWorkOrderId: string | null;
  jwCodeText: string | null;
  jwLineId: string | null;
  jwLineNo: number | null;
  category: string;
  docType: string | null;
  fileName: string;
  storagePath: string;
  fileSize: number | null;
  fileType: string | null;
  status: string;
  uploadedByText: string | null;
  createdAt: string;
}

export interface JwDocumentListResponse {
  files: JwDocumentFile[];
}

/** List the documents for one JWSO. */
export const jwDocumentListQuerySchema = z.object({
  jobWorkOrderId: z.string().uuid(),
});
export type JwDocumentListQuery = z.infer<typeof jwDocumentListQuerySchema>;

/** Register an uploaded file (client already pushed bytes to Storage). */
export const createJwDocumentInputSchema = z.object({
  jobWorkOrderId: z.string().uuid(),
  jwCodeText: z.string().max(64).optional(),
  jwLineId: z.string().uuid().optional(),
  jwLineNo: z.number().int().nonnegative().optional(),
  category: soDocCategorySchema.default('po-docs'),
  docType: z.string().max(120).optional(),
  fileName: z.string().min(1).max(255),
  storagePath: z.string().min(1).max(512),
  fileSize: z.number().int().nonnegative().optional(),
  fileType: z.string().max(120).optional(),
});
export type CreateJwDocumentInput = z.infer<typeof createJwDocumentInputSchema>;
