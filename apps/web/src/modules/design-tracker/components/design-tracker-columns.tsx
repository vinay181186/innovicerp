// Design Tracker list — the fit table's columns, row tint, ⋯ menu and ▸ detail
// (ADR-199 table standard 2026-10-01). Split out of routes/list.tsx so that file
// stays small and the sheet is defined in one place.
//
// One row per design. First column (Design No.) is pinned and carries the fit
// table's ▸ — the row's one expand control — which opens the Start Date detail.
// Labels per docs/NAMING.md: Design Rev (not bare "Rev"), Due Date, Estimated
// Hours, Booked Hours (design_work_log roll-up, the list's totalHours).
// Numbers (Design Rev, Booked Hours, Estimated Hours) are right-aligned.

import { DESIGN_TRACKER_STATUSES, type DesignTrackerListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { ROW_TINT, leadColumns } from '@/ui/data';

/** True when the design's Due Date is past and it is not yet Approved. */
export function isDesignOverdue(row: DesignTrackerListItem, today: string): boolean {
  return row.targetDate < today && row.status !== 'Approved';
}

/** Status badge class: Approved green, Pending blue, everything in-flight amber. */
function statusClass(status: DesignTrackerListItem['status']): string {
  if (status === 'Approved') return 'b-green';
  if (status === 'Pending') return 'b-blue';
  return 'b-amber';
}

/**
 * Whole-row wash by status (ADR-199 ROW_TINT): overdue (past Due Date, not
 * Approved) → late (red, the old row background); Approved → done (green);
 * otherwise no wash.
 */
export function designTrackerRowTint(
  row: DesignTrackerListItem,
  today: string,
): string | undefined {
  if (isDesignOverdue(row, today)) return ROW_TINT.late;
  if (row.status === 'Approved') return ROW_TINT.done;
  return undefined;
}

/** Design Status tick list for the server Sort & Filter (ADR-200). */
const STATUS_OPTIONS = DESIGN_TRACKER_STATUSES.map((v) => ({ value: v, label: v }));

export function designTrackerColumns(opts: {
  /** IST yyyy-mm-dd for the overdue check — computed once by the route. */
  today: string;
}): DataTableColumn<DesignTrackerListItem>[] {
  const { today } = opts;
  return [
    // Owner rule 2026-10-31 — the six lead columns first; Design No. and every
    // other fact follow Item Name.
    ...leadColumns<DesignTrackerListItem>({
      soNo: (d) => d.soCodeText,
      internalSoNo: (d) => d.soInternalNo,
      pol: (d) => d.clientPoLineNo,
      createdOn: (d) => d.createdAt,
      itemCode: (d) => d.itemCodeText,
      itemRev: (d) => d.itemRevision,
      itemName: (d) => d.itemNameText,
      overrides: {
        so_no: { sortFilterField: 'soCode' },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'design_no',
      header: 'Design No.',
      nowrap: true,
      render: (d) => (
        <span className="td-code" style={{ color: 'var(--purple)' }}>
          {d.code}
        </span>
      ),
      sortFilterField: 'code',
    },
    {
      id: 'designer',
      header: 'Design Engineer',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (d) => d.designer || '—',
      sortFilterField: 'designer',
      title: (d) => d.designer,
    },
    {
      id: 'due_date',
      header: 'Due Date',
      kind: 'date',
      sortFilterField: 'dueDate',
      className: 'mono',
      nowrap: true,
      render: (d) => {
        const overdue = isDesignOverdue(d, today);
        return (
          <span style={{ color: overdue ? 'var(--red)' : 'var(--text2)' }}>
            {fmtDate(d.targetDate)}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Design Status',
      kind: 'badge',
      nowrap: true,
      render: (d) => <span className={`badge ${statusClass(d.status)}`}>{d.status}</span>,
      sortFilterField: 'status',
      filterType: 'list',
      filterOptions: STATUS_OPTIONS,
    },
    {
      id: 'revision',
      header: 'Design Rev',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      filterValue: (d) => d.revision,
      sortFilterField: 'revision',
      filterType: 'num',
      render: (d) => d.revision,
    },
    {
      id: 'booked_hours',
      header: 'Booked Hours',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      filterValue: (d) => d.totalHours,
      sortFilterField: 'bookedHours',
      filterType: 'num',
      render: (d) => (
        <span style={{ color: d.totalHours > d.estimatedHours ? 'var(--red)' : 'var(--green)' }}>
          {d.totalHours}
        </span>
      ),
    },
    {
      id: 'estimated_hours',
      header: 'Estimated Hours',
      kind: 'num',
      align: 'right',
      className: 'mono',
      nowrap: true,
      filterValue: (d) => d.estimatedHours,
      sortFilterField: 'estimatedHours',
      filterType: 'num',
      render: (d) => <span style={{ color: 'var(--text3)' }}>{d.estimatedHours}h</span>,
    },
  ];
}

/** The ▸ detail content — Start Date, moved off the main row (brief). */
export function DesignTrackerExpanded({ row }: { row: DesignTrackerListItem }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', fontSize: 12, padding: '4px 0' }}>
      <span style={{ color: 'var(--text3)', fontWeight: 700 }}>Start Date</span>
      <span className="mono text2">{fmtDate(row.startDate)}</span>
    </div>
  );
}

/**
 * The design's ⋯ menu. ADR-232 — the design_create ticks alone decide: Log
 * Time (Entry — the server's logDesignTime rule), Edit (Edit, not Approved),
 * Submit (Advance, In Progress — ADR-231), Approve and Revise (Approve, Review).
 */
export function designTrackerRowMenu(
  row: DesignTrackerListItem,
  opts: {
    /** design_create advance — submit for review moves the design on (ADR-231). */
    canSubmit: boolean;
    /** design_create entry — Log Time writes a time row. */
    canLogTime: boolean;
    /** design_create approve — Approve / Revise a design under Review. */
    canApprove: boolean;
    canEdit: boolean;
    onLogTime: (row: DesignTrackerListItem) => void;
    onEdit: (row: DesignTrackerListItem) => void;
    onSubmit: (row: DesignTrackerListItem) => void;
    onApprove: (row: DesignTrackerListItem) => void;
    onRevise: (row: DesignTrackerListItem) => void;
  },
): RowMenuItem[] {
  const {
    canSubmit,
    canLogTime,
    canApprove,
    canEdit,
    onLogTime,
    onEdit,
    onSubmit,
    onApprove,
    onRevise,
  } = opts;
  return [
    {
      key: 'log',
      label: 'Log Time',
      icon: 'plus',
      hidden: !canLogTime,
      onSelect: () => onLogTime(row),
    },
    {
      key: 'edit',
      label: 'Edit',
      icon: 'pencil',
      hidden: !canEdit || row.status === 'Approved',
      onSelect: () => onEdit(row),
    },
    {
      key: 'submit',
      label: 'Submit',
      icon: 'check',
      group: 'workflow',
      hidden: !canSubmit || row.status !== 'In Progress',
      onSelect: () => onSubmit(row),
    },
    {
      key: 'approve',
      label: 'Approve',
      icon: 'check',
      group: 'workflow',
      hidden: !canApprove || row.status !== 'Review',
      onSelect: () => onApprove(row),
    },
    {
      // Sends the design back for revision — red, as the old button was.
      key: 'revise',
      label: 'Revise',
      icon: 'arrow-left',
      group: 'danger',
      hidden: !canApprove || row.status !== 'Review',
      onSelect: () => onRevise(row),
    },
  ];
}
