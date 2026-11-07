// Sort & Filter (ADR-200) — the QC Call Register's two tables.
//
// The register pages a UNION of three kinds of call (job-card op, GRN line,
// Party GRN line), so a column cannot be one table expression: every union
// part SELECTs one extra column per field (alias below, same SQL type in every
// part), and the outer query filters / sorts on `k.<alias>`. Each part's value
// is the SAME thing that kind's cell shows (qc-call-pending-columns.tsx /
// qc-call-completed-columns.tsx); a kind with no value for a column reads NULL,
// as its cell reads "—". The field names are the shared lists
// (QC_REGISTER_PENDING_SF_FIELDS / QC_REGISTER_COMPLETED_SF_FIELDS), so the web's
// `sortFilterField` and this map cannot drift.
//
// ADR-285: Operation = the stored operation name on a job-card call, the GRN Type
// label on a GRN or Party GRN line (QC_GRN_TYPE_LABELS), on both tables.

import { type SQL, sql } from 'drizzle-orm';
import { QC_REGISTER_COMPLETED_SF_FIELDS, QC_REGISTER_PENDING_SF_FIELDS } from '@innovic/shared';
import { createdByNameSql } from '../../lib/created-by-sql';
import type { SfColumnDef, SfColumnType } from '../../lib/list-query';
import { OP_LOG_QC_REMARKS } from '../../lib/op-log-qc-remarks';
import { polSql } from '../../lib/pol';
import {
  CLIENT_PO_NO_SQL,
  PGRN_CLIENT_PO_NO,
  actualMachineSql,
  plannedMachineSql,
} from './register-facts';
import {
  INC_CREATED_AT,
  INC_CREATED_BY_NAME,
  INC_OPERATION,
  INC_PENDING_QTY,
  INC_SO_CODE,
  INC_SO_INTERNAL,
  ITEM_CODE,
  ITEM_REV,
  VENDOR,
  grnTypeLabelSql,
} from './register-incoming';
import {
  CUSTOMER,
  JW_CODE,
  PART_CODE,
  PGRN_CREATED_AT,
  PGRN_CREATED_BY_NAME,
  PGRN_PENDING_QTY,
  PM_CODE,
  QC_DAY,
} from './register-party';
import { ITEM_CODE_REV, OP_ORDER_CODE, PEND_SINCE, codeRevSql, istDaySql } from './sql';

export type QcPendingSfField = (typeof QC_REGISTER_PENDING_SF_FIELDS)[number];
export type QcCompletedSfField = (typeof QC_REGISTER_COMPLETED_SF_FIELDS)[number];
type Field = QcPendingSfField | QcCompletedSfField;

/** Each field's column alias in the union and its type. */
const COLS: Record<Field, { alias: string; type: Exclude<SfColumnType, 'list'> }> = {
  soCode: { alias: 'sf_so_code', type: 'text' },
  createdOn: { alias: 'sf_created_on', type: 'date' },
  createdBy: { alias: 'sf_created_by', type: 'text' },
  docNo: { alias: 'sf_doc_no', type: 'text' },
  docDate: { alias: 'sf_doc_date', type: 'date' },
  itemCode: { alias: 'sf_item_code', type: 'text' },
  itemName: { alias: 'sf_item_name', type: 'text' },
  qcPending: { alias: 'sf_qc_pending', type: 'num' },
  calledDate: { alias: 'sf_called_date', type: 'date' },
  pol: { alias: 'sf_pol', type: 'text' },
  soVendor: { alias: 'sf_so_vendor', type: 'text' },
  soInternalNo: { alias: 'sf_so_internal_no', type: 'text' },
  clientPoNo: { alias: 'sf_client_po_no', type: 'text' },
  operation: { alias: 'sf_operation', type: 'text' },
  receivedQty: { alias: 'sf_received_qty', type: 'num' },
  assignedTo: { alias: 'sf_assigned_to', type: 'text' },
  plannedMachine: { alias: 'sf_planned_machine', type: 'text' },
  actualMachine: { alias: 'sf_actual_machine', type: 'text' },
  accepted: { alias: 'sf_accepted', type: 'num' },
  rejected: { alias: 'sf_rejected', type: 'num' },
  attended: { alias: 'sf_attended', type: 'date' },
  inspectedBy: { alias: 'sf_inspected_by', type: 'text' },
  logNo: { alias: 'sf_log_no', type: 'text' },
  remarks: { alias: 'sf_remarks', type: 'text' },
  deviationReason: { alias: 'sf_deviation_reason', type: 'text' },
};

const CAST: Record<Exclude<SfColumnType, 'list'>, string> = {
  text: 'text',
  num: 'numeric',
  date: 'date',
};

