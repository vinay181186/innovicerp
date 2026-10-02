// QC Call Register — Completed view columns (ADR-199 fit table). One unified row
// per completed inspection, from either feed: a job-card QC log entry (process
// QC) or a GRN line that has been inspected (incoming QC). CompletedVM maps the
// two shapes onto one set of accessors.
//
// Visible columns (first pinned = Doc No.): Doc No. · Item Code · Accepted ·
// Rejected · QC Result · Attended · Inspected By. Everything else — Item Name,
// POL, SO / Vendor, Operation, Called Date, Response days, Log No., Remarks and
// the QC report — starts hidden (COMPLETED_HIDDEN) so the fit engine shows it in
// the ▸ detail row. Row click opens the document (the page owns navigation).
//
// ADR-203: a third kind, 'pgrn' — a Party GRN line (customer material) whose
// Incoming QC is booked. Same reading as on the Pending view: Item Code = the
// finished part (CODE/REV), Item Name = the customer RM, SO / Vendor = the
// customer, Remarks = the reject reason.

import type { IncomingQcCompletedRow, PartyGrnQcRow, QcHistoryLogRow } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { pgrnMaterialOf, pgrnOrderOf } from './qc-call-pending-columns';
import { dayDiff } from './qc-sheet';

/** One completed inspection, from either feed. The raw row is kept so the page
 *  can open the right document and the feed can be time-ordered. */
export type CompletedVM =
  | { kind: 'op'; row: QcHistoryLogRow }
  | { kind: 'inc'; row: IncomingQcCompletedRow }
  | { kind: 'pgrn'; row: PartyGrnQcRow };

/** Stable row key — the same `proc:` / `inc:` prefixes the old sheet used, plus
 *  `pgrn:` for a Party GRN line. */
export function completedVmKey(vm: CompletedVM): string {
  if (vm.kind === 'op') return `proc:${vm.row.logId}`;
  if (vm.kind === 'pgrn') return `pgrn:${vm.row.partyGrnLineId}`;
  return `inc:${vm.row.grnLineId}`;
}

/** ISO timestamp the inspection happened, for newest-first ordering. */
export function completedVmAt(vm: CompletedVM): string {
  if (vm.kind === 'pgrn') return vm.row.qcDate ?? vm.row.grnDate;
  return vm.kind === 'op'
    ? (vm.row.loggedAt ?? vm.row.logDate ?? '')
    : (vm.row.qcAt ?? vm.row.qcDate ?? vm.row.grnDate ?? '');
}

type Verdict = 'ACCEPTED' | 'PARTIAL' | 'REJECTED';
const VERDICT_LABEL: Record<Verdict, string> = {
  ACCEPTED: 'Accepted',
  PARTIAL: 'Partly Accepted',
  REJECTED: 'Rejected',
};

function itemCodeOf(vm: CompletedVM): string {
  if (vm.kind === 'pgrn') return itemCodeWithRev(vm.row.partCode, vm.row.partRevision);
  return itemCodeWithRev(vm.row.itemCode, vm.row.itemRevision);
}
function itemNameOf(vm: CompletedVM): string {
  if (vm.kind === 'pgrn') return `Customer RM ${pgrnMaterialOf(vm.row)}`;
  return vm.row.itemName ?? '—';
}
function polOf(vm: CompletedVM): string | null {
  return vm.kind === 'pgrn' ? null : vm.row.clientPoLineNo;
}
function acceptedOf(vm: CompletedVM): number {
  return vm.kind === 'op' ? vm.row.accepted : vm.row.acceptedQty;
}
function rejectedOf(vm: CompletedVM): number {
  return vm.kind === 'op' ? vm.row.rejected : vm.row.rejectedQty;
}
function verdictOf(vm: CompletedVM): Verdict {
  if (vm.kind !== 'inc') {
    const acc = acceptedOf(vm);
    const rej = rejectedOf(vm);
    return rej > 0 ? (acc > 0 ? 'PARTIAL' : 'REJECTED') : 'ACCEPTED';
  }
  return vm.row.disposition === 'Rejected'
    ? 'REJECTED'
    : vm.row.disposition === 'Partial Accept'
      ? 'PARTIAL'
      : 'ACCEPTED';
}
function attendedOf(vm: CompletedVM): string | null {
  return vm.kind === 'op' ? vm.row.logDate : vm.row.qcDate;
}
function inspectedByOf(vm: CompletedVM): string | null {
  if (vm.kind === 'pgrn') return vm.row.qcByName;
  return vm.kind === 'op' ? vm.row.inspector : vm.row.qcInspectedBy;
}
function calledOf(vm: CompletedVM): string | null {
  return vm.kind === 'op' ? vm.row.qcCallDate : vm.row.grnDate;
}
function respDaysOf(vm: CompletedVM): number | null {
  if (vm.kind === 'inc') return vm.row.respDays;
  if (vm.kind === 'pgrn') return vm.row.qcDate ? dayDiff(vm.row.grnDate, vm.row.qcDate) : null;
  return vm.row.qcCallDate ? dayDiff(vm.row.qcCallDate, vm.row.logDate) : null;
}
function soVendorOf(vm: CompletedVM): string {
  if (vm.kind === 'pgrn') return vm.row.customerName ?? '—';
  return vm.kind === 'op' ? (vm.row.soCode ?? '—') : (vm.row.vendorName ?? '—');
}
function operationOf(vm: CompletedVM): string {
  if (vm.kind === 'pgrn') return `Party GRN · ${pgrnOrderOf(vm.row)}`;
  return vm.kind === 'op'
    ? `Op ${opSrNo(vm.row.opSeq)} ${vm.row.operation}`
    : `GRN ${vm.row.grnNo}`;
}
function remarksOf(vm: CompletedVM): string | null {
  if (vm.kind === 'pgrn') return vm.row.rejectReason;
  return vm.kind === 'op' ? vm.row.remarks : vm.row.qcRemarks;
}

