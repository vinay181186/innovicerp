// QC Call Register — Pending view columns (ADR-199 fit table). One unified row
// per pending call, whether it is a job-card QC op (process QC) or a received
// GRN line awaiting inspection (incoming QC). The two feeds carry different
// field names, so a small discriminated view-model (PendingVM) maps both onto
// the one set of accessors the columns read.
//
// Visible columns: the six lead columns (SO No. · Internal SO No. · POL ·
// Created On · Item Code · Item Name, owner rule 2026-10-31), then Doc No. ·
// QC Pending · Called Date · Days Waiting · Planned Machine · Actual Machine ·
// Client PO No. · Stage. The secondary facts — Vendor / Customer, Operation,
// Assigned To — start hidden (PENDING_HIDDEN) so the fit engine drops them
// into the ▸ detail row. A pending call has not been
// inspected yet, so the completed-only facts the sheet used to imply (response
// days, log no., remarks, report) simply do not exist on this feed.
//
// Row click opens the document (the page owns it); the Inspect action opens the
// accept/reject popup (the page owns that too). Columns are presentational.
//
// ADR-203: a third kind, 'pgrn' — a Party GRN line (customer material received
// against a JWSO line) waiting for Incoming QC. Item Code is the finished part
// (CODE/REV); Item Name shows the customer RM received; SO No. is the JWSO and
// Vendor / Customer the customer; Operation reads "Party GRN · <JWSO> Ln <n>". It files under the
// Incoming stage. Whole pieces only.

import type { PartyGrnQcRow, QcGrnType, QcRegisterPendingItem } from '@innovic/shared';
import { QC_GRN_TYPE_LABELS, opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate, todayIst } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { factColumns } from './qc-call-fact-columns';
import { QC_STAGES, dayDiff, processStage, type QcStage } from './qc-sheet';

/** One pending call, from either feed — the register's own item, so a GRN
 *  line carries its GRN Type (ADR-251). The raw row is kept so the page can
 *  open the right document and the right inspect popup off it. */
export type PendingVM = QcRegisterPendingItem;

/** Stable row key — the same `op:` / `inc:` prefixes the old sheet used, plus
 *  `pgrn:` for a Party GRN line. */
export function pendingVmKey(vm: PendingVM): string {
  if (vm.kind === 'op') return `op:${vm.row.jcOpId}`;
  if (vm.kind === 'pgrn') return `pgrn:${vm.row.partyGrnLineId}`;
  return `inc:${vm.row.grnLineId}`;
}

/** "JW-… Ln n" — the JWSO line a Party GRN line was received against. */
export function pgrnOrderOf(row: PartyGrnQcRow): string {
  if (!row.jwCode) return '—';
  return row.jwLineNo != null ? `${row.jwCode} Ln ${row.jwLineNo}` : row.jwCode;
}

/** The customer RM a Party GRN line brought in — code, then name. */
export function pgrnMaterialOf(row: PartyGrnQcRow): string {
  const code = row.rmItemCode ?? row.partyMaterialCode;
  if (!code) return row.rmItemName ?? '—';
  return row.rmItemName ? `${code} · ${row.rmItemName}` : code;
}

const STAGE_LABEL = Object.fromEntries(QC_STAGES.map((s) => [s.key, s.label])) as Record<
  QcStage,
  string
>;

/** ADR-251 — an incoming call's Stage cell names its GRN Type:
 *  "Incoming · Direct Purchase", "Incoming · Party GRN". Plain "Incoming" when an
 *  older API build sent no type. */
export function incomingStageLabel(grnType: QcGrnType | undefined): string {
  return grnType
    ? `${STAGE_LABEL.incoming} · ${QC_GRN_TYPE_LABELS[grnType]}`
    : STAGE_LABEL.incoming;
}
/** The Stage cell text for a pending call. */
function stageLabelOf(vm: PendingVM): string {
  if (vm.kind === 'op') return STAGE_LABEL[processStage(vm.row.isLastOp)];
  return incomingStageLabel(vm.kind === 'pgrn' ? 'party_grn' : vm.grnType);
}

