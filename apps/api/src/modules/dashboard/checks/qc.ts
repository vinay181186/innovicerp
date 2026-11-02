// ADR-264 phase 2 — QC checks. Each reads the fragment its own screen reads:
//   qc_incoming    — personal/rows-qc.ts grnQcSql, narrowed to the GRN Types
//                    the Incoming QC screen lists (ADR-251, shared
//                    INCOMING_QC_GRN_TYPES: Direct Purchase 'purchase' + Party
//                    GRN 'party_grn'; job-work / NC returns are process calls on
//                    the QC Call Register) — one row per GRN. Replaces
//                    store_party_qc.
//   qc_inprocess   — the QC Call Register's pending op feed, qc-history/sql.ts
//                    pendingFrom + opStageWhere('inprocess') (not the card's
//                    last live op). Date = QC call date (age); late when the
//                    job card is past its Due Date.
//   qc_final       — the same feed, opStageWhere('final') (the last live op).
//   qc_tpi         — tpi/service.ts pendingFrom (QC op named TPI, qty waiting).
//                    A TPI op is also a QC op, so it can show under In-process
//                    / Final too — exactly as on the QC Call Register.
//   qc_nc_pending  — lib/nc-pending.ts ncPendingDispositionSql (AL-018's rule).
//   qc_capa        — personal/rows-qc.ts capaOpenSql (every open CAPA; "My
//                    CAPAs" is the same fragment narrowed to Responsible = me).
//   qc_reports     — personal/rows-qc.ts qcReportMissingSql (ADR-252).
//   qc_calibration — instruments/common.ts calibrationDueSql 'due' — the SAME
//                    window as AL-020 and the register's Due filter (due within
//                    CALIBRATION_LEAD_DAYS = 7 days, or past). Past due = late.

import { docNavPage, INCOMING_QC_GRN_TYPES } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { ncPendingDispositionSql } from '../../../lib/nc-pending';
import { CALIBRATION_LEAD_DAYS, calibrationDueSql } from '../../instruments/common';
import { PEND_IS_LAST, opStageWhere, pendingFrom } from '../../qc-history/sql';
import { pendingFrom as tpiPendingFrom } from '../../tpi/service';
import type { RawRow } from '../personal/list-query';
import { capaOpenSql, grnQcSql, qcReportMissingSql } from '../personal/rows-qc';
import { entityHref } from '../personal/util';
import { type CheckCtx, type CheckDef, narrow } from './types';

/** One pending QC op row over a pendingFrom feed (aliases vos / jo / jc / i /
 *  so). x1 = op id (the QC Call Register deep link), x2 = op seq,
 *  x3 = operation; kind = the SO number (reference of the Final / TPI checks). */
function qcOpRow(today: string, from: SQL, where: SQL = sql``): SQL {
  return sql`
    SELECT vos.jc_op_id::text AS row_key, jc.id, jc.code, so.code::text AS kind,
           jo.qc_call_date::text AS doc_date, jc.due_date::text AS due_date,
           COALESCE(jo.qc_call_date, jc.jc_date)::text AS sort_key,
           NULL::text AS party, i.code::text AS item_code, i.name::text AS item_name,
           vos.qc_pending::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           jo.created_by::text AS created_by,
           (CASE WHEN jc.due_date < ${today}::date THEN 1 ELSE 0 END)::int AS is_late,
           vos.jc_op_id::text AS x1, vos.op_seq::text AS x2, jo.operation::text AS x3
    ${from}
    ${where}`;
}

export const qcInprocessSql = (c: CheckCtx): SQL =>
  qcOpRow(c.today, pendingFrom(c.cid), opStageWhere('inprocess', PEND_IS_LAST));
export const qcFinalSql = (c: CheckCtx): SQL =>
  qcOpRow(c.today, pendingFrom(c.cid), opStageWhere('final', PEND_IS_LAST));
export const qcTpiSql = (c: CheckCtx): SQL => qcOpRow(c.today, tpiPendingFrom(c.cid));

export function ncPendingSql(c: CheckCtx): SQL {
  return sql`
    SELECT nc.id::text AS row_key, nc.id, nc.code, 'nc'::text AS kind,
           nc.nc_date::text AS doc_date, NULL::text AS due_date, nc.nc_date::text AS sort_key,
           NULL::text AS party,
           COALESCE(i.code, nc.item_code_text)::text AS item_code,
           COALESCE(i.name, nc.item_name_text)::text AS item_name,
           nc.rejected_qty::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           nc.created_by::text AS created_by, 0::int AS is_late,
           jc.id::text AS x1, jc.code::text AS x2, NULL::text AS x3
    FROM public.nc_register nc
    LEFT JOIN public.items i ON i.id = nc.item_id
    LEFT JOIN public.job_cards jc ON jc.id = nc.job_card_id
    WHERE nc.company_id = ${c.cid}::uuid AND nc.deleted_at IS NULL
      AND ${ncPendingDispositionSql('nc')}`;
}

