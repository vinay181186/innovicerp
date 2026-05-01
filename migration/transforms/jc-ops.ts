// jc-ops transform — legacy `jcOps` to Postgres `jc_ops`.
//
// Field mapping:
//   id              → _legacyId, uuidv5 → id
//   jcNo            → resolved via ctx.lookups.byCode.job_cards → job_card_id (REQUIRED)
//   opSeq           → op_seq
//   machineId       → resolved via ctx.lookups.byCode.machines → machine_id
//                     (null + machine_code_text fallback if 'QC' or unresolved)
//   operation       → operation
//   cycleTime       → cycle_time_min
//   program/toolNo/ → program/tool_no/tool_details (null if empty)
//   toolDetails
//   opType          → op_type ('process' | 'QC' → 'qc' | 'outsource')
//   qcRequired      → qc_required
//   qcCallDate      → qc_call_date (null if empty)
//   qcAttendedDate  → qc_attended_date
//   reworkQty       → rework_qty
//   outsourceVendor → resolved via ctx.lookups.byCode.vendors → outsource_vendor_id
//                     (null + outsource_vendor_text fallback if unresolved)
//   outsourceCost   → outsource_cost
//   outsourceStatus → outsource_status (lowercased + normalised: 'PR Raised' →
//                     'pr_raised', 'PO Created' → 'po_created', etc.; only set
//                     when op_type is 'outsource')
//   outsourcePRNo,  → outsource_pr_no, outsource_po_no, outsource_dc_no
//   outsourcePONo,
//   outsourceDCNo
//   sentQty/Date    → outsource_sent_qty/date
//   returnedQty     → outsource_returned_qty
//   qcAccepted      → DROP (denormalised counter; computed from op_log per ADR-011)
//
// Anomalies:
//   - jcNo missing or unresolved → skip
//   - opSeq missing or non-numeric → skip
//   - operation missing → skip

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyJcOp {
  id: string;
  jcNo?: string;
  opSeq?: number;
  machineId?: string;
  operation?: string;
  cycleTime?: number;
  program?: string;
  toolNo?: string;
  toolDetails?: string;
  opType?: string;
  qcRequired?: boolean;
  outsourceVendor?: string;
  outsourceCost?: number;
  outsourceStatus?: string;
  outsourcePONo?: string;
  outsourceDCNo?: string;
  outsourcePRNo?: string;
  sentQty?: number;
  sentDate?: string;
  returnedQty?: number;
  reworkQty?: number;
  qcCallDate?: string;
  qcAttendedDate?: string;
  qcAccepted?: number;
}

export interface TransformedJcOp {
  _legacyId: string;
  _legacyJcNo: string;
  id: string;
  jobCardId: string;
  opSeq: number;
  machineId: string | null;
  machineCodeText: string | null;
  operation: string;
  opType: 'process' | 'qc' | 'outsource';
  cycleTimeMin: string;
  program: string | null;
  toolNo: string | null;
  toolDetails: string | null;
  qcRequired: boolean;
  qcCallDate: string | null;
  qcAttendedDate: string | null;
  reworkQty: number;
  outsourceVendorId: string | null;
  outsourceVendorText: string | null;
  outsourceCost: string;
  outsourceStatus: 'pending' | 'pr_raised' | 'po_created' | 'sent' | 'received' | null;
  outsourcePrNo: string | null;
  outsourcePoNo: string | null;
  outsourceDcNo: string | null;
  outsourceSentQty: number;
  outsourceSentDate: string | null;
  outsourceReturnedQty: number;
  _legacyExtras: Record<string, unknown>;
}