function qcPending(vm: PendingVM): number {
  return vm.kind === 'op' ? vm.row.qcPending : vm.row.pendingQty;
}
function receivedOf(vm: PendingVM): number | null {
  return vm.kind === 'op' ? null : vm.row.receivedQty;
}
function itemCodeOf(vm: PendingVM): string | null {
  return vm.kind === 'pgrn' ? vm.row.partCode : vm.row.itemCode;
}
function itemRevOf(vm: PendingVM): string | null {
  return vm.kind === 'pgrn' ? vm.row.partRevision : vm.row.itemRevision;
}
function itemNameOf(vm: PendingVM): string {
  if (vm.kind === 'pgrn') return `Customer RM ${pgrnMaterialOf(vm.row)}`;
  return vm.row.itemName ?? '—';
}
function polOf(vm: PendingVM): string | null {
  return vm.row.clientPoLineNo;
}
function calledDateOf(vm: PendingVM): string | null {
  return vm.kind === 'op' ? (vm.row.qcCallDate ?? vm.row.pendSince) : vm.row.grnDate;
}
function waitDaysOf(vm: PendingVM): number | null {
  if (vm.kind !== 'op') return vm.row.waitDays;
  // Measured from the SAME date the Called cell shows, so the two never
  // contradict each other.
  const from = vm.row.qcCallDate ?? vm.row.pendSince;
  return from ? dayDiff(from, todayIst()) : null;
}
export function pendingStageOf(vm: PendingVM): QcStage {
  return vm.kind === 'op' ? processStage(vm.row.isLastOp) : 'incoming';
}
export function pendingOverdue(vm: PendingVM): boolean {
  return vm.kind === 'op' ? vm.row.overdue : false;
}
/** The vendor (GRN line) or customer (Party GRN line) the call stands against;
 *  a job-card call has neither. */
function vendorOf(vm: PendingVM): string {
  if (vm.kind === 'pgrn') return vm.row.customerName ?? '—';
  if (vm.kind === 'op') return '—';
  return vm.row.vendorName ?? '—';
}
/** Lead SO No.: the SO (job-card / GRN call), the JWSO (Party GRN call). */
function soNoOf(vm: PendingVM): string | null {
  if (vm.kind === 'pgrn') return vm.row.jwCode;
  return vm.row.soCode;
}
/** ADR-207 — the office's own Internal SO No. A Party GRN line stands against
 *  a JWSO, which has none. */
function soInternalNoOf(vm: PendingVM): string | null {
  return vm.kind === 'pgrn' ? null : vm.row.soInternalNo;
}
function operationOf(vm: PendingVM): string {
  if (vm.kind === 'op') return `Op ${opSrNo(vm.row.opSeq)} ${vm.row.operation}`;
  if (vm.kind === 'pgrn') return `Party GRN · ${pgrnOrderOf(vm.row)}`;
  if (!vm.row.jcCode) return 'No job card';
  const seq = vm.row.opSeq != null ? ` Op ${opSrNo(vm.row.opSeq)}` : '';
  return `${vm.row.jcCode}${seq}${vm.row.opName ? ` · ${vm.row.opName}` : ''}`;
}

/** The waiting cell: "Today" at 0, else "N days", red when the call is overdue. */
function waitDisplay(vm: PendingVM): React.JSX.Element {
  const n = waitDaysOf(vm);
  const overdue = pendingOverdue(vm);
  const text = n == null ? '—' : n <= 0 ? 'Today' : `${n} day${n > 1 ? 's' : ''}`;
  return (
    <span
      className="mono"
      style={{ color: overdue ? 'var(--red)' : 'var(--text)', fontWeight: overdue ? 700 : 400 }}
    >
      {text}
    </span>
  );
}

/** Columns that start hidden — the fit engine shows them in the ▸ detail row. */
export const PENDING_HIDDEN = ['vendor', 'operation', 'assigned_to', 'received_qty'];

