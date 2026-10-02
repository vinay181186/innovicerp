// Approval Rules — the "Recent Approval Activity" history table, on the shared
// FIT table (ADR-199: <DataTable tableKey=…>). Split out of routes/page.tsx so
// that file stays under the 400-line ceiling; only the history data table moved
// here — the approval-config FORM (switches, approvers, limits) stays in page.tsx
// untouched.
//
// Columns (first = date/time): Action Date & Time · Action · Document Type ·
// Details · User. The last-20 rows load in one fetch, so the column ▾ sort /
// filter works over the whole list.

import type { ApprovalHistoryItem } from '@innovic/shared';
import { fmtDateTime } from '@/lib/date';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useApprovalHistory } from '../api';

// Screen word for the logged action code (APPROVE / REJECT / PAYMENT).
function actionLabel(action: string): string {
  if (action === 'APPROVE') return 'Approved';
  if (action === 'REJECT') return 'Rejected';
  if (action === 'PAYMENT') return 'Payment';
  return action;
}

// Screen word for the logged document type. The server writes 'Purchase Order'
// and 'Invoice' already spaced, but 'PurchaseRequest' as a raw code.
const DOC_TYPE_LABELS: Record<string, string> = {
  PurchaseRequest: 'Purchase Request',
  'Purchase Order': 'Purchase Order',
  Invoice: 'Invoice',
};

function docTypeLabel(entity: string): string {
  const known = DOC_TYPE_LABELS[entity];
  if (known) return known;
  // Fallback: split camelCase / snake_case and title-case each word.
  return entity
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function actionColor(action: string): string {
  if (action === 'APPROVE') return 'var(--green)';
  if (action === 'REJECT') return 'var(--red)';
  return 'var(--cyan)';
}

function approvalHistoryColumns(): DataTableColumn<ApprovalHistoryItem>[] {
  return [
    {
      // First column.
      id: 'ts',
      kind: 'date',
      header: 'Action Date & Time',
      nowrap: true,
      render: (h) => fmtDateTime(h.ts),
      filterValue: (h) => h.ts,
    },
    {
      id: 'action',
      kind: 'badge',
      header: 'Action',
      nowrap: true,
      render: (h) => (
        <span style={{ fontWeight: 700, color: actionColor(h.action) }}>
          {actionLabel(h.action)}
        </span>
      ),
      filterValue: (h) => actionLabel(h.action),
    },
    {
      id: 'entity',
      header: 'Document Type',
      nowrap: true,
      render: (h) => <span style={{ color: 'var(--cyan)' }}>{docTypeLabel(h.entity)}</span>,
      filterValue: (h) => docTypeLabel(h.entity),
    },
    {
      id: 'detail',
      header: 'Details',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (h) => h.detail,
      title: (h) => h.detail,
    },
    {
      id: 'user',
      header: 'User',
      nowrap: true,
      render: (h) => h.userName ?? '—',
      filterValue: (h) => h.userName ?? '',
    },
  ];
}

export function ApprovalHistoryTable(): React.JSX.Element {
  const { data: history } = useApprovalHistory();
  const rows = history?.items ?? [];

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
        Recent Approval Activity
      </div>
      <DataTable
        tableKey={TABLE_KEYS.approvalHistory}
        columns={approvalHistoryColumns()}
        rows={rows}
        rowKey={(h) => h.id}
        emptyText="No approval activity yet."
      />
    </div>
  );
}
