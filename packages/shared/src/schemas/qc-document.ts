// QC Documents schemas (QC Wave 5). Mirrors legacy renderQCDocuments L23039.
// Files live in the `qc-docs` Supabase Storage bucket (client uploads direct);
// this registers the metadata. Backed by qc_documents (migration 0039).

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

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
  /** WHAT is being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemCode: z.string().nullable().default(null),
  /** The customer's drawing revision behind that card, read live off the SO line
   *  it was raised against (job_cards.source_so_line_id ->
   *  sales_order_lines.revision) and rendered beside the code as `CODE/REV`.
   *  Never items.revision, which describes the item master and would misname the
   *  drawing being worked to. Null on a JW-sourced or standalone card, which
   *  then shows the bare code. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to, shown beside the item code on every downstream document (user rule,
   *  2026-09-23). Null when no SO line sits behind the row. Read-only — the
   *  Sales Order is the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string().nullable().default(null),
  salesOrderId: z.string().uuid().nullable(),
  soCodeText: z.string().nullable(),
  /** ADR-207: the SO's Internal SO No., read live off sales_orders
   *  (salesOrderId); null when the document has no SO or the SO has none. */
  soInternalNo: z.string().nullable().default(null),
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
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  /** Paging (ADR-201). No limit = every matching row (as before). */
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListQcDocumentsQuery = z.infer<typeof listQcDocumentsQuerySchema>;

export interface ListQcDocumentsResponse {
  items: QcDocument[];
  /** Every document matching the search + filters (all pages). */
  total: number;
}

