// Op Entry approvals — columns + row actions for the ADR-199 fit table (one
// line per correction request, always fits the screen). Replaces the old card
// grid in log-entry-approvals.tsx. What stacked inside a card is now columns:
//   JC No. · Op · Item Code · Operation · Log Type · Machine ·
//   Prev → Requested · Entry Qty · Asked By · Status
// and the context that used to sit lower on the card drops into the ▸ detail:
//   POL · Item Name · Reason · Decided By (all hidden by default).
// Rows tint by status (approved = done, rejected = cancelled) via ROW_TINT.

import { type OpLogChangeStatus, type OpLogTimeChangeRequest, opSrNo } from '@innovic/shared';
import { fmtDateAndTime, fmtDateTime } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { ROW_TINT, type DataTableColumn } from '@/ui/data';
import { RowActions } from '@/ui/layout';

// Four context columns revealed under ▸ — never on the main line (brief).
export const OP_ENTRY_DEFAULT_HIDDEN = ['client_po_line_no', 'item_name', 'reason', 'decided_by'];

const LOG_TYPE_LABEL: Record<string, string> = {
  start: 'Start',
  complete: 'Completed',
  qc: 'QC',
};

// Sort & Filter (server mode, ADR-201): tick lists for the list columns.
const LOG_TYPE_OPTIONS = Object.entries(LOG_TYPE_LABEL).map(([value, label]) => ({ value, label }));

const when = (date: string, time: string | null): string => fmtDateAndTime(date, time);
const istStamp = (iso: string): string => fmtDateTime(iso);

const STATUS_BADGE: Record<OpLogChangeStatus, { cls: string; label: string }> = {
  pending: { cls: 'b-amber', label: 'Pending' },
  approved: { cls: 'b-green', label: 'Approved' },
  rejected: { cls: 'b-red', label: 'Rejected' },
};

/** Soft row wash by lifecycle — approved reads done, rejected reads struck out,
 *  a waiting request stays plain so the queue is what draws the eye. */
const STATUS_OPTIONS = Object.entries(STATUS_BADGE).map(([value, b]) => ({
  value,
  label: b.label,
}));

export function opEntryRowTint(r: OpLogTimeChangeRequest): string | undefined {
  if (r.status === 'approved') return ROW_TINT.done;
  if (r.status === 'rejected') return ROW_TINT.cancelled;
  return undefined;
}

