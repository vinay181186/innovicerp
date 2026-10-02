// Approval Rules — the "Recent Approval Activity" history table, on the shared
// FIT table (ADR-199: <DataTable tableKey=…>). Split out of routes/page.tsx so
// that file stays under the 400-line ceiling; only the history data table moved
// here — the approval-config FORM (switches, approvers, limits) stays in page.tsx
// untouched.
//
// Columns (first = date/time): Action Date & Time · Action · Document Type ·
// Details · User. ADR-201: 25 entries a page (Prev / Next) over ALL approval
// activity; the search box and the column ▾ Sort & Filter run on the server,
// and any change of them goes back to page 1. The page lives in component
// state (this panel has no route of its own).

import type { ApprovalHistoryItem } from '@innovic/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDateTime } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
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

const ACTION_OPTIONS = [
  { value: 'APPROVE', label: 'Approved' },
  { value: 'REJECT', label: 'Rejected' },
  { value: 'PAYMENT', label: 'Payment' },
];

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
      sortFilterField: 'ts',
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
      sortFilterField: 'action',
      filterType: 'list',
      filterOptions: ACTION_OPTIONS,
    },
    {
      id: 'entity',
      header: 'Document Type',
      nowrap: true,
      render: (h) => <span style={{ color: 'var(--cyan)' }}>{docTypeLabel(h.entity)}</span>,
      filterValue: (h) => docTypeLabel(h.entity),
      sortFilterField: 'entity',
    },
    {
      id: 'detail',
      header: 'Details',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (h) => h.detail,
      title: (h) => h.detail,
      sortFilterField: 'detail',
    },
    {
      id: 'user',
      header: 'User',
      nowrap: true,
      render: (h) => h.userName ?? '—',
      filterValue: (h) => h.userName ?? '',
      sortFilterField: 'user',
    },
  ];
}

export function ApprovalHistoryTable(): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search) return;
    const id = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search]);
  const sf = useServerSortFilter(TABLE_KEYS.approvalHistory, () => setPage(1));

  const { data: history, isLoading } = useApprovalHistory({
    search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  const rows = history?.items ?? [];
  const total = history?.total ?? 0;
  const onPage = useCallback((p: number) => setPage(p), []);
  useClampPage(page, history?.total, onPage);
  const columns = useMemo(() => approvalHistoryColumns(), []);

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700 }}>Approval Activity</div>
        <input
          className="innovic-input"
          style={{ maxWidth: 280 }}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search action, document, details, user…"
          aria-label="Search approval activity"
        />
      </div>
      <DataTable
        tableKey={TABLE_KEYS.approvalHistory}
        columns={columns}
        rows={rows}
        loading={isLoading}
        rowKey={(h) => h.id}
        sortFilterServer={sf}
        emptyText={
          search || sf.filtering ? 'No approval activity matches.' : 'No approval activity yet.'
        }
      />
      <ListFooter
        total={total}
        noun="approval entry"
        nounPlural="approval entries"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={onPage}
      />
    </div>
  );
}
