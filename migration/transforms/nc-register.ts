// nc-register transform — legacy `ncRegister` to Postgres `nc_register`.
// Per ADR-017 (T-039). 3 source records (NC-0001/0002/0003).
//
// Field mapping:
//   id                  → _legacyId, uuidv5 → id
//   ncNo                → code (business unique key per company)
//   date                → nc_date
//   jcNo                → job_card_id via byCode.job_cards (REQUIRED — NC must
//                         link to a JC; legacy "manual" entries always pick a JC)
//   jcNo + opSeq        → jc_op_id via byCompositeKey.jc_ops (NULLABLE — legacy
//                         lets opSeq=0 slip through when reporter skips picking)
//   opSeq               → op_seq (snapshot)
//   operation           → operation_text
//   qcOperation         → qc_operation_text
//   itemCode            → item_id via byCode.items (REQUIRED) + item_code_text
//   itemName            → item_name_text
//   soNo                → so_code_text (denormalised — no FK; ADR-017 #4)
//   machineId           → machine_code_text (legacy 'QC' is not a real machine)
//   rejectedQty         → rejected_qty
//   reasonCategory      → reason_category enum (lowercased + space→underscore)
//   reason              → reason
//   disposition         → disposition enum (NULLABLE) — same normalisation
//   dispositionDate     → disposition_date
//   dispositionBy       → disposition_by_text
//   dispositionRemarks  → disposition_remarks
//   reworkJcNo          → rework_jc_code_text
//   reworkOpSeq         → rework_op_seq (numeric coerce; '' or non-int → null)
//   reworkDoneQty       → rework_done_qty
//   scrapCost           → scrap_cost
//   status              → status enum (lowercased + 'Rework Complete' mapped
//                         to 'rework_done' to match legacy intermediate state
//                         per legacy/InnovicERP code line 22555)
//   reportedBy          → reported_by_text
//   timeLogged          → time_logged (ISO timestamp)
//
// Anomalies:
//   - jcNo missing → skip
//   - jcNo unresolved (no matching job_cards row) → skip + capture
//   - itemCode missing or unresolved → skip + capture (item is REQUIRED)
//   - reason_category not in enum → defaulted to 'other' with anomaly
//   - status not in enum → defaulted to 'pending' with anomaly
//   - disposition not in enum → null + anomaly (Pending NCs have empty
//                                 disposition; that's not an anomaly)
//   - rejectedQty missing or non-positive → skip + capture (CHECK enforces > 0)

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyNc {
  id: string;
  ncNo?: string;
  date?: string;
  jcNo?: string;
  opSeq?: number | string;
  operation?: string;
  qcOperation?: string;
  itemCode?: string;
  itemName?: string;
  soNo?: string;
  machineId?: string;
  rejectedQty?: number;
  reasonCategory?: string;
  reason?: string;
  disposition?: string;
  dispositionDate?: string;
  dispositionBy?: string;
  dispositionRemarks?: string;
  reworkJcNo?: string;
  reworkOpSeq?: number | string;
  reworkDoneQty?: number;
  scrapCost?: number;
  status?: string;
  reportedBy?: string;
  operator?: string;
  timeLogged?: string;
}

export interface TransformedNc {
  _legacyId: string;
  id: string;
  code: string;
  ncDate: string;
  jobCardId: string;
  jcOpId: string | null;
  opSeq: number | null;
  operationText: string | null;
  qcOperationText: string | null;
  itemId: string;
  itemCodeText: string;
  itemNameText: string | null;
  soCodeText: string | null;
  machineCodeText: string | null;
  rejectedQty: string;
  reasonCategory:
    | 'dimensional'
    | 'surface'
    | 'material'
    | 'process'
    | 'operator_error'
    | 'machine_fault'
    | 'other';
  reason: string | null;
  disposition: 'rework' | 'scrap' | 'use_as_is' | 'return_to_vendor' | 'make_fresh' | null;
  dispositionDate: string | null;
  dispositionByText: string | null;
  dispositionRemarks: string | null;
  reworkJcCodeText: string | null;
  reworkOpSeq: number | null;
  reworkDoneQty: string | null;
  scrapCost: string;
  status: 'pending' | 'disposed' | 'rework_done' | 'closed';
  reportedByText: string | null;
  timeLogged: string | null;
}

