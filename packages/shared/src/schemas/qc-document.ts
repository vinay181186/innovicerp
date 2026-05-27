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
  // QC-completion matrix link (migration 0043): which JC QC op this doc
  // certifies + the piece serial-range it covers. Drives the SO-pivoted
  // matrix in renderQCDocuments. All optional so the flat-register upload
  // path keeps working unchanged.
  jcOpId: z.string().uuid().optional(),
  qcOpName: z.string().max(120).optional(),
  srFrom: z.number().int().min(1).optional(),
  srTo: z.number().int().min(1).optional(),
});
export type CreateQcDocumentInput = z.infer<typeof createQcDocumentInputSchema>;

// ─── SO-pivoted QC-completion matrix (legacy renderQCDocuments L23039) ──────
// One SO is selected; the page shows that SO's QC-completion matrix: one row
// per JC per SO line, with a dynamic column per distinct QC op name. Mirrors
// the legacy fixed-order columns MIR/MCR/DIR/TPI + any other QC ops found.

export const qcMatrixQuerySchema = z.object({
  salesOrderId: z.string().uuid(),
});
export type QcMatrixQuery = z.infer<typeof qcMatrixQuerySchema>;

/** SO selector option (legacy L23042-23047). */
export interface QcMatrixSoOption {
  id: string;
  code: string;
  customerName: string | null;
}

/** A single matrix cell at (row JC, column QC-op). */
export interface QcMatrixCell {
  /** This JC actually has a QC op of this column's name. */
  applicable: boolean;
  /** The op's computed status is 'complete'. */
  done: boolean;
  /** QC accepted but not yet complete (legacy ⏳ Pending). */
  pending: boolean;
  /** Remaining qty to inspect when pending. */
  qcPending: number;
  /** QC accepted qty (shown under a pending cell). */
  accepted: number;
  /** A qc_documents row is registered for this op (matrix matched). */
  hasDoc: boolean;
  /** Upload date of the latest matched doc (ISO yyyy-mm-dd) or null. */
  docDate: string | null;
  /** Storage path of the latest matched doc (for download) or null. */
  storagePath: string | null;
  /** Original file name of the latest matched doc or null. */
  fileName: string | null;
  /** The jc_op id behind this cell (null when not applicable). */
  jcOpId: string | null;
}

/** One matrix row: a JC under an SO line (legacy L23075-23097). */
export interface QcMatrixRow {
  soLineId: string;
  lineNo: number;
  clientPoLineNo: string | null;
  itemCode: string | null;
  itemName: string | null;
  orderQty: number;
  jobCardId: string | null;
  jcCode: string | null;
  /** done / total QC ops on this JC. */
  done: number;
  total: number;
  /** 'no_qc' | 'complete' | 'partial' (legacy Overall column). */
  overall: 'no_qc' | 'complete' | 'partial' | 'no_jc';
  /** Cells keyed in the same order as `qcColumns`. */
  cells: QcMatrixCell[];
}

export interface QcMatrixResponse {
  so: {
    id: string;
    code: string;
    customerName: string | null;
  };
  /** Distinct QC-op column names (legacy fixed order MIR/MCR/DIR/TPI + extras). */
  qcColumns: string[];
  rows: QcMatrixRow[];
  /** SO summary bar (legacy L23112). */
  totalDone: number;
  totalTotal: number;
}

export interface ListQcMatrixSosResponse {
  sos: QcMatrixSoOption[];
}

// ─── Line-detail modal (legacy _qcDocLineDetail L23226) ─────────────────────

/** A QC inspection batch (op_log type='qc') with a derived serial range. */
export interface QcLineBatch {
  logId: string;
  logNo: string;
  date: string | null;
  opSeq: number;
  operation: string;
  accepted: number;
  rejected: number;
  /** Running serial range derived across batches (legacy L23274-23288). */
  srFrom: number;
  srTo: number;
}

/** One uploaded doc within a doc-type section (legacy L23324-23340). */
export interface QcLineDoc {
  id: string;
  docType: string;
  srFrom: number | null;
  srTo: number | null;
  fileName: string;
  storagePath: string;
  uploadedByText: string | null;
  createdAt: string;
}

/** A doc-type section in the modal (legacy L23295-23357). */
export interface QcLineDocSection {
  docType: string;
  fullName: string;
  /** From report_types.default_mandatory (true when no config = optional). */
  mandatory: boolean;
  docs: QcLineDoc[];
}

export interface QcLineDetailResponse {
  jobCardId: string;
  jcCode: string;
  itemCode: string | null;
  itemName: string | null;
  orderQty: number;
  /** Total accepted qty across QC batches (drives Sr range upper bound). */
  totalAccepted: number;
  batches: QcLineBatch[];
  sections: QcLineDocSection[];
}

export const qcLineDetailQuerySchema = z.object({
  jobCardId: z.string().uuid(),
});
export type QcLineDetailQuery = z.infer<typeof qcLineDetailQuerySchema>;