export const createQcDocumentInputSchema = z
  .object({
    jobCardId: z.string().uuid().optional(),
    jcCodeText: z.string().max(64).optional(),
    salesOrderId: z.string().uuid().optional(),
    soCodeText: z.string().max(64).optional(),
    category: qcDocCategorySchema.default('qc-docs'),
    /** Free-text type for the File Register path. With reportTypeId the server
     *  writes the Report Type's own name here instead. */
    docType: z.string().min(1).max(80).optional(),
    fileName: z.string().min(1).max(255),
    storagePath: z.string().min(1).max(512),
    /** ADR-252 — the QC entry (op_log, log_type 'qc') this report belongs to.
     *  The server derives the JC, JC op, SO / JWSO line and report type from
     *  it; values sent for those are ignored. */
    opLogId: z.string().uuid().optional(),
    /** ADR-252 — the Report Type (folder). Required unless opLogId names one. */
    reportTypeId: z.string().uuid().optional(),
    /** ADR-252 — the order line (POL folder) for a report with no QC entry,
     *  e.g. a customer certificate. Exactly one of the two, or neither when a
     *  jobCardId is sent (the server takes the card's line). */
    soLineId: z.string().uuid().optional(),
    jwLineId: z.string().uuid().optional(),
  })
  .refine((i) => i.docType || i.reportTypeId || i.opLogId, {
    message: 'Pick the report type',
  })
  .refine((i) => !(i.soLineId && i.jwLineId), {
    message: 'A report belongs to one order line',
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
  /** ADR-207: Internal SO No. (null on older SOs). */
  internalSoNo?: string | null;
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
  /** The customer's drawing revision typed on this very SO line
   *  (sales_order_lines.revision). This matrix is built from the SO line
   *  outwards, so the value is one column away rather than three joins away.
   *  Null only where the column is genuinely empty, and null renders as the
   *  bare item code. Never items.revision, which describes the item master and
   *  would point whoever files these reports at the wrong drawing. */
  itemRevision: string | null;
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
    /** ADR-207: Internal SO No. (null on older SOs). */
    internalSoNo?: string | null;
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

// Line-detail modal (pieces from–to) removed by ADR-252: a report belongs to
// its QC entry; the Dossier shows each entry's accepted qty and date.

// ─── ADR-252 QC Dossier: SO / JWSO → POL → report folders → QC entries ─────
// ONE read over every place a QC report is kept: the QC entry itself
// (op_log.qc_report_path, Op Entry / TPI / QC Call Register), QC Documents
// uploads (qc_documents), the Job Card form's QC files (file_registry
// 'qc-docs'). Folders are labels on each file, never storage paths.

export const QC_DOSSIER_ORDER_KINDS = ['so', 'jwso'] as const;
export const qcDossierOrderKindSchema = z.enum(QC_DOSSIER_ORDER_KINDS);
export type QcDossierOrderKind = (typeof QC_DOSSIER_ORDER_KINDS)[number];

/** GET /qc-documents/dossier/orders — the order picker (server search). */
export const qcDossierOrdersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type QcDossierOrdersQuery = z.infer<typeof qcDossierOrdersQuerySchema>;

export interface QcDossierOrderOption {
  kind: QcDossierOrderKind;
  id: string;
  /** IN-SO-##### or IN-JW-#####. */
  code: string;
  /** ADR-207: Internal SO No. (SO only; null otherwise). */
  internalSoNo: string | null;
  customerName: string | null;
}
export interface QcDossierOrdersResponse {
  orders: QcDossierOrderOption[];
}

/** GET /qc-documents/dossier?kind=&orderId= */
export const qcDossierQuerySchema = z.object({
  kind: qcDossierOrderKindSchema,
  orderId: z.string().uuid(),
});
export type QcDossierQuery = z.infer<typeof qcDossierQuerySchema>;

export const QC_DOSSIER_FILE_SOURCES = ['qc_entry', 'qc_document', 'job_card'] as const;
export type QcDossierFileSource = (typeof QC_DOSSIER_FILE_SOURCES)[number];

export interface QcDossierFile {
  /** Unique in the response: '<source>:<row id>'. */
  key: string;
  source: QcDossierFileSource;
  /** qc_documents.id — only these can be deleted from the Dossier. */
  qcDocumentId: string | null;
  fileName: string;
  storagePath: string;
  /** Uploader's full name (users.full_name), else the stored email/text. */
  uploadedByName: string | null;
  /** ISO timestamp. */
  uploadedAt: string;
  jcCode: string | null;
  /** Newest file of its QC entry (older ones are earlier revisions, D4). */
  current: boolean;
}

export const QC_ENTRY_REPORT_STATES = ['report_in', 'report_missing'] as const;
export type QcEntryReportState = (typeof QC_ENTRY_REPORT_STATES)[number];

/** One QC entry (op_log, log_type 'qc', accepted qty > 0) on a QC step. */
export interface QcDossierEntry {
  opLogId: string;
  logNo: string;
  jobCardId: string;
  jcCode: string;
  /** YYYY-MM-DD. */
  inspectedOn: string | null;
  acceptedQty: number;
  rejectedQty: number;
  /** op_log.report_required as stamped at Submit QC; null = saved before
   *  ADR-252 (shown red here, never on the dashboard — D8). */
  reportRequired: boolean | null;
  state: QcEntryReportState;
  /** Newest first. */
  files: QcDossierFile[];
}

export const QC_FOLDER_STATES = ['qc_not_done', 'report_missing', 'report_in', 'no_step'] as const;
export type QcFolderState = (typeof QC_FOLDER_STATES)[number];

export interface QcDossierFolder {
  /** report_types.id; null for the Other folder. */
  reportTypeId: string | null;
  reportName: string;
  mandatory: boolean;
  /** A QC step on this line's job cards produces this report. */
  isStep: boolean;
  /** no_step = a folder holding only extra files (no QC step behind it). */
  state: QcFolderState;
  entries: QcDossierEntry[];
  /** Files in this folder not tied to a QC entry (customer certificates…). */
  files: QcDossierFile[];
}

export const QC_LINE_STATES = [
  'no_jc',
  'no_qc_steps',
  'qc_pending',
  'report_missing',
  'complete',
] as const;
export type QcLineState = (typeof QC_LINE_STATES)[number];

export interface QcDossierLine {
  /** sales_order_lines.id or job_work_order_lines.id. */
  lineId: string;
  lineNo: number;
  clientPoLineNo: string | null;
  itemCode: string | null;
  itemRevision: string | null;
  itemName: string | null;
  orderQty: number;
  /** Every live job card on this line, rework / repair children included. */
  jobCards: Array<{ id: string; code: string }>;
  /** no_jc → no_qc_steps → report_missing → qc_pending → complete (D2). */
  state: QcLineState;
  /** QC entries with accepted qty and no report. */
  missingCount: number;
  fileCount: number;
  /** Folders: QC-step reports in route order, then extra-file folders. */
  folders: QcDossierFolder[];
}

export interface QcDossierResponse {
  order: {
    kind: QcDossierOrderKind;
    id: string;
    code: string;
    internalSoNo: string | null;
    customerName: string | null;
    clientPoNo: string | null;
  };
  lines: QcDossierLine[];
  totals: {
    complete: number;
    reportMissing: number;
    qcPending: number;
    noQc: number;
    missingReports: number;
    files: number;
  };
  /** Files on this order that trace to no line (old rows, SO-only uploads). */
  unlinked: QcDossierFile[];
}

/** POST /qc-documents/dossier/urls — signed links for a ZIP / bulk download.
 *  Every path must belong to a file of this order; each open is logged. */
export const qcDossierUrlsInputSchema = z.object({
  kind: qcDossierOrderKindSchema,
  orderId: z.string().uuid(),
  storagePaths: z.array(z.string().min(1).max(512)).min(1).max(300),
});
export type QcDossierUrlsInput = z.infer<typeof qcDossierUrlsInputSchema>;
export interface QcDossierUrlsResponse {
  urls: Array<{ storagePath: string; url: string }>;
}