export function legacyNcIdToUuid(legacyId: string): string {
  return uuidv5(`nc_register/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined || s === null) return null;
  const trimmed = String(s).trim();
  return trimmed.length === 0 ? null : trimmed;
}

function coerceInt(v: number | string | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

const REASON_MAP: Record<string, TransformedNc['reasonCategory']> = {
  dimensional: 'dimensional',
  surface: 'surface',
  material: 'material',
  process: 'process',
  'operator error': 'operator_error',
  operator_error: 'operator_error',
  'machine fault': 'machine_fault',
  machine_fault: 'machine_fault',
  other: 'other',
};

function normaliseReason(raw: string | undefined): {
  value: TransformedNc['reasonCategory'];
  unrecognised?: string;
} {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { value: 'other' };
  const mapped = REASON_MAP[trimmed.toLowerCase()];
  if (mapped) return { value: mapped };
  return { value: 'other', unrecognised: trimmed };
}

const DISPOSITION_MAP: Record<string, TransformedNc['disposition']> = {
  rework: 'rework',
  scrap: 'scrap',
  'use as is': 'use_as_is',
  use_as_is: 'use_as_is',
  'return to vendor': 'return_to_vendor',
  return_to_vendor: 'return_to_vendor',
  'make fresh': 'make_fresh',
  make_fresh: 'make_fresh',
};

function normaliseDisposition(raw: string | undefined): {
  value: TransformedNc['disposition'];
  unrecognised?: string;
} {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { value: null };
  const mapped = DISPOSITION_MAP[trimmed.toLowerCase()];
  if (mapped) return { value: mapped };
  return { value: null, unrecognised: trimmed };
}

function normaliseStatus(raw: string | undefined): {
  value: TransformedNc['status'];
  unrecognised?: string;
} {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (trimmed === 'pending' || trimmed === '') return { value: 'pending' };
  if (trimmed === 'disposed') return { value: 'disposed' };
  // Legacy uses both 'Rework Complete' (filter dropdown line 22555) and
  // 'Rework Done' (action button line 22541) — both map to rework_done.
  if (trimmed === 'rework done' || trimmed === 'rework complete') {
    return { value: 'rework_done' };
  }
  if (trimmed === 'closed') return { value: 'closed' };
  return raw === undefined ? { value: 'pending' } : { value: 'pending', unrecognised: raw };
}

function normaliseTimeLogged(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function transformNcRegister(
  records: LegacyNc[],
  ctx: TransformContext,
): TransformResult<TransformedNc> {
  const rows: TransformedNc[] = [];
  const anomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];
  const jobCardsByCode = ctx.lookups.byCode['job_cards'];
  const jcOpsByKey = ctx.lookups.byCompositeKey['jc_ops'];

  for (const r of records) {
    if (!r.ncNo) {
      anomalies.push({ legacyId: r.id, type: 'ncNo_missing' });
      continue;
    }
    const code = r.ncNo.trim();
    if (!code) {
      anomalies.push({ legacyId: r.id, type: 'ncNo_blank' });
      continue;
    }
    if (!r.date) {
      anomalies.push({ legacyId: r.id, type: 'date_missing', details: { ncNo: code } });
      continue;
    }

    if (!r.jcNo) {
      anomalies.push({ legacyId: r.id, type: 'jcNo_missing', details: { ncNo: code } });
      continue;
    }
    const jcNo = r.jcNo.trim();
    const jobCardId = jobCardsByCode?.get(jcNo);
    if (!jobCardId) {
      anomalies.push({
        legacyId: r.id,
        type: 'jc_unresolved',
        details: { ncNo: code, jcNo },
      });
      continue;
    }

    const opSeq = coerceInt(r.opSeq);
    const jcOpId = opSeq !== null ? (jcOpsByKey?.get(`${jcNo}::${opSeq}`) ?? null) : null;
    if (opSeq !== null && !jcOpId) {
      anomalies.push({
        legacyId: r.id,
        type: 'jc_op_unresolved',
        details: { ncNo: code, jcNo, opSeq },
      });
    }

    if (!r.itemCode) {
      anomalies.push({ legacyId: r.id, type: 'itemCode_missing', details: { ncNo: code } });
      continue;
    }
    const itemCode = r.itemCode.trim();
    const itemId = itemsByCode?.get(itemCode);
    if (!itemId) {
      anomalies.push({
        legacyId: r.id,
        type: 'item_unresolved',
        details: { ncNo: code, itemCode },
      });
      continue;
    }

    if (
      typeof r.rejectedQty !== 'number' ||
      !Number.isFinite(r.rejectedQty) ||
      r.rejectedQty <= 0
    ) {
      anomalies.push({
        legacyId: r.id,
        type: 'rejectedQty_invalid',
        details: { ncNo: code, rejectedQty: r.rejectedQty },
      });
      continue;
    }

    const { value: reasonCategory, unrecognised: reasonUnrecognised } = normaliseReason(
      r.reasonCategory,
    );
    if (reasonUnrecognised) {
      anomalies.push({
        legacyId: r.id,
        type: 'reasonCategory_unrecognised',
        details: { ncNo: code, from: reasonUnrecognised, defaultedTo: reasonCategory },
      });
    }

    const { value: disposition, unrecognised: dispositionUnrecognised } = normaliseDisposition(
      r.disposition,
    );
    if (dispositionUnrecognised) {
      anomalies.push({
        legacyId: r.id,
        type: 'disposition_unrecognised',
        details: { ncNo: code, from: dispositionUnrecognised },
      });
    }

    const { value: status, unrecognised: statusUnrecognised } = normaliseStatus(r.status);
    if (statusUnrecognised) {
      anomalies.push({
        legacyId: r.id,
        type: 'status_unrecognised',
        details: { ncNo: code, from: statusUnrecognised, defaultedTo: status },
      });
    }

    const reworkOpSeq = coerceInt(r.reworkOpSeq);
    const reworkDoneQtyRaw =
      typeof r.reworkDoneQty === 'number' &&
      Number.isFinite(r.reworkDoneQty) &&
      r.reworkDoneQty >= 0
        ? r.reworkDoneQty
        : null;
    const scrapCostRaw =
      typeof r.scrapCost === 'number' && Number.isFinite(r.scrapCost) && r.scrapCost >= 0
        ? r.scrapCost
        : 0;

    rows.push({
      _legacyId: r.id,
      id: legacyNcIdToUuid(r.id),
      code,
      ncDate: r.date,
      jobCardId,
      jcOpId,
      opSeq,
      operationText: emptyToNull(r.operation),
      qcOperationText: emptyToNull(r.qcOperation),
      itemId,
      itemCodeText: itemCode,
      itemNameText: emptyToNull(r.itemName),
      soCodeText: emptyToNull(r.soNo),
      machineCodeText: emptyToNull(r.machineId),
      rejectedQty: r.rejectedQty.toFixed(2),
      reasonCategory,
      reason: emptyToNull(r.reason),
      disposition,
      dispositionDate: emptyToNull(r.dispositionDate),
      dispositionByText: emptyToNull(r.dispositionBy),
      dispositionRemarks: emptyToNull(r.dispositionRemarks),
      reworkJcCodeText: emptyToNull(r.reworkJcNo),
      reworkOpSeq,
      reworkDoneQty: reworkDoneQtyRaw === null ? null : reworkDoneQtyRaw.toFixed(2),
      scrapCost: scrapCostRaw.toFixed(2),
      status,
      reportedByText: emptyToNull(r.reportedBy ?? r.operator),
      timeLogged: normaliseTimeLogged(r.timeLogged),
    });
  }

  return {
    table: 'nc_register',
    sourceCollection: 'ncRegister',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
