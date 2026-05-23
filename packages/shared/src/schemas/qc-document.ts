// QC Documents schemas (QC Wave 5). Mirrors legacy renderQCDocuments L23039.
// Files live in the `qc-docs` Supabase Storage bucket (client uploads direct);
// this registers the metadata. Backed by qc_documents (migration 0039).

import { z } from 'zod';

export const QC_DOC_CATEGORIES = [
  'qc-docs',
  'drawing',
  'inspection',
  'tpi',
  'incoming-qc',
  'po-docs',
  'design',
  'dispatch',
  'other',
] as const;
export const qcDocCategorySchema = z.enum(QC_DOC_CATEGORIES);
export type QcDocCategory = (typeof QC_DOC_CATEGORIES)[number];

export const QC_DOC_TYPES = [
  'MIR',
  'MCR',
  'Inspection Report Protocol',
  'Inspection Report',
  'TPI Report',
  'Drawing',
  'Certificate',
  'Other',
] as const;

export const qcDocumentSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  jobCardId: z.string().uuid().nullable(),
  jcCodeText: z.string().nullable(),
  salesOrderId: z.string().uuid().nullable(),
  soCodeText: z.string().nullable(),
  category: z.string(),
  docType: z.string(),
  fileName: z.string(),
  storagePath: z.string(),
  uploadedByText: z.string().nullable(),
  createdAt: z.string(),
});
export type QcDocument = z.infer<typeof qcDocumentSchema>;

export const listQcDocumentsQuerySchema = z.object({
  category: qcDocCategorySchema.optional(),
  jobCardId: z.string().uuid().optional(),
  search: z.string().min(1).max(100).optional(),
});
export type ListQcDocumentsQuery = z.infer<typeof listQcDocumentsQuerySchema>;

export interface ListQcDocumentsResponse {
  items: QcDocument[];
}

export const createQcDocumentInputSchema = z.object({
  jobCardId: z.string().uuid().optional(),
  jcCodeText: z.string().max(64).optional(),
  salesOrderId: z.string().uuid().optional(),
  soCodeText: z.string().max(64).optional(),
  category: qcDocCategorySchema.default('qc-docs'),
  docType: z.string().min(1).max(80),
  fileName: z.string().min(1).max(255),
  storagePath: z.string().min(1).max(512),
});
export type CreateQcDocumentInput = z.infer<typeof createQcDocumentInputSchema>;