function qtyCell(value: number, red?: boolean): React.JSX.Element {
  return (
    <span
      className="mono fw-700"
      style={{
        color: red && value > 0 ? 'var(--red)' : value === 0 ? 'var(--text3)' : 'var(--text)',
      }}
    >
      {value}
    </span>
  );
}

function verdictCell(vm: CompletedVM): React.JSX.Element {
  const v = verdictOf(vm);
  const red = v !== 'ACCEPTED';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        border: `1px solid ${red ? 'var(--red)' : 'var(--border2)'}`,
        color: red ? 'var(--red)' : 'var(--text2)',
      }}
    >
      {VERDICT_LABEL[v]}
    </span>
  );
}

function respDisplay(vm: CompletedVM): string {
  const n = respDaysOf(vm);
  return n == null ? '—' : n <= 0 ? 'Same day' : `${n} day${n > 1 ? 's' : ''}`;
}

/** Columns that start hidden — the fit engine shows them in the ▸ detail row. */
export const COMPLETED_HIDDEN = [
  'item_name',
  'pol',
  'so_vendor',
  'operation',
  'called_date',
  'response_days',
  'log_no',
  'remarks',
  'report',
];

export function completedColumns(): DataTableColumn<CompletedVM>[] {
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
        ) : vm.kind === 'inc' ? (
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
        ) : vm.row.jobCardId ? (
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
            to="/job-cards"
            search={{ search: vm.row.jcCode, page: 1 }}
            className="td-code"
            style={{ color: 'var(--blue)', fontWeight: 800 }}
            title="Find this job card"
            onClick={(e) => e.stopPropagation()}
          >
            {vm.row.jcCode}
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
      id: 'accepted',
      header: 'Accepted',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green)',
      render: (vm) => qtyCell(acceptedOf(vm)),
    },
    {
      id: 'rejected',
      header: 'Rejected',
      align: 'right',
      nowrap: true,
      headColor: 'var(--red)',
      render: (vm) => qtyCell(rejectedOf(vm), true),
    },
    {
      id: 'qc_result',
      kind: 'badge',
      header: 'QC Result',
      nowrap: true,
      render: (vm) => verdictCell(vm),
      filterValue: (vm) => VERDICT_LABEL[verdictOf(vm)],
    },
    {
      id: 'attended',
      kind: 'date',
      header: 'Attended',
      className: 'mono',
      nowrap: true,
      render: (vm) => fmtDate(attendedOf(vm)),
    },
    {
      id: 'inspected_by',
      header: 'Inspected By',
      align: 'left',
      ellipsis: true,
      render: (vm) => inspectedByOf(vm) ?? '—',
      title: (vm) => inspectedByOf(vm) ?? '',
    },
    // ─── ▸ detail (hidden by default) ───────────────────────────────────────
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (vm) => itemNameOf(vm),
      title: (vm) => itemNameOf(vm),
    },
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
      id: 'called_date',
      kind: 'date',
      header: 'Called Date',
      className: 'mono',
      nowrap: true,
      render: (vm) => fmtDate(calledOf(vm)),
    },
    {
      id: 'response_days',
      header: 'Response Days',
      align: 'right',
      nowrap: true,
      render: (vm) => respDisplay(vm),
      filterValue: (vm) => respDaysOf(vm),
    },
    {
      id: 'log_no',
      header: 'Log No.',
      nowrap: true,
      className: 'mono',
      render: (vm) => (vm.kind === 'op' ? vm.row.logNo : '—'),
    },
    {
      id: 'remarks',
      header: 'Remarks',
      align: 'left',
      ellipsis: true,
      render: (vm) => remarksOf(vm) ?? '—',
      title: (vm) => remarksOf(vm) ?? '',
    },
    {
      id: 'report',
      header: 'Report',
      nowrap: true,
      stopRowClick: true,
      render: (vm) =>
        vm.kind !== 'pgrn' && vm.row.qcReportPath ? (
          <QcReportLink path={vm.row.qcReportPath} name={vm.row.qcReportName} label="Report" />
        ) : (
          <span className="text3">—</span>
        ),
    },
  ];
}
