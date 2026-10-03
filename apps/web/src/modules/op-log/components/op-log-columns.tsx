// Operation Log list columns (ADR-199 fit table: one line per row). Moved out
// of routes/list.tsx. Item Code and Item Name are two columns (the name used to
// stack under the code), and the ADR-197 reversal badge + its reason left the
// Log Type cell for two columns of their own at the right, so they are the
// first to move into ▸ on a narrow screen.

import { opSrNo, SHIFT_LABELS, type Shift } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { DocRefLink } from '@/modules/activity-log/components/doc-ref-link';
import type { DataTableColumn } from '@/ui/data';
import type { OpLogListItem } from '../api';

const LOG_TYPE_LABEL: Record<'start' | 'complete' | 'qc', string> = {
  start: 'Start',
  complete: 'Completed',
  qc: 'QC Inspection',
};

function logTypeBadge(t: 'start' | 'complete' | 'qc'): string {
  if (t === 'start') return 'b-amber';
  if (t === 'qc') return 'b-purple';
  return 'b-green';
}

/** A reversal row: it names the entry it cancels, or (older payloads) it
 *  carries a negative figure. */
export function isReversalRow(r: OpLogListItem): boolean {
  return Boolean(r.reversalOfId) || r.qty < 0 || r.rejectQty < 0;
}

/** Log No. and JC No. both open the job card the entry was logged against —
 *  straight to /job-cards/$id when the row carries the card's id (ADR-190
 *  addendum), else resolved from the JC number through search. */
function jcLink(r: OpLogListItem, label: string): React.JSX.Element {
  return r.jobCardId ? (
    <Link
      to="/job-cards/$id"
      params={{ id: r.jobCardId }}
      className="mono fw-700"
      title={`Open ${r.jcNo}`}
    >
      {label}
    </Link>
  ) : (
    <DocRefLink entity="Job Card" refId={r.jcNo} label={label} />
  );
}

function differs(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.trim().toLowerCase() !== b.trim().toLowerCase());
}

export const OP_LOG_DEFAULT_PINNED = ['item_code'];

/** Columns off by default (DataTable `defaultHidden`); the Columns menu shows them. */
export const OP_LOG_HIDDEN_COLUMNS = ['created_on'] as const;

// Sort & Filter tick lists (ADR-200): the stored code + the label shown.
const LOG_TYPE_OPTIONS = (['start', 'complete', 'qc'] as const).map((value) => ({
  value,
  label: LOG_TYPE_LABEL[value],
}));
const SHIFT_OPTIONS = Object.entries(SHIFT_LABELS).map(([value, label]) => ({ value, label }));

/** Each `sortFilterField` is a field of the endpoint's column map
 *  (apps/api/src/modules/op-log-viewer/sf-columns.ts, ADR-200). The Reversal
 *  column has none: its label is built per row. */
