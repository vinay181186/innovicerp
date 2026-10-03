// Pending SO Value — the fit table's columns, money formatter and row tint
// (ADR-199 table standard 2026-10-01). Split out of routes/list.tsx so that
// file stays under the 400-line ceiling and the sheet is defined in one place.
//
// One row per SO, every fact its own one-line column. The first column (SO No.)
// is always pinned and carries the row's ▸. The four money columns carry the
// engine's column-following `total`, so each total sits under its own column and
// moves with it into ▸ (replacing the old hand-written <tfoot>). The last three
// ids (so_date, invoiced_value, received_value) are default-hidden, so they live
// in the row's ▸ detail. Labels per docs/NAMING.md (Due Date, Value to Dispatch,
// Outstanding Amount).
//
// ADR-201: the list shows 25 rows a page, so the totals row prints the SERVER's
// totals over every matching SO (never a sum of the page), and each column's
// `sortFilterField` is its field in the server's Sort & Filter map.

import type { PendingSoValueResponse, PendingSoValueRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import type { DataTableColumn } from '@/ui/data';
import { ROW_TINT } from '@/ui/data';
import { soStatusLabel } from '@/modules/sales-orders/lib/so-status-label';

// Legacy colours the Invoiced figures `var(--teal,#0d9488)` (L19338). `--teal`
// is now a real token (tokens.css), so the hex fallback is dropped.
export const TEAL = 'var(--teal)';

export const inr = (v: string | number | null): string => {
  if (v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

type PsvTotals = PendingSoValueResponse['totals'];

/** SO status tick list for Sort & Filter (stored value + label). */
const STATUS_OPTIONS = ['draft', 'open', 'dispatched', 'closed', 'cancelled'].map((value) => ({
  value,
  label: soStatusLabel(value),
}));

/** A row is overdue when its Due Date has passed and value is still to dispatch
 *  (the same rule the Due Date cell and the row tint both read). */
function isOverdue(row: PendingSoValueRow, today: string): boolean {
  return row.dueDate !== null && row.dueDate < today && Number(row.pendingValue ?? 0) > 0;
}

// Whole-row wash by the REAL SO status enum (ADR-199 ROW_TINT):
//   cancelled → grey · draft → amber · overdue (open, past due, value left) →
//   red · closed / dispatched → green · everything else → no wash.
export function psvRowTint(row: PendingSoValueRow, today: string): string | undefined {
  if (row.status === 'cancelled') return ROW_TINT.cancelled;
  if (row.status === 'draft') return ROW_TINT.pending;
  if (isOverdue(row, today)) return ROW_TINT.late;
  if (row.status === 'closed' || row.status === 'dispatched') return ROW_TINT.done;
  return undefined;
}

// App status colours: Open → blue, Closed / Dispatched → green, anything
// else (Draft, Cancelled) → grey.
function badgeColor(status: string): string {
  if (status === 'open') return 'blue';
  if (status === 'closed' || status === 'dispatched') return 'green';
  return 'grey';
}

/**
 * The fit table's columns. Money hidden for L1 Viewers: the API nulls every
 * value, so the four money columns (and the two in ▸) are dropped. Told by the
 * server (priceHidden), not inferred from a null — a null also means "no value
 * yet".
 */
export function psvColumns(
  priceHidden: boolean,
  today: string,
  /** Server totals over every matching SO (undefined while loading). */
  totals: PsvTotals | undefined,
): DataTableColumn<PendingSoValueRow>[] {
  const sum = (k: keyof Omit<PsvTotals, 'soCount'>): number => Number(totals?.[k] ?? 0);
  const cols: DataTableColumn<PendingSoValueRow>[] = [
    {
      id: 'so_no',
      sortFilterField: 'soCode',
      filterType: 'text',
      header: 'SO No.',
      nowrap: true,
      // The row's ▸ opens the detail; the SO No. link opens the SO. The row
      // click also opens the SO, so the link stops the click to avoid a
      // double-navigate.
      render: (r) => (
        <Link
          to="/sales-orders/$id"
          params={{ id: r.soId }}
          className="td-code"
          title="Open the Sales Order"
          onClick={(e) => e.stopPropagation()}
        >
          {soNoWithInternal(r.soCode, r.soInternalNo)}
        </Link>
      ),
    },
    {
      id: 'customer',
      sortFilterField: 'customerName',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (r) => r.customerName ?? '—',
      title: (r) => r.customerName ?? '',
    },
    {
      id: 'due_date',
      sortFilterField: 'dueDate',
      kind: 'date',
      header: 'Due Date',
      className: 'mono',
      nowrap: true,
      render: (r) => {
        if (!r.dueDate) return <span className="text2">—</span>;
        const overdue = isOverdue(r, today);
        return (
          <span
            style={{
              color: overdue ? 'var(--red)' : 'var(--text2)',
              fontWeight: overdue ? 700 : undefined,
            }}
          >
            {fmtDate(r.dueDate)}
            {overdue ? ' ⚠' : ''}
          </span>
        );
      },
    },
  ];

  if (!priceHidden) {
    cols.push(
      {
        id: 'order_value',
        sortFilterField: 'orderValue',
        filterType: 'num',
        header: 'Order Value',
        align: 'right',
        className: 'mono',
        nowrap: true,
        render: (r) => inr(r.orderValue),
        total: inr(sum('orderValue')),
      },
      {
        id: 'dispatched_value',
        sortFilterField: 'dispatchedValue',
        filterType: 'num',
        header: 'Dispatched Value',
        align: 'right',
        className: 'mono',
        nowrap: true,
        headColor: 'var(--green)',
        render: (r) => <span style={{ color: 'var(--green2)' }}>{inr(r.dispatchedValue)}</span>,
        total: <span style={{ color: 'var(--green2)' }}>{inr(sum('dispatchedValue'))}</span>,
      },
      {
        id: 'value_to_dispatch',
        sortFilterField: 'pendingValue',
        filterType: 'num',
        header: <span title="Order Value − Dispatched Value">Value to Dispatch</span>,
        label: 'Value to Dispatch',
        align: 'right',
        className: 'mono fw-700',
        nowrap: true,
        headColor: 'var(--amber2)',
        render: (r) => {
          const p = Number(r.pendingValue ?? 0);
          return (
            <span style={{ color: p > 0 ? 'var(--amber)' : 'var(--green)' }}>
              {inr(r.pendingValue)}
            </span>
          );
        },
        total: <span style={{ color: 'var(--amber2)' }}>{inr(sum('pendingValue'))}</span>,
      },
      {
        id: 'outstanding',
        sortFilterField: 'outstandingValue',
        filterType: 'num',
        header: 'Outstanding Amount',
        align: 'right',
        className: 'mono',
        nowrap: true,
        render: (r) => {
          const o = Number(r.outstandingValue ?? 0);
          return (
            <span style={{ color: o > 0 ? 'var(--red)' : 'var(--green)' }}>
              {inr(r.outstandingValue)}
            </span>
          );
        },
        total: (
          <span style={{ color: sum('outstandingValue') > 0 ? 'var(--red)' : 'var(--green)' }}>
            {inr(sum('outstandingValue'))}
          </span>
        ),
      },
    );
  }

  cols.push({
    id: 'status',
    sortFilterField: 'status',
    filterOptions: STATUS_OPTIONS,
    kind: 'badge',
    header: 'SO Status',
    nowrap: true,
    render: (r) => (
      <span className={`badge b-${badgeColor(r.status)}`}>{soStatusLabel(r.status)}</span>
    ),
  });

  // Default-hidden → the row's ▸ detail: SO Date, then (when priced) Invoiced
  // Value and Received.
  cols.push({
    id: 'so_date',
    sortFilterField: 'soDate',
    kind: 'date',
    header: 'SO Date',
    className: 'mono text2',
    nowrap: true,
    render: (r) => fmtDate(r.soDate),
  });
  if (!priceHidden) {
    cols.push(
      {
        id: 'invoiced_value',
        sortFilterField: 'invoicedValue',
        filterType: 'num',
        header: 'Invoiced Value',
        align: 'right',
        className: 'mono',
        nowrap: true,
        render: (r) => <span style={{ color: TEAL }}>{inr(r.invoicedValue)}</span>,
      },
      {
        id: 'received_value',
        sortFilterField: 'receivedValue',
        filterType: 'num',
        header: 'Received',
        align: 'right',
        className: 'mono',
        nowrap: true,
        render: (r) => <span style={{ color: 'var(--green2)' }}>{inr(r.receivedValue)}</span>,
      },
    );
  }

  return cols;
}
