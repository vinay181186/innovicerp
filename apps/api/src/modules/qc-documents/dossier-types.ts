// ADR-252 — QC Dossier: the row shapes dossier-sql.ts reads and
// dossier-build.ts turns into the Dossier.

import type { QcDossierFileSource } from '@innovic/shared';

export interface DossierLineRow {
  lineId: string;
  lineNo: number;
  clientPoLineNo: string | null;
  itemCode: string | null;
  itemRevision: string | null;
  itemName: string | null;
  orderQty: number;
}
export interface DossierJcRow {
  id: string;
  code: string;
  lineId: string;
}
/** One QC op (jc_ops op_type 'qc') on a line's job card. */
export interface DossierStepRow {
  jcOpId: string;
  jobCardId: string;
  opSeq: number;
  operation: string;
  reportTypeId: string | null;
  reportName: string | null;
  mandatory: boolean;
  /** The QC op is complete (v_jc_op_status) — nothing left to inspect. A line
   *  is never 'complete' while a step still has pieces to inspect. */
  opDone: boolean;
}
/** One live QC entry (op_log log_type 'qc', not reversed). */
export interface DossierEntryRow {
  id: string;
  logNo: string;
  jcOpId: string;
  logDate: string | null;
  qty: number;
  rejectQty: number;
  reportRequired: boolean | null;
  qcReportPath: string | null;
  qcReportName: string | null;
  createdAt: string;
  createdByName: string | null;
}
/** A registered file: qc_documents ('qc_document') or file_registry 'qc-docs'
 *  on a job card ('job_card'). */
export interface DossierDocRow {
  source: Exclude<QcDossierFileSource, 'qc_entry'>;
  id: string;
  opLogId: string | null;
  jcOpId: string | null;
  jobCardId: string | null;
  jcCodeText: string | null;
  lineId: string | null;
  reportTypeId: string | null;
  qcOpName: string | null;
  docType: string | null;
  fileName: string;
  storagePath: string;
  uploadedByName: string | null;
  createdAt: string;
}
export interface DossierReportTypeRow {
  id: string;
  name: string;
  mandatory: boolean;
}
export interface DossierRaw {
  lines: DossierLineRow[];
  jobCards: DossierJcRow[];
  steps: DossierStepRow[];
  entries: DossierEntryRow[];
  docs: DossierDocRow[];
  reportTypes: DossierReportTypeRow[];
}
