// SO Overview list columns (ADR-199 shared FIT table). One line per open SO:
// the fit engine sizes the columns to the screen and drops the default-hidden
// facts — Client PO No. / Equipment / Lines / SO Date — into the ▸ detail row.
// Split out of routes/list.tsx to keep that file under the 400-line rule.
//
// Everything the old hand-rolled table showed is still here: the SO No. links
// to the SO (the row itself opens the SO Status page), the progress bar keeps
// its status colour (legacy L9122/L9148), the Order / Completed / Pending
// quantities keep their green/red semantics, and the alert flags keep their
// order ⚠ delayed → 🏭 at-vendor → 🔬 QC → 🚫 blocked.

import type { SoOverallStatus, SoOverviewRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate, todayIst } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import { ProgressBar, ROW_TINT, type DataTableColumn } from '@/ui/data';

/** Column ids shown inside the ▸ detail row by default (fit engine
 *  `defaultHidden`): Client PO No., Equipment, Lines, SO Date. */
export const SO_OVERVIEW_DEFAULT_HIDDEN = ['client_po', 'equipment', 'lines', 'so_date'];

const STATUS_BADGE: Record<SoOverallStatus, { cls: string; label: string }> = {
  not_started: { cls: 'b-grey', label: 'Not Started' },
  in_progress: { cls: 'b-amber', label: 'In Progress' },
  on_track: { cls: 'b-blue', label: 'On Track' },
  delayed: { cls: 'b-red', label: 'Delayed' },
  completed: { cls: 'b-green', label: 'Completed' },
  blocked: { cls: 'b-red', label: 'Blocked' },
};

/**
 * Row tint by the derived progress status (ADR-199 Wave A, ROW_TINT): a soft
 * wash across the whole row so the floor reads the state at a glance. On Track
 * stays untinted (plain white) — there is no "all good" tint, and amber would
 * wrongly read as a warning.
 */
export function soRowTint(status: SoOverallStatus): string | undefined {
  switch (status) {
    case 'completed':
      return ROW_TINT.done;
    case 'delayed':
    case 'blocked':
      return ROW_TINT.late;
    case 'in_progress':
      return ROW_TINT.pending;
    case 'not_started':
      return ROW_TINT.cancelled;
    case 'on_track':
      return undefined;
  }
}

/** Legacy colours the progress bar by overall STATUS, not by percentage
 *  (L9122 / L9148): Delayed → red, Completed → green, On Track → blue,
 *  everything else amber. */
function barColor(status: SoOverallStatus): string {
  return status === 'delayed'
    ? 'var(--red)'
    : status === 'completed'
      ? 'var(--green)'
      : status === 'on_track'
        ? 'var(--blue)'
        : 'var(--amber)';
}

/** The same status colours as text — the "2" variants, which hold contrast. */
function barTextColor(status: SoOverallStatus): string {
  return status === 'delayed'
    ? 'var(--red2)'
    : status === 'completed'
      ? 'var(--green2)'
      : 'var(--cyan)';
}

function ProgressCell({ row }: { row: SoOverviewRow }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 120 }}>
      <ProgressBar
        value={row.overallPct}
        color={barColor(row.overallStatus)}
        label="SO progress"
        style={{ flex: 1 }}
      />
      <span
        className="mono fw-700"
        style={{ fontSize: 11, color: barTextColor(row.overallStatus) }}
      >
        {row.overallPct}%
      </span>
    </div>
  );
}

/** Alerts as plain coloured spans (legacy L9135), in the order ⚠ delayed →
 *  🏭 at-vendor → 🔬 QC → 🚫 blocked, falling back to an em-dash. */
function AlertFlags({ row }: { row: SoOverviewRow }): React.JSX.Element {
  const flags: React.ReactNode[] = [];
  if (row.alerts.delayedLines > 0) {
    flags.push(
      <span
        key="delayed"
        style={{ color: 'var(--red2)', fontWeight: 700, fontSize: 11 }}
        title="Lines past due"
      >
        ⚠{row.alerts.delayedLines}
      </span>,
    );
  }
  if (row.alerts.atVendorQty > 0) {
    flags.push(
      <span
        key="atvendor"
        style={{ color: 'var(--purple)', fontSize: 11 }}
        title="Qty at outsource vendor"
      >
        🏭{row.alerts.atVendorQty}
      </span>,
    );
  }
  if (row.alerts.qcPendingOps > 0) {
    flags.push(
      <span key="qcpend" style={{ color: 'var(--amber2)', fontSize: 11 }} title="Ops awaiting QC">
        🔬{row.alerts.qcPendingOps}
      </span>,
    );
  }
  if (row.stageCounts.hold > 0) {
    flags.push(
      <span key="hold" style={{ color: 'var(--red2)', fontSize: 11 }} title="Blocked lines">
        🚫{row.stageCounts.hold}
      </span>,
    );
  }
  if (flags.length === 0) {
    return (
      <span className="text3" style={{ fontSize: 11 }}>
        —
      </span>
    );
  }
  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{flags}</div>;
}