export function legacyJcOpIdToUuid(legacyId: string): string {
  return uuidv5(`jc_ops/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseOpType(raw: string | undefined): 'process' | 'qc' | 'outsource' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'qc') return 'qc';
  if (v === 'outsource') return 'outsource';
  return 'process';
}

function normaliseOutsourceStatus(
  raw: string | undefined,
): 'pending' | 'pr_raised' | 'po_created' | 'sent' | 'received' | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'pending') return 'pending';
  if (v === 'pr raised' || v === 'pr_raised') return 'pr_raised';
  if (v === 'po created' || v === 'po_created') return 'po_created';
  if (v === 'sent') return 'sent';
  if (v === 'received') return 'received';
  return null;
}

export function transformJcOps(
  records: LegacyJcOp[],
  ctx: TransformContext,
): TransformResult<TransformedJcOp> {
  const rows: TransformedJcOp[] = [];
  const anomalies: Anomaly[] = [];

  const jobCardsByCode = ctx.lookups.byCode['job_cards'];
  const machinesByCode = ctx.lookups.byCode['machines'];
  const vendorsByCode = ctx.lookups.byCode['vendors'];

  for (const r of records) {
    if (!r.jcNo) {
      anomalies.push({ legacyId: r.id, type: 'jcNo_missing' });
      continue;
    }
    const jcNo = r.jcNo.trim();
    const jobCardId = jobCardsByCode?.get(jcNo);
    if (!jobCardId) {
      anomalies.push({ legacyId: r.id, type: 'jcNo_unresolved', details: { jcNo } });
      continue;
    }

    if (typeof r.opSeq !== 'number' || r.opSeq <= 0) {
      anomalies.push({
        legacyId: r.id,
        type: 'opSeq_invalid',
        details: { jcNo, opSeq: r.opSeq },
      });
      continue;
    }
    if (!r.operation || r.operation.trim().length === 0) {
      anomalies.push({
        legacyId: r.id,
        type: 'operation_missing',
        details: { jcNo, opSeq: r.opSeq },
      });
      continue;
    }

    const machineCodeRaw = r.machineId?.trim() ?? '';
    const machineId = machineCodeRaw && machineCodeRaw !== 'QC'
      ? machinesByCode?.get(machineCodeRaw) ?? null
      : null;
    const machineCodeText = machineCodeRaw && !machineId ? machineCodeRaw : null;

    const opType = normaliseOpType(r.opType);

    const vendorCodeRaw = r.outsourceVendor?.trim() ?? '';
    const vendorId = vendorCodeRaw ? vendorsByCode?.get(vendorCodeRaw) ?? null : null;
    const vendorText = vendorCodeRaw && !vendorId ? vendorCodeRaw : null;

    const outsourceStatus = opType === 'outsource'
      ? normaliseOutsourceStatus(r.outsourceStatus) ?? 'pending'
      : null;

    const extras: Record<string, unknown> = {};
    if (typeof r.qcAccepted === 'number') extras['qcAccepted_legacy'] = r.qcAccepted;

    rows.push({
      _legacyId: r.id,
      _legacyJcNo: jcNo,
      id: legacyJcOpIdToUuid(r.id),
      jobCardId,
      opSeq: r.opSeq,
      machineId,
      machineCodeText,
      operation: r.operation.trim(),
      opType,
      cycleTimeMin: typeof r.cycleTime === 'number' ? r.cycleTime.toFixed(2) : '0.00',
      program: emptyToNull(r.program),
      toolNo: emptyToNull(r.toolNo),
      toolDetails: emptyToNull(r.toolDetails),
      qcRequired: r.qcRequired === true,
      qcCallDate: emptyToNull(r.qcCallDate),
      qcAttendedDate: emptyToNull(r.qcAttendedDate),
      reworkQty: typeof r.reworkQty === 'number' && r.reworkQty >= 0 ? r.reworkQty : 0,
      outsourceVendorId: vendorId,
      outsourceVendorText: vendorText,
      outsourceCost: typeof r.outsourceCost === 'number' ? r.outsourceCost.toFixed(2) : '0.00',
      outsourceStatus,
      outsourcePrNo: emptyToNull(r.outsourcePRNo),
      outsourcePoNo: emptyToNull(r.outsourcePONo),
      outsourceDcNo: emptyToNull(r.outsourceDCNo),
      outsourceSentQty: typeof r.sentQty === 'number' && r.sentQty >= 0 ? r.sentQty : 0,
      outsourceSentDate: emptyToNull(r.sentDate),
      outsourceReturnedQty:
        typeof r.returnedQty === 'number' && r.returnedQty >= 0 ? r.returnedQty : 0,
      _legacyExtras: extras,
    });
  }

  return {
    table: 'jc_ops',
    sourceCollection: 'jcOps',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