export function opLogColumns(): DataTableColumn<OpLogListItem>[] {
  return [
    {
      id: 'log_no',
      sortFilterField: 'logNo',
      kind: 'code',
      header: 'Log No.',
      render: (r) => jcLink(r, r.logNo),
    },
    {
      id: 'jc_no',
      sortFilterField: 'jcNo',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code',
      render: (r) => jcLink(r, r.jcNo),
    },
    {
      // POL — the line number printed on the CUSTOMER's own purchase order,
      // immediately before the item. '—' when no sales order sits behind it.
      id: 'client_po_line_no',
      sortFilterField: 'clientPoLineNo',
      kind: 'code',
      header: 'POL',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (r) => <span style={{ color: 'var(--purple)' }}>{r.clientPoLineNo ?? '—'}</span>,
    },
    {
      // The item the card makes — a JC number says WHICH JOB, only this says
      // WHICH PART. The code is what anyone scans the log for: darkest token.
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      className: 'mono fw-700',
      render: (r) => (
        <span style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(r.itemCode, r.itemRevision, '')}
        </span>
      ),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (r) => r.itemName ?? '',
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'log_date',
      sortFilterField: 'logDate',
      kind: 'date',
      header: 'Log Date',
      className: 'text2',
      render: (r) => fmtDate(r.logDate),
    },
    {
      id: 'op_seq',
      sortFilterField: 'opSeq',
      filterType: 'num',
      kind: 'code',
      header: 'Op',
      className: 'mono',
      render: (r) => opSrNo(r.opSeq),
    },
    {
      id: 'log_type',
      sortFilterField: 'logType',
      filterOptions: LOG_TYPE_OPTIONS,
      kind: 'badge',
      header: 'Log Type',
      render: (r) => (
        <>
          <span className={`badge ${logTypeBadge(r.logType)}`}>{LOG_TYPE_LABEL[r.logType]}</span>
          {r.isTpi ? (
            <span className="badge b-purple" style={{ marginLeft: 4 }}>
              TPI
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'shift',
      sortFilterField: 'shift',
      filterType: 'list',
      filterOptions: SHIFT_OPTIONS,
      kind: 'code',
      header: 'Shift',
      className: 'text2',
      render: (r) => SHIFT_LABELS[r.shift as Shift] ?? r.shift,
    },
    {
      // ADR-164 — PLANNED is the op's jc_ops machine; ACTUAL is the machine
      // this entry was stamped with, amber only when it is not the plan.
      id: 'planned_machine',
      sortFilterField: 'plannedMachine',
      kind: 'code',
      header: 'Planned Machine',
      render: (r) => (
        <span className="tag" style={{ background: 'var(--bg4)', color: 'var(--cyan)' }}>
          {r.plannedMachineCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'actual_machine',
      sortFilterField: 'actualMachine',
      kind: 'code',
      header: 'Actual Machine',
      render: (r) => (
        <span
          className="tag"
          style={{
            background: 'var(--bg4)',
            color: differs(r.machineCode, r.plannedMachineCode) ? 'var(--amber)' : 'var(--cyan)',
          }}
        >
          {r.machineCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'operation',
      sortFilterField: 'operation',
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      render: (r) => r.operation ?? '—',
      title: (r) => r.operation ?? '',
    },
    {
      id: 'completed',
      sortFilterField: 'qty',
      kind: 'num',
      header: 'Completed',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (r) => {
        const reversed = Boolean(r.reversedById);
        return (
          <span
            style={{
              color: r.qty < 0 ? 'var(--red2)' : reversed ? 'var(--text3)' : 'var(--green2)',
              textDecoration: reversed ? 'line-through' : undefined,
            }}
          >
            {r.qty}
          </span>
        );
      },
    },
    {
      id: 'rejected',
      sortFilterField: 'rejectQty',
      kind: 'num',
      header: 'Deviated',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (r) => {
        const reversed = Boolean(r.reversedById);
        return (
          <span
            style={{
              color: r.rejectQty !== 0 && !reversed ? 'var(--red2)' : 'var(--text3)',
              textDecoration: reversed ? 'line-through' : undefined,
            }}
          >
            {r.rejectQty}
          </span>
        );
      },
    },
    {
      id: 'operator',
      sortFilterField: 'operatorName',
      kind: 'text',
      header: 'Operator',
      ellipsis: true,
      className: 'text2',
      render: (r) => r.operatorName ?? '—',
      title: (r) => r.operatorName ?? '',
    },
    {
      id: 'remarks',
      sortFilterField: 'remarks',
      kind: 'text',
      header: 'Remarks',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (r) => r.remarks ?? '',
      title: (r) => r.remarks ?? '',
    },
    {
      id: 'logged_by',
      sortFilterField: 'loggedBy',
      kind: 'text',
      header: 'Logged By',
      ellipsis: true,
      className: 'text3',
      render: (r) => r.createdByName ?? '—',
      title: (r) => r.createdByName ?? '',
    },
    {
      // ADR-197 — a reversal row names the entry it cancels; the original it
      // cancels names the reversal. Used to be a second line in Log Type.
      id: 'reversal',
      kind: 'badge',
      header: 'Reversal',
      render: (r) =>
        isReversalRow(r) ? (
          <span
            className="badge b-red"
            title={r.reversalReason ? `Reason: ${r.reversalReason}` : undefined}
          >
            Reversal of {r.reversalOfLogNo ?? 'an earlier entry'}
          </span>
        ) : r.reversedById ? (
          <span className="badge b-grey">Reversed by {r.reversedByLogNo ?? 'a later entry'}</span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'reversal_reason',
      sortFilterField: 'reversalReason',
      kind: 'text',
      header: 'Reversal Reason',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (r) => (isReversalRow(r) ? (r.reversalReason ?? '') : ''),
      title: (r) => r.reversalReason ?? '',
    },
    {
      // When the entry was typed in (IST day) — Sort & Filter can pick a range
      // of it (ADR-200). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'text2',
      nowrap: true,
      render: (r) => fmtDate(r.createdAt),
    },
  ];
}