// Sort & Filter tick lists (server mode): stored code + the label shown.
const OVERALL_OPTIONS = Object.entries(STATUS_BADGE).map(([value, b]) => ({
  value,
  label: b.label,
}));
const SO_TYPE_OPTIONS = (['component_manufacturing', 'equipment', 'with_material'] as const).map(
  (value) => ({ value, label: soTypeLabel(value) }),
);

function soTypeLabel(type: SoOverviewRow['type']): string {
  return type === 'equipment'
    ? 'Equipment'
    : type === 'with_material'
      ? 'With Material'
      : 'Component';
}

export function soOverviewColumns(): DataTableColumn<SoOverviewRow>[] {
  return [
    {
      id: 'so_code',
      sortFilterField: 'code',
      header: 'SO No.',
      nowrap: true,
      render: (row) => (
        <Link
          to="/sales-orders/$id"
          params={{ id: row.id }}
          className="td-code"
          style={{ color: 'var(--cyan)', fontSize: 13, fontWeight: 800 }}
          onClick={(e) => e.stopPropagation()}
        >
          {soNoWithInternal(row.code, row.internalSoNo)}
        </Link>
      ),
    },
    {
      id: 'customer',
      sortFilterField: 'customerName',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (row) => row.customerName ?? '—',
      title: (row) => row.customerName ?? '',
    },
    {
      id: 'so_type',
      sortFilterField: 'type',
      filterType: 'list',
      filterOptions: SO_TYPE_OPTIONS,
      header: 'SO Type',
      nowrap: true,
      render: (row) => <span style={{ fontSize: 11 }}>{soTypeLabel(row.type)}</span>,
    },
    {
      id: 'progress_status',
      sortFilterField: 'overallStatus',
      filterOptions: OVERALL_OPTIONS,
      kind: 'badge',
      header: 'Progress Status',
      nowrap: true,
      render: (row) => {
        const badge = STATUS_BADGE[row.overallStatus];
        return <span className={`badge ${badge.cls}`}>{badge.label}</span>;
      },
    },
    {
      id: 'progress',
      sortFilterField: 'overallPct',
      filterType: 'num',
      header: 'Progress',
      minWidth: 150,
      render: (row) => <ProgressCell row={row} />,
    },
    {
      id: 'order_qty',
      sortFilterField: 'totalRequiredQty',
      kind: 'num',
      header: 'Order Qty',
      nowrap: true,
      render: (row) => <span className="mono fw-700">{row.totalRequiredQty}</span>,
    },
    {
      id: 'completed',
      sortFilterField: 'totalDoneQty',
      kind: 'num',
      header: 'Completed',
      headColor: 'var(--green)',
      nowrap: true,
      render: (row) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {row.totalDoneQty}
        </span>
      ),
    },
    {
      id: 'pending',
      sortFilterField: 'totalBalanceQty',
      kind: 'num',
      header: 'Pending',
      headColor: 'var(--red)',
      nowrap: true,
      render: (row) => (
        <span
          className="mono fw-700"
          style={{ color: row.totalBalanceQty > 0 ? 'var(--red2)' : 'var(--green2)' }}
        >
          {row.totalBalanceQty}
        </span>
      ),
    },
    {
      id: 'due_date',
      sortFilterField: 'earliestDueDate',
      kind: 'date',
      header: 'Due Date',
      nowrap: true,
      render: (row) => {
        const overdue =
          row.earliestDueDate !== null &&
          row.earliestDueDate < todayIst() &&
          row.overallStatus !== 'completed';
        return (
          <span style={{ fontWeight: 700, color: overdue ? 'var(--red2)' : 'var(--text)' }}>
            {fmtDate(row.earliestDueDate)}
          </span>
        );
      },
    },
    {
      id: 'alerts',
      header: 'Alerts',
      render: (row) => <AlertFlags row={row} />,
    },
    // ── ▸ detail row (SO_OVERVIEW_DEFAULT_HIDDEN) ─────────────────────────────
    {
      id: 'client_po',
      sortFilterField: 'clientPoNo',
      filterType: 'text',
      kind: 'code',
      header: 'Client PO No.',
      nowrap: true,
      render: (row) =>
        row.clientPoNo ? (
          <span className="mono text2">{row.clientPoNo}</span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'equipment',
      sortFilterField: 'equipmentItemName',
      header: 'Equipment',
      align: 'left',
      ellipsis: true,
      render: (row) =>
        row.equipmentItemName ? (
          <span style={{ color: 'var(--purple)' }}>{row.equipmentItemName}</span>
        ) : (
          <span className="text3">—</span>
        ),
      title: (row) => row.equipmentItemName ?? '',
    },
    {
      id: 'lines',
      sortFilterField: 'lineCount',
      kind: 'num',
      header: 'Lines',
      nowrap: true,
      render: (row) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {row.lineCount}
        </span>
      ),
    },
    {
      id: 'so_date',
      sortFilterField: 'soDate',
      kind: 'date',
      header: 'SO Date',
      nowrap: true,
      render: (row) => <span className="text2">{fmtDate(row.soDate)}</span>,
    },
  ];
}