export function calibrationDueCheckSql(c: CheckCtx): SQL {
  return sql`
    SELECT ins.id::text AS row_key, ins.id, ins.serial_no::text AS code, ins.status::text AS kind,
           ins.last_calibrated_on::text AS doc_date, ins.calibration_due_on::text AS due_date,
           ins.calibration_due_on::text AS sort_key,
           NULLIF(btrim(ins.location), '')::text AS party,
           i.code::text AS item_code, i.name::text AS item_name,
           NULL::numeric AS qty, NULL::text AS uom, NULL::numeric AS amount,
           ins.created_by::text AS created_by,
           (CASE WHEN ins.calibration_due_on < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULL::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.instruments ins
    JOIN public.items i ON i.id = ins.item_id
    WHERE ins.company_id = ${c.cid}::uuid AND ins.deleted_at IS NULL
      AND ${calibrationDueSql(sql`${c.today}::date`)}`;
}

const jcHref = (r: RawRow): string => docNavPage('job-card', r.id);
const qcCallHref = (r: RawRow): string => (r.x1 ? docNavPage('qc-call', r.x1) : jcHref(r));
const capaHref = (r: RawRow): string => `/nc-register?tab=capa&capa=${encodeURIComponent(r.code)}`;

export const QC_CHECKS: readonly CheckDef[] = [
  {
    key: 'qc_incoming',
    dept: 'qc',
    label: 'Incoming QC pending (Direct Purchase + Party GRN)',
    head: ['GRN No.', 'Vendor / Customer', 'GRN Date'],
    href: '/incoming-qc',
    query: (c) =>
      narrow(
        grnQcSql(c.cid, {}),
        sql`x.kind = ANY(${sql.param([...INCOMING_QC_GRN_TYPES])}::text[])`,
      ),
    docHref: (r) =>
      r.kind === 'party_grn'
        ? (entityHref('PartyGrn', r.id, r.code) ?? '/party-grn')
        : docNavPage('grn', r.id),
    dated: false,
  },
  {
    key: 'qc_inprocess',
    dept: 'qc',
    label: 'In-process QC calls pending',
    head: ['JC No.', 'Operation', 'Called On'],
    href: '/qc-call-register',
    query: qcInprocessSql,
    docHref: qcCallHref,
    refCode: (r) => r.x3,
    dated: false,
  },
  {
    key: 'qc_final',
    dept: 'qc',
    label: 'Final Inspection pending',
    head: ['JC No.', 'SO No.', 'Due Date'],
    href: '/qc-call-register',
    query: qcFinalSql,
    docHref: qcCallHref,
    refCode: (r) => r.kind,
    dated: true,
  },
  {
    key: 'qc_tpi',
    dept: 'qc',
    label: 'TPI pending',
    head: ['JC No.', 'SO No.', 'Due Date'],
    href: '/qc-call-register?tab=tpi',
    query: qcTpiSql,
    docHref: qcCallHref,
    refCode: (r) => r.kind,
    dated: true,
  },
  {
    key: 'qc_nc_pending',
    dept: 'qc',
    label: 'NC waiting disposition',
    head: ['NC No.', 'JC No.', 'NC Date'],
    href: '/nc-register',
    query: ncPendingSql,
    docHref: (r) => docNavPage('nc', r.id),
    // The job card the pieces were rejected on (the item is its own column).
    refCode: (r) => r.x2,
    refHref: (r) => (r.x1 ? docNavPage('job-card', r.x1) : null),
    dated: false,
  },
  {
    key: 'qc_capa',
    dept: 'qc',
    label: 'CAPA overdue / open',
    head: ['CAPA No.', 'Responsible', 'Target Date'],
    href: '/nc-register?tab=capa',
    query: (c) => capaOpenSql(c.cid, c.today, {}),
    docHref: capaHref,
    refCode: (r) => r.x3,
    dated: true,
    noQty: true,
  },
  {
    key: 'qc_reports',
    dept: 'qc',
    label: 'QC reports to upload',
    head: ['JC No.', 'Report', 'QC Date'],
    href: '/qc-docs?view=dossier',
    // party = the report's name (qcReportMissingSql).
    query: (c) => qcReportMissingSql(c.cid, {}),
    docHref: jcHref,
    dated: false,
  },
  {
    key: 'qc_calibration',
    dept: 'qc',
    label: `Instrument calibration due (next ${CALIBRATION_LEAD_DAYS} days)`,
    head: ['Instrument', 'Location', 'Due On'],
    href: '/instruments',
    query: calibrationDueCheckSql,
    docHref: (r) => `/instruments?search=${encodeURIComponent(r.code)}`,
    dated: true,
    noQty: true,
  },
];
