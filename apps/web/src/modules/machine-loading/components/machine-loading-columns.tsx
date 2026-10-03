// Machine Loading — the open-operations fit table (ADR-199 table standard
// 2026-10-01). One ruled sheet, JC No. pinned first and carrying the row's ▸
// reveal, every primary fact its own one-line column, the secondary facts in
// the ▸ detail. Split out of routes/list.tsx so that file stays under the
// 400-line ceiling. Labels per docs/NAMING.md.

import type { MachineLoadOp } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ActualMachineLine } from '@/components/shared/machine-split';
import { SoNo } from '@/components/shared/so-no';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { OP_STATUS } from '@/modules/job-cards/lib/jc-op-labels';
import { ROW_TINT } from '@/ui/data';

// Op Status tick list for the server Sort & Filter (non-complete states only:
// the table never holds a complete op).
const OP_STATUS_OPTIONS = Object.entries(OP_STATUS)
  .filter(([value]) => value !== 'complete')
  .map(([value, s]) => ({ value, label: s.label }));
import type { DataTableColumn } from '@/ui/data';

// Op status words + colours: the ONE shared map (job-cards/lib/jc-op-labels).
export function OpStatusBadge({ status }: { status: string }): React.JSX.Element {
  const known = OP_STATUS[status];
  const label = known?.label ?? status.replaceAll('_', ' ');
  return <span className={`badge ${known?.cls || 'b-grey'}`}>{label}</span>;
}

/**
 * Whole-row wash by the REAL op status only (ADR-199 ROW_TINT): a status that
 * maps to a tint semantic gets washed, the rest (under way: available /
 * running / in progress) stay plain.
 *   complete                 → done    (green)
 *   qc_pending / waiting     → pending (amber, not yet moving)
 */
export function opRowTint(op: MachineLoadOp): string | undefined {
  if (op.computedStatus === 'complete') return ROW_TINT.done;
  if (op.computedStatus === 'qc_pending' || op.computedStatus === 'waiting')
    return ROW_TINT.pending;
  return undefined;
}

// The sheet's columns (ADR-199 table standard): every row is ONE line, the fit
// engine sizes the columns to the screen and drops the rightmost unpinned ones
// into ▸ when it is too narrow. Centred by the standard; numbers right-aligned;
// the Operation name is the one free-text column (left + ellipsis).
export function opsColumns(): DataTableColumn<MachineLoadOp>[] {
  return [
    {
      id: 'jc_code',
      header: 'JC No.',
      nowrap: true,
      sortFilterField: 'jcCode',
      // The row's ▸ (fit engine) opens the detail reveal; the JC No. link opens
      // the job card. stopPropagation on the link, not the cell, so clicking
      // the rest of the cell still opens the row.
      render: (op) => (
        <Link
          to="/job-cards/$id"
          params={{ id: op.jobCardId }}
          className="td-code cyan"
          title="View job card status"
          style={{ color: 'inherit', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {op.jobCardCode}
        </Link>
      ),
    },
    {
      id: 'op_seq',
      header: 'Op',
      kind: 'code',
      sortFilterField: 'opSeq',
      filterType: 'num',
      className: 'mono',
      nowrap: true,
      render: (op) => opSrNo(op.opSeq),
    },
    {
      id: 'operation',
      kind: 'text',
      header: 'Operation',
      sortFilterField: 'operation',
      align: 'left',
      ellipsis: true,
      render: (op) => op.operation,
      title: (op) => op.operation,
    },
    {
      id: 'item_code',
      header: 'Item Code',
      sortFilterField: 'itemCode',
      className: 'mono fw-700',
      nowrap: true,
      // `CODE/REV` — the customer's drawing revision from the SO line this card
      // was raised against; a JW-sourced / standalone card keeps the bare code.
      render: (op) => itemCodeWithRev(op.itemCode, op.itemRevision),
    },
    {
      id: 'available',
      header: 'Available',
      sortFilterField: 'available',
      filterType: 'num',
      align: 'right',
      headColor: 'var(--amber)',
      nowrap: true,
      render: (op) => (
        <span
          className="mono fw-700"
          style={{ color: op.available > 0 ? 'var(--amber)' : 'var(--text3)' }}
        >
          {op.available}
        </span>
      ),
    },
    {
      id: 'pending_hrs',
      header: 'Pending Hrs',
      sortFilterField: 'pendingHrs',
      filterType: 'num',
      align: 'right',
      headColor: 'var(--red)',
      nowrap: true,
      render: (op) => (
        <span className="mono fw-700" style={{ color: 'var(--red2)' }}>
          {op.pendingHrs}h
        </span>
      ),
    },
    {
      id: 'op_status',
      kind: 'badge',
      header: 'Op Status',
      sortFilterField: 'opStatus',
      filterOptions: OP_STATUS_OPTIONS,
      nowrap: true,
      render: (op) => <OpStatusBadge status={op.computedStatus} />,
    },
    {
      id: 'due_date',
      kind: 'date',
      header: 'Due',
      sortFilterField: 'dueDate',
      className: 'mono text2',
      nowrap: true,
      render: (op) => fmtDate(op.dueDate),
    },
  ];
}

/** One labelled fact in the ▸ reveal. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ minWidth: 120 }}>
      <div
        className="text3"
        style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

/**
 * The ▸ reveal: the secondary facts kept off the row — POL, Item Name, SO No.,
 * Priority, JC Qty, Completed (with the per-machine actual-vs-planned line).
 */
export function OpsExpanded({ op }: { op: MachineLoadOp }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '10px 14px' }}>
      <Field label="POL">
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {op.clientPoLineNo ?? '—'}
        </span>
      </Field>
      <Field label="Item Name">{op.itemName?.trim() || '—'}</Field>
      <Field label="SO No.">
        {op.soCode ? <SoNo code={op.soCode} internal={op.soInternalNo} className="mono" /> : '—'}
      </Field>
      <Field label="Priority">
        <span className={`badge ${op.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
          {op.priority === 'high' ? 'High' : 'Normal'}
        </span>
      </Field>
      <Field label="JC Qty">
        <span className="mono fw-700">{op.orderQty}</span>
      </Field>
      <Field label="Completed">
        <span className="mono fw-700 green">{op.completedQty}</span>
        {/* ADR-164 — the op is listed under its PLANNED machine, so say which
            machine ACTUALLY made this figure: same name when nothing changed,
            amber when it differs, with the per-machine breakdown for a split. */}
        <ActualMachineLine planned={op.machineCode} machines={op.machines} />
      </Field>
    </div>
  );
}