function mapOf<F extends Field>(fields: readonly F[]): Record<F, SfColumnDef> {
  const out = {} as Record<F, SfColumnDef>;
  for (const f of fields) out[f] = { sql: sql.raw(`k.${COLS[f].alias}`), type: COLS[f].type };
  return out;
}

/** The outer query's column maps — keys are exactly the shared field lists. */
export const QC_REGISTER_PENDING_SF_COLUMNS = mapOf(QC_REGISTER_PENDING_SF_FIELDS);
export const QC_REGISTER_COMPLETED_SF_COLUMNS = mapOf(QC_REGISTER_COMPLETED_SF_FIELDS);

/** `, <expr>::<type> AS <alias>, …` in the field list's order (the union
 *  matches parts by position). A null value is that kind's blank cell. */
function sfSelect<F extends Field>(fields: readonly F[], v: Record<F, SQL | null>): SQL {
  return sql.join(
    fields.map((f) => {
      const { alias, type } = COLS[f];
      return sql`, (${v[f] ?? sql`NULL`})::${sql.raw(CAST[type])} AS ${sql.raw(alias)}`;
    }),
    sql``,
  );
}

/** Every field as a typed NULL — the empty-set fallback's tail. */
export function sfNulls(view: 'pending' | 'completed'): SQL {
  const fields: readonly Field[] =
    view === 'pending' ? QC_REGISTER_PENDING_SF_FIELDS : QC_REGISTER_COMPLETED_SF_FIELDS;
  return sql.join(
    fields.map((f) => sql`, NULL::${sql.raw(CAST[COLS[f].type])} AS ${sql.raw(COLS[f].alias)}`),
    sql``,
  );
}

// ── What each kind's cells show ────────────────────────────────────────────

// Job-card op (pendingFrom / logsFrom aliases).
const OP_SO_INTERNAL = sql`NULLIF(btrim(so.internal_so_no), '')`;

// GRN line (incJoins aliases).
const INC_ITEM_CODE = codeRevSql(ITEM_CODE, ITEM_REV);
const INC_ITEM_NAME = sql`COALESCE(i.name, l.item_name)`;

// Party GRN line (pgrnJoins aliases). Item Name = "Customer RM <code> · <name>"
// (pgrnMaterialOf); Operation = "Party GRN".
const PGRN_ITEM_CODE = codeRevSql(PART_CODE, sql`jwl.revision::text`);
const RM_NAME = sql`COALESCE(rm.name, pgl.party_material_name)`;
const PGRN_ITEM_NAME = sql`('Customer RM ' || COALESCE(
  NULLIF(COALESCE(rm.code, ${PM_CODE}), '') || COALESCE(' · ' || NULLIF(${RM_NAME}, ''), ''),
  ${RM_NAME}, '—'))`;
const PARTY_GRN_LABEL = grnTypeLabelSql('party_grn');
const PGRN_POL = sql`jwl.client_po_line_no`;

const POL = polSql('sol', 'rev_jwl');

// ── Pending parts ──────────────────────────────────────────────────────────

const P = QC_REGISTER_PENDING_SF_FIELDS;

export const OP_PENDING_SF = sfSelect(P, {
  // ADR-261: SO No. filters the order code; Vendor / Customer the party only.
  soCode: OP_ORDER_CODE,
  createdOn: istDaySql(sql`jo.created_at`),
  createdBy: createdByNameSql(sql`jo.created_by`),
  docNo: sql`jc.code`,
  docDate: sql`jc.jc_date`,
  itemCode: ITEM_CODE_REV,
  itemName: sql`i.name`,
  qcPending: sql`vos.qc_pending`,
  calledDate: sql`COALESCE(jo.qc_call_date, ${PEND_SINCE})`,
  pol: POL,
  soVendor: null,
  soInternalNo: OP_SO_INTERNAL,
  clientPoNo: CLIENT_PO_NO_SQL,
  operation: sql`jo.operation`,
  receivedQty: null,
  assignedTo: sql`qa.inspector_name`,
  plannedMachine: plannedMachineSql(sql`vos.jc_op_id`),
  actualMachine: actualMachineSql(sql`vos.jc_op_id`),
});

export const INC_PENDING_SF = sfSelect(P, {
  // ADR-261: SO No. filters the order code; Vendor / Customer the party only.
  soCode: INC_SO_CODE,
  createdOn: istDaySql(INC_CREATED_AT),
  createdBy: INC_CREATED_BY_NAME,
  docNo: sql`h.code`,
  docDate: sql`h.grn_date`,
  itemCode: INC_ITEM_CODE,
  itemName: INC_ITEM_NAME,
  qcPending: INC_PENDING_QTY,
  calledDate: sql`h.grn_date`,
  pol: POL,
  soVendor: VENDOR,
  soInternalNo: INC_SO_INTERNAL,
  clientPoNo: CLIENT_PO_NO_SQL,
  operation: INC_OPERATION,
  receivedQty: sql`l.received_qty`,
  assignedTo: null,
  plannedMachine: null,
  actualMachine: null,
});

