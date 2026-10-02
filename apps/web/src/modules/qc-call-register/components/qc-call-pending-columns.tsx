// QC Call Register — Pending view columns (ADR-199 fit table). One unified row
// per pending call, whether it is a job-card QC op (process QC) or a received
// GRN line awaiting inspection (incoming QC). The two feeds carry different
// field names, so a small discriminated view-model (PendingVM) maps both onto
// the one set of accessors the columns read.
//
// Visible columns (first pinned = Doc No.): Doc No. · Item Code · Item Name ·
// QC Pending · Called Date · Days Waiting · Stage. The secondary facts — POL,
// SO / Vendor, Operation, Assigned To — start hidden (PENDING_HIDDEN) so the
// fit engine drops them into the ▸ detail row. A pending call has not been
// inspected yet, so the completed-only facts the sheet used to imply (response
// days, log no., remarks, report) simply do not exist on this feed.
//
// Row click opens the document (the page owns it); the Inspect action opens the
// accept/reject popup (the page owns that too). Columns are presentational.
//
// ADR-203: a third kind, 'pgrn' — a Party GRN line (customer material received
// against a JWSO line) waiting for Incoming QC. Item Code is the finished part
// (CODE/REV); Item Name shows the customer RM received; SO / Vendor is the
// customer; Operation reads "Party GRN · <JWSO> Ln <n>". It files under the
// Incoming stage. Whole pieces only.

import type { IncomingQcPendingRow, PartyGrnQcRow, QcHistoryPendingRow } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate, todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { QC_STAGES, dayDiff, processStage, type QcStage } from './qc-sheet';

/** One pending call, from either feed. The raw row is kept so the page can open
 *  the right document and the right inspect popup off it. */
export type PendingVM =
  | { kind: 'op'; row: QcHistoryPendingRow }
  | { kind: 'inc'; row: IncomingQcPendingRow }
  | { kind: 'pgrn'; row: PartyGrnQcRow };

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

function qcPending(vm: PendingVM): number {
  return vm.kind === 'op' ? vm.row.qcPending : vm.row.pendingQty;
}
function receivedOf(vm: PendingVM): number | null {
  return vm.kind === 'op' ? null : vm.row.receivedQty;
}
function itemCodeOf(vm: PendingVM): string {
  if (vm.kind === 'pgrn') return itemCodeWithRev(vm.row.partCode, vm.row.partRevision);
  return itemCodeWithRev(vm.row.itemCode, vm.row.itemRevision);
}
function itemNameOf(vm: PendingVM): string {
  if (vm.kind === 'pgrn') return `Customer RM ${pgrnMaterialOf(vm.row)}`;
  return vm.row.itemName ?? '—';
}
function polOf(vm: PendingVM): string | null {
  return vm.kind === 'pgrn' ? null : vm.row.clientPoLineNo;
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
function soVendorOf(vm: PendingVM): string {
  if (vm.kind === 'pgrn') return vm.row.customerName ?? '—';
  return vm.kind === 'op' ? (vm.row.soCode ?? '—') : (vm.row.vendorName ?? '—');
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
export const PENDING_HIDDEN = ['pol', 'so_vendor', 'operation', 'assigned_to', 'received_qty'];

export function pendingColumns(): DataTableColumn<PendingVM>[] {
  return [
    {
      // First column — pinned by the table standard (ADR-199).
      id: 'doc_no',
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
    {
      id: 'item_code',
      header: 'Item Code',
      nowrap: true,
      className: 'mono fw-700',
      render: (vm) => itemCodeOf(vm),
      title: (vm) => itemCodeOf(vm),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (vm) => itemNameOf(vm),
      title: (vm) => itemNameOf(vm),
    },
    {
      id: 'qc_pending',
      header: 'QC Pending',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (vm) => qcPending(vm),
    },
    {
      id: 'called_date',
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
    {
      id: 'stage',
      kind: 'badge',
      header: 'Stage',
      nowrap: true,
      render: (vm) => (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>
          {STAGE_LABEL[pendingStageOf(vm)]}
        </span>
      ),
      filterValue: (vm) => STAGE_LABEL[pendingStageOf(vm)],
    },
    // ─── ▸ detail (hidden by default) ───────────────────────────────────────
    {
      id: 'pol',
      header: 'POL',
      nowrap: true,
      render: (vm) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {polOf(vm) ?? '—'}
        </span>
      ),
    },
    {
      id: 'so_vendor',
      header: 'SO / Vendor',
      align: 'left',
      ellipsis: true,
      render: (vm) => soVendorOf(vm),
      title: (vm) => soVendorOf(vm),
    },
    {
      id: 'operation',
      header: 'Operation',
      align: 'left',
      ellipsis: true,
      render: (vm) => operationOf(vm),
      title: (vm) => operationOf(vm),
    },
    {
      id: 'received_qty',
      header: 'Received Qty',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (vm) => receivedOf(vm) ?? '—',
    },
    {
      id: 'assigned_to',
      header: 'Assigned To',
      align: 'left',
      ellipsis: true,
      render: (vm) => (vm.kind === 'op' ? (vm.row.assignedTo ?? '—') : '—'),
      title: (vm) => (vm.kind === 'op' ? (vm.row.assignedTo ?? '') : ''),
    },
  ];
}
