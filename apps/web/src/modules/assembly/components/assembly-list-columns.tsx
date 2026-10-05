// Assembly Tracker list columns (ADR-199 fit table). Moved out of
// routes/list.tsx to keep it under 400 lines. `sortFilterField` = the field in
// the endpoint's Sort & Filter map (apps/api/.../assembly/list-rows.ts);
// Assembled / Dispatched / Assembly Status are worked out per SO after the
// query, so they have no ▾ (status has the dropdown instead).

import type { AssemblyListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { ROW_TINT, type DataTableColumn } from '@/ui/data';

type StatusKey = AssemblyListItem['status'];

// Status colours follow the app rule (R5 PR-N50): Waiting grey, Ready (awaiting
// the next step) blue, In Assembly amber, Completed green.
const STATUS_BADGE_CLASS: Record<StatusKey, string> = {
  waiting: 'b-grey',
  ready: 'b-blue',
  assembling: 'b-amber',
  done: 'b-green',
};

// Row wash by the real status enum (ADR-199 ROW_TINT). Follows the GRN list's
// pattern: the blocked/pending end (waiting on components) washes amber, the
// finished end (done) washes green, and the active middle (ready / assembling)
// stays untinted so the badge carries the signal there. No blue tint exists.
export const ROW_TINT_BY_STATUS: Record<StatusKey, string | undefined> = {
  waiting: ROW_TINT.pending,
  ready: undefined,
  assembling: undefined,
  done: ROW_TINT.done,
};

// Legacy badge text (L28778–28781). The waiting variant's "— <ready>/<total>"
// component counter used to be dropped because the list payload carried no
// readiness figures; listAssemblies now computes them (batched), so it reads
// exactly as legacy does.
export function statusBadgeLabel(row: AssemblyListItem): string {
  switch (row.status) {
    case 'ready':
      return 'Ready';
    case 'assembling':
      return `In Assembly ${row.assembledQty}/${row.orderQty}`;
    case 'done':
      return `Completed ${row.assembledQty}/${row.orderQty}`;
    case 'waiting':
      return row.totalCount > 0 ? `Waiting — ${row.readyCount}/${row.totalCount}` : 'Waiting';
  }
}

export function assemblyListColumns(today: string): DataTableColumn<AssemblyListItem>[] {
  return [
    {
      id: 'so_no',
      sortFilterField: 'soCode',
      header: 'SO No.',
      kind: 'code',
      nowrap: true,
      // The per-SO tracker opens from the row; the link is the same target —
      // no chevron of its own (the fit ▸ owns expand, ADR-199).
      render: (row) => (
        <Link
          to="/assemblies/$soId"
          params={{ soId: row.soId }}
          className="td-code"
          style={{ color: 'var(--cyan)', fontWeight: 600 }}
          onClick={(e) => e.stopPropagation()}
        >
          {row.soCode}
        </Link>
      ),
    },
    {
      // ADR-207 — the office's own number, its OWN column beside the system
      // SO No. (owner decision 2026-10-05). Many older orders have none.
      id: 'so_internal_no',
      header: 'Internal SO No.',
      kind: 'code',
      sortFilterField: 'soInternalNo',
      nowrap: true,
      render: (row) =>
        row.soInternalNo?.trim() ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {row.soInternalNo}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'customer',
      sortFilterField: 'customerName',
      header: 'Customer',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (row) => row.customerName ?? '—',
      title: (row) => row.customerName ?? '',
    },
    {
      id: 'bom_no',
      sortFilterField: 'bomCode',
      header: 'BOM No.',
      nowrap: true,
      render: (row) => (
        <span className="text3" style={{ fontSize: 12 }}>
          {row.bomCode ?? '—'}
          {/* Loose != null on purpose: web and API deploy independently, so for
                a few minutes the old API returns no bomRevision. Strict !== null
                would print "Rev undefined". */}
          {row.bomRevision != null ? ` BOM Rev ${row.bomRevision}` : ''}
        </span>
      ),
    },
    {
      id: 'due',
      sortFilterField: 'dueDate',
      header: 'Due Date',
      kind: 'date',
      nowrap: true,
      render: (row) => {
        const overdue = row.dueDate !== null && row.dueDate < today && row.status !== 'done';
        return (
          <span
            style={{
              color: overdue ? 'var(--red2)' : undefined,
              fontWeight: overdue ? 600 : undefined,
            }}
          >
            {fmtDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      id: 'required',
      sortFilterField: 'orderQty',
      header: 'Required',
      kind: 'num',
      align: 'right',
      render: (row) => row.orderQty,
    },
    {
      id: 'assembled',
      header: 'Assembled',
      kind: 'num',
      align: 'right',
      render: (row) => <span style={{ color: 'var(--green2)' }}>{row.assembledQty}</span>,
    },
    {
      id: 'dispatched',
      header: 'Dispatched',
      kind: 'num',
      align: 'right',
      render: (row) => <span style={{ color: 'var(--green2)' }}>{row.dispatchedQty}</span>,
    },
    {
      id: 'status',
      header: 'Assembly Status',
      kind: 'badge',
      nowrap: true,
      render: (row) => (
        <span className={`badge ${STATUS_BADGE_CLASS[row.status]}`}>{statusBadgeLabel(row)}</span>
      ),
    },
  ];
}