export const PGRN_PENDING_SF = sfSelect(P, {
  // ADR-261: SO No. filters the order code; Vendor / Customer the party only.
  soCode: JW_CODE,
  createdOn: istDaySql(PGRN_CREATED_AT),
  createdBy: PGRN_CREATED_BY_NAME,
  docNo: sql`pg.code`,
  docDate: sql`pg.grn_date`,
  itemCode: PGRN_ITEM_CODE,
  itemName: PGRN_ITEM_NAME,
  qcPending: PGRN_PENDING_QTY,
  calledDate: sql`pg.grn_date`,
  pol: PGRN_POL,
  soVendor: CUSTOMER,
  soInternalNo: null,
  clientPoNo: PGRN_CLIENT_PO_NO,
  operation: PARTY_GRN_LABEL,
  receivedQty: sql`pgl.received_qty`,
  assignedTo: null,
  plannedMachine: null,
  actualMachine: null,
});

// ── Completed parts ────────────────────────────────────────────────────────

const C = QC_REGISTER_COMPLETED_SF_FIELDS;

export const OP_COMPLETED_SF = sfSelect(C, {
  // ADR-261: SO No. filters the order code; Vendor / Customer the party only.
  soCode: OP_ORDER_CODE,
  createdOn: istDaySql(sql`ol.created_at`),
  createdBy: createdByNameSql(sql`ol.created_by`),
  docNo: sql`jc.code`,
  docDate: sql`jc.jc_date`,
  itemCode: ITEM_CODE_REV,
  itemName: sql`i.name`,
  accepted: sql`ol.qty`,
  rejected: sql`ol.reject_qty`,
  attended: sql`ol.log_date`,
  inspectedBy: sql`ol.operator_name`,
  pol: POL,
  soVendor: null,
  soInternalNo: OP_SO_INTERNAL,
  clientPoNo: CLIENT_PO_NO_SQL,
  operation: sql`jo.operation`,
  calledDate: sql`jo.qc_call_date`,
  logNo: sql`ol.log_no`,
  remarks: OP_LOG_QC_REMARKS,
  deviationReason: null,
  plannedMachine: plannedMachineSql(sql`ol.jc_op_id`),
  actualMachine: actualMachineSql(sql`ol.jc_op_id`),
});

export const INC_COMPLETED_SF = sfSelect(C, {
  // ADR-261: SO No. filters the order code; Vendor / Customer the party only.
  soCode: INC_SO_CODE,
  createdOn: istDaySql(INC_CREATED_AT),
  createdBy: INC_CREATED_BY_NAME,
  docNo: sql`h.code`,
  docDate: sql`h.grn_date`,
  itemCode: INC_ITEM_CODE,
  itemName: INC_ITEM_NAME,
  accepted: sql`l.qc_accepted_qty`,
  rejected: sql`l.qc_rejected_qty`,
  attended: sql`l.qc_date`,
  inspectedBy: sql`COALESCE(l.qc_inspected_by_text, u.full_name, u.email)`,
  pol: POL,
  soVendor: VENDOR,
  soInternalNo: INC_SO_INTERNAL,
  clientPoNo: CLIENT_PO_NO_SQL,
  operation: INC_OPERATION,
  calledDate: sql`h.grn_date`,
  logNo: null,
  remarks: sql`l.qc_remarks`,
  deviationReason: null,
  plannedMachine: null,
  actualMachine: null,
});

export const PGRN_COMPLETED_SF = sfSelect(C, {
  // ADR-261: SO No. filters the order code; Vendor / Customer the party only.
  soCode: JW_CODE,
  createdOn: istDaySql(PGRN_CREATED_AT),
  createdBy: PGRN_CREATED_BY_NAME,
  docNo: sql`pg.code`,
  docDate: sql`pg.grn_date`,
  itemCode: PGRN_ITEM_CODE,
  itemName: PGRN_ITEM_NAME,
  accepted: sql`pgl.accepted_qty`,
  rejected: sql`pgl.rejected_qty`,
  attended: QC_DAY,
  inspectedBy: sql`COALESCE(u.full_name, u.email)`,
  pol: PGRN_POL,
  soVendor: CUSTOMER,
  soInternalNo: null,
  clientPoNo: PGRN_CLIENT_PO_NO,
  operation: PARTY_GRN_LABEL,
  calledDate: sql`pg.grn_date`,
  logNo: null,
  // QC Remarks (0232) and the Deviation Reason are separate columns.
  remarks: sql`pgl.qc_remarks`,
  deviationReason: sql`pgl.reject_reason`,
  plannedMachine: null,
  actualMachine: null,
});
