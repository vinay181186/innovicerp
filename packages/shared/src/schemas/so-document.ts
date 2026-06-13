// SO Documents schemas (ADR-047). The SO Documents screen is the first
// producer/consumer of the unified file_registry (migration 0055). Files live
// in the `qc-docs` Supabase Storage bucket (client uploads direct); this
// registers the metadata. Mirrors legacy renderSODocs (L19478): an SO selector
// + overview table, then per-SO files grouped by line → category, with QC docs
// surfaced read-only (they keep their own qc_documents table).

import { z } from 'zod';

// Same category vocabulary as legacy fileRegistry.category (L19579).
export const SO_DOC_CATEGORIES = [
  'drawing',
  'qc-docs',
  'inspection',
  'tpi',
  'incoming-qc',
  'po-docs',
  'client_po',
  'design',
  'dispatch',
  'other',
] as const;
export const soDocCategorySchema = z.enum(SO_DOC_CATEGORIES);
export type SoDocCategory = (typeof SO_DOC_CATEGORIES)[number];

// Display labels + render order (legacy catLabels / catOrder L19595).
export const SO_DOC_CATEGORY_LABELS: Record<SoDocCategory, string> = {
  drawing: 'Drawings',
  'qc-docs': 'QC Documents',
  inspection: 'Inspection Reports',
  tpi: 'TPI Reports',
  'incoming-qc': 'Incoming QC (GRN)',
  'po-docs': 'PO Documents',
  client_po: 'Client PO',
  design: 'Design',
  dispatch: 'Dispatch',
  other: 'Other',
};
export const SO_DOC_CATEGORY_ORDER: SoDocCategory[] = [
  'drawing',
  'qc-docs',
  'inspection',
  'tpi',
  'incoming-qc',
  'po-docs',
  'client_po',
  'design',
  'dispatch',
  'other',
];

/** A registered file. `source` distinguishes editable registry rows from
 *  QC docs union'd in read-only (managed in the QC module, no delete here). */
export interface SoDocumentFile {
  id: string;
  source: 'registry' | 'qc';
  salesOrderId: string | null;
  soLineId: string | null;
  soLineNo: number | null;
  jobCardId: string | null;
  jcCodeText: string | null;
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

/** One row of the all-SOs overview table (legacy L19499-19513). */
export interface SoDocumentOverviewRow {
  salesOrderId: string;
  soCode: string;
  customerName: string | null;
  status: string;
  /** Active file_registry rows for this SO. */
  fileCount: number;
  /** QC docs (qc_documents) for this SO, surfaced read-only. */
  qcCount: number;
  /** Sum of file_registry file_size (bytes) for active rows. */
  totalSize: number;
  /** Archived file_registry rows. */
  archivedCount: number;
}
export interface SoDocumentOverviewResponse {
  rows: SoDocumentOverviewRow[];
}

/** A line of the selected SO (drives the per-line file groups). */
export interface SoDocumentLine {
  soLineId: string;
  lineNo: number;
  itemCode: string | null;
  itemName: string | null;
  orderQty: number;
  clientPoLineNo: string | null;
}

export interface SoDocumentDetailResponse {
  so: { id: string; code: string; customerName: string | null; status: string };
  lines: SoDocumentLine[];
  /** All files (registry + read-only QC) for the SO; client groups by line/category. */
  files: SoDocumentFile[];
  totals: {
    fileCount: number;
    totalSize: number;
    archivedCount: number;
    qcCount: number;
  };
}

export const soDocumentDetailQuerySchema = z.object({
  salesOrderId: z.string().uuid(),
});
export type SoDocumentDetailQuery = z.infer<typeof soDocumentDetailQuerySchema>;

/** Create a file_registry metadata row after the client uploads to Storage. */
export const createSoDocumentInputSchema = z.object({
  salesOrderId: z.string().uuid(),
  soCodeText: z.string().max(64).optional(),
  soLineId: z.string().uuid().optional(),
  soLineNo: z.number().int().nonnegative().optional(),
  jobCardId: z.string().uuid().optional(),
  jcCodeText: z.string().max(64).optional(),
  category: soDocCategorySchema.default('other'),
  docType: z.string().max(120).optional(),
  fileName: z.string().min(1).max(255),
  storagePath: z.string().min(1).max(512),
  fileSize: z.number().int().nonnegative().optional(),
  fileType: z.string().max(120).optional(),
});
export type CreateSoDocumentInput = z.infer<typeof createSoDocumentInputSchema>;