export function pendingColumns(): DataTableColumn<PendingVM>[] {
  return [
    // Owner rule 2026-10-31 — own number (Doc No.) first, the six lead
    // columns, the rest after Item Name. Created On = each call's own record created_at.
    ...leadColumns<PendingVM>({
      doc: {
        id: 'doc_no',
        sortFilterField: 'docNo',
        header: 'Doc No.',
        nowrap: true,
        render: (vm) =>
          vm.kind === 'pgrn' ? (
            <Link
              to="/party-grn"
              search={{ search: vm.row.partyGrnNo, page: 1 }}
              className="td-code"
              style={{ color: 'var(--blue)', fontWeight: 800 }}
              title="Open this Party GRN"
              onClick={(e) => e.stopPropagation()}
            >
              {vm.row.partyGrnNo}
            </Link>
          ) : vm.kind === 'op' ? (
            <Link
              to="/job-cards/$id"
              params={{ id: vm.row.jobCardId }}
              className="td-code"
              style={{ color: 'var(--blue)', fontWeight: 800 }}
              title="Open this job card"
              onClick={(e) => e.stopPropagation()}
            >
              {vm.row.jcCode}
            </Link>
          ) : (
            <Link
              to="/goods-receipt-notes/$id"
              params={{ id: vm.row.grnId }}
              className="td-code"
              style={{ color: 'var(--blue)', fontWeight: 800 }}
              title="Open this GRN"
              onClick={(e) => e.stopPropagation()}
            >
              {vm.row.grnNo}
            </Link>
          ),
      },
      docDate: {
        id: 'doc_date',
        sortFilterField: 'docDate',
        kind: 'date',
        header: 'Doc Date',
        className: 'mono',
        nowrap: true,
        render: (vm) => fmtDate(vm.docDate ?? null),
        filterValue: (vm) => vm.docDate ?? '',
      },
      soNo: soNoOf,
      internalSoNo: soInternalNoOf,
      pol: polOf,
      createdOn: (vm) => vm.row.createdAt ?? null,
      itemCode: itemCodeOf,
      itemRev: itemRevOf,
      itemName: itemNameOf,
      overrides: {
        so_no: { sortFilterField: 'soCode' },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        client_po_line_no: { sortFilterField: 'pol' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'qc_pending',
      sortFilterField: 'qcPending',
      header: 'QC Pending',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (vm) => qcPending(vm),
    },
    {
      id: 'called_date',
      sortFilterField: 'calledDate',
      kind: 'date',
      header: 'Called Date',
      className: 'mono',
      nowrap: true,
      render: (vm) => fmtDate(calledDateOf(vm)),
    },
    {
      id: 'days_waiting',
      header: 'Days Waiting',
      align: 'right',
      nowrap: true,
      render: (vm) => waitDisplay(vm),
      filterValue: (vm) => waitDaysOf(vm),
    },
    // Planned Machine · Actual Machine · Client PO No. (qc-call-fact-columns).
    ...factColumns<PendingVM>(),
    {
      id: 'stage',
      kind: 'badge',
      header: 'Stage',
      nowrap: true,
      render: (vm) => (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>
          {stageLabelOf(vm)}
        </span>
      ),
      filterValue: (vm) => stageLabelOf(vm),
    },
    // ─── ▸ detail (hidden by default) ───────────────────────────────────────
    {
      // The party the call stands against when it is not a sales order: the
      // vendor of a GRN line, the customer of a Party GRN line. The order
      // number itself is the lead SO No. column (server field `soCode`);
      // `soVendor` filters the vendor / customer only (blank on a job-card row).
      id: 'vendor',
      sortFilterField: 'soVendor',
      header: 'Vendor / Customer',
      align: 'left',
      ellipsis: true,
      render: (vm) => vendorOf(vm),
      title: (vm) => vendorOf(vm),
    },
    {
      id: 'operation',
      sortFilterField: 'operation',
      header: 'Operation',
      align: 'left',
      ellipsis: true,
      render: (vm) => operationOf(vm),
      title: (vm) => operationOf(vm),
    },
    {
      id: 'received_qty',
      sortFilterField: 'receivedQty',
      header: 'Received Qty',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (vm) => receivedOf(vm) ?? '—',
    },
    {
      id: 'assigned_to',
      sortFilterField: 'assignedTo',
      header: 'Assigned To',
      align: 'left',
      ellipsis: true,
      render: (vm) => (vm.kind === 'op' ? (vm.row.assignedTo ?? '—') : '—'),
      title: (vm) => (vm.kind === 'op' ? (vm.row.assignedTo ?? '') : ''),
    },
  ];
}