export function opEntryColumns(): DataTableColumn<OpLogTimeChangeRequest>[] {
  return [
    {
      id: 'jc_no',
      sortFilterField: 'jcCode',
      kind: 'code',
      header: 'JC No.',
      className: 'mono fw-700',
      render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.jobCardCode}</span>,
    },
    {
      id: 'op_seq',
      sortFilterField: 'opSeq',
      filterType: 'num',
      kind: 'code',
      header: 'Op',
      className: 'mono fw-700',
      render: (r) => opSrNo(r.opSeq),
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      className: 'mono fw-700',
      render: (r) =>
        r.itemCode ? (
          <span style={{ color: 'var(--text)' }}>
            {itemCodeWithRev(r.itemCode, r.itemRevision, '')}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'operation',
      sortFilterField: 'operation',
      kind: 'text',
      header: 'Operation',
      align: 'left',
      ellipsis: true,
      render: (r) => r.operation,
      title: (r) => r.operation,
    },
    {
      id: 'log_type',
      sortFilterField: 'logType',
      filterOptions: LOG_TYPE_OPTIONS,
      kind: 'badge',
      header: 'Log Type',
      render: (r) => LOG_TYPE_LABEL[r.logType] ?? r.logType,
    },
    {
      id: 'machine',
      sortFilterField: 'machine',
      kind: 'code',
      header: 'Machine',
      className: 'mono',
      render: (r) => r.machineCode ?? '—',
    },
    {
      id: 'prev_requested',
      sortFilterField: 'requestedLogDate',
      filterType: 'date',
      kind: 'text',
      header: 'Prev → Requested',
      align: 'left',
      nowrap: true,
      render: (r) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {/* The entry was retimed since this request was raised, so the "prev"
              value no longer matches the live row. Approving still writes the
              requested value — the ⚠ just flags it. */}
          {r.status === 'pending' && r.isStale ? (
            <span style={{ color: 'var(--amber2)' }} title="Entry changed since this was asked">
              ⚠{' '}
            </span>
          ) : null}
          {when(r.prevLogDate, r.prevStartTime)}
          <span className="text3"> → </span>
          <span style={{ color: 'var(--amber2)', fontWeight: 700 }}>
            {when(r.requestedLogDate, r.requestedStartTime)}
          </span>
        </span>
      ),
      title: (r) =>
        `${r.status === 'pending' && r.isStale ? '⚠ entry changed since asked — ' : ''}${when(r.prevLogDate, r.prevStartTime)} → ${when(r.requestedLogDate, r.requestedStartTime)}`,
    },
    {
      id: 'entry_qty',
      sortFilterField: 'entryQty',
      kind: 'num',
      header: 'Entry Qty',
      align: 'right',
      className: 'mono',
      render: (r) => r.qty,
    },
    {
      id: 'asked_by',
      sortFilterField: 'askedBy',
      kind: 'text',
      header: 'Asked By',
      align: 'left',
      ellipsis: true,
      render: (r) => r.requestedByName ?? '—',
      title: (r) => `${r.requestedByName ?? '—'} · ${istStamp(r.requestedAt)}`,
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'Status',
      render: (r) => {
        const b = STATUS_BADGE[r.status];
        return <span className={`badge ${b.cls}`}>{b.label}</span>;
      },
    },
    // ─── ▸ detail (hidden by default) ────────────────────────────────────────
    {
      id: 'client_po_line_no',
      sortFilterField: 'clientPoLineNo',
      kind: 'code',
      header: 'POL',
      className: 'mono fw-700',
      render: (r) =>
        r.clientPoLineNo ? <span style={{ color: 'var(--purple)' }}>{r.clientPoLineNo}</span> : '—',
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      className: 'text3',
      render: (r) => r.itemName ?? '—',
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'reason',
      sortFilterField: 'reason',
      kind: 'text',
      header: 'Reason',
      align: 'left',
      className: 'text3',
      render: (r) => (r.reason ? `“${r.reason}”` : '—'),
      title: (r) => r.reason ?? '',
    },
    {
      id: 'decided_by',
      sortFilterField: 'decidedBy',
      kind: 'text',
      header: 'Decided By',
      align: 'left',
      className: 'text3',
      render: (r) => {
        if (!r.decidedByName && !r.decidedAt) return '—';
        return (
          <span>
            {r.decidedByName ?? '—'}
            {r.decidedAt ? <span className="text3"> · {istStamp(r.decidedAt)}</span> : null}
            {r.decisionReason ? <span className="text3"> — “{r.decisionReason}”</span> : null}
          </span>
        );
      },
      title: (r) =>
        [r.decidedByName, r.decidedAt ? istStamp(r.decidedAt) : null, r.decisionReason]
          .filter(Boolean)
          .join(' · '),
    },
  ];
}

export interface OpEntryActionProps {
  busy: boolean;
  /** Return the decide Promise: the row's ⋯ stays busy until it settles. */
  onApprove: (r: OpLogTimeChangeRequest) => void | Promise<void>;
  onReject: (r: OpLogTimeChangeRequest) => void;
}

/** Approve / Reject for a waiting request, in the row's ⋯ menu (Approve under
 *  Workflow, Reject red after a line). Both grey out on EVERY row while one
 *  decision is in flight. Decided rows carry no actions — their outcome reads
 *  off the Status badge and the ▸ Decided By detail. */
export function OpEntryRowActions({
  r,
  p,
}: {
  r: OpLogTimeChangeRequest;
  p: OpEntryActionProps;
}): React.JSX.Element | null {
  if (r.status !== 'pending') return null;
  const disabledReason = p.busy ? 'Working…' : undefined;
  return (
    <RowActions
      items={[
        {
          key: 'approve',
          label: 'Approve',
          icon: 'check',
          group: 'workflow',
          disabledReason,
          onSelect: () => p.onApprove(r),
        },
        {
          key: 'reject',
          label: 'Reject',
          icon: 'x',
          group: 'danger',
          disabledReason,
          onSelect: () => p.onReject(r),
        },
      ]}
    />
  );
}
