// Stock Count list (ADR-193 phase 2) — opening stock + periodic counts.
// Migrated onto the standard <DataTable tableKey> sheet (ADR-199): the
// hand-written <table className="innovic-table"> is replaced, Count No. is the
// pinned first column, and the Columns / density toolbar comes for free. The
// query (search + status + pagination), the status filter, the permission gate
// and the row click to the detail page are unchanged.
import {
  STOCK_COUNT_PURPOSE_LABELS,
  STOCK_COUNT_STATUS_LABELS,
  STOCK_COUNT_STATUSES,
  type StockCount,
  type StockCountStatus,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useStockCounts } from '../api';

const PAGE_SIZE = 25;

// Sort & Filter tick lists (ADR-200): the stored code + the label shown.
const PURPOSE_OPTIONS = Object.entries(STOCK_COUNT_PURPOSE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const STATUS_OPTIONS = STOCK_COUNT_STATUSES.map((s) => ({
  value: s,
  label: STOCK_COUNT_STATUS_LABELS[s],
}));

export const STATUS_BADGE: Record<StockCountStatus, string> = {
  draft: 'b-grey',
  submitted: 'b-amber',
  posted: 'b-green',
  cancelled: 'b-red',
};

export const stockCountsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stock-counts',
  component: StockCountsListPage,
});

function StockCountsListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'stockcount_create');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StockCountStatus | ''>('');
  const [page, setPage] = useState(1);
  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss counts. Every change goes back to
  // page 1.
  const sf = useServerSortFilter(TABLE_KEYS.stockCounts, () => setPage(1));
  const { data, isLoading, isError, error } = useStockCounts({
    search: search.trim() || undefined,
    status: status || undefined,
    sf: sf.param,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const rows = data?.items ?? [];
  const filtered = Boolean(search.trim() || status || sf.param);

  // The ruled sheet's columns. Count No. is the pinned first column; Items is a
  // right-aligned number; Count Status is a badge; Remarks is long free text
  // that clips with a tooltip.
  const columns = useMemo<DataTableColumn<StockCount>[]>(
    () => [
      {
        id: 'code',
        sortFilterField: 'code',
        filterType: 'text',
        header: 'Count No.',
        nowrap: true,
        render: (c) => (
          <Link
            to="/stock-counts/$id"
            params={{ id: c.id }}
            className="td-code"
            style={{ textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {c.code}
          </Link>
        ),
      },
      {
        id: 'count_date',
        sortFilterField: 'countDate',
        header: 'Count Date',
        kind: 'date',
        nowrap: true,
        render: (c) => fmtDate(c.countDate),
      },
      {
        id: 'purpose',
        sortFilterField: 'purpose',
        filterType: 'list',
        filterOptions: PURPOSE_OPTIONS,
        header: 'Purpose',
        render: (c) => STOCK_COUNT_PURPOSE_LABELS[c.purpose],
      },
      {
        id: 'line_count',
        sortFilterField: 'lineCount',
        header: 'Items',
        kind: 'num',
        align: 'right',
        className: 'mono',
        key: 'lineCount',
      },
      {
        id: 'status',
        sortFilterField: 'status',
        filterOptions: STATUS_OPTIONS,
        header: 'Count Status',
        kind: 'badge',
        nowrap: true,
        render: (c) => (
          <span className={`badge ${STATUS_BADGE[c.status]}`}>
            {STOCK_COUNT_STATUS_LABELS[c.status]}
          </span>
        ),
      },
      {
        id: 'counted_by',
        sortFilterField: 'countedBy',
        header: 'Counted By',
        ellipsis: true,
        render: (c) => c.createdByName ?? '—',
        title: (c) => c.createdByName ?? '',
      },
      {
        id: 'approved_by',
        sortFilterField: 'approvedBy',
        header: 'Approved By',
        ellipsis: true,
        render: (c) => c.approvedByName ?? '—',
        title: (c) => c.approvedByName ?? '',
      },
      {
        id: 'remarks',
        sortFilterField: 'remarks',
        header: 'Remarks',
        align: 'left',
        className: 'text3',
        ellipsis: true,
        render: (c) => c.remarks ?? '—',
        title: (c) => c.remarks ?? '',
      },
      {
        // When the count was entered (IST day). Off by default; Columns ▾ shows it.
        id: 'created_on',
        sortFilterField: 'createdOn',
        header: 'Created On',
        kind: 'date',
        nowrap: true,
        render: (c) => fmtDate(c.createdAt),
      },
    ],
    [],
  );

  return (
    <div>
      <ListHeader
        title="Stock Count"
        icon="🧮"
        count={data?.total}
        noun="count"
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search count no., remarks…"
        filters={
          <Select
            value={status}
            aria-label="Count Status"
            onChange={(e) => {
              setStatus(e.target.value as StockCountStatus | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All statuses' },
              ...STOCK_COUNT_STATUSES.map((s) => ({
                value: s,
                label: STOCK_COUNT_STATUS_LABELS[s],
              })),
            ]}
          />
        }
        primary={
          perms.entry ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void navigate({ to: '/stock-counts/$id', params: { id: 'new' } })}
            >
              <Plus size={14} /> New Stock Count
            </button>
          ) : null
        }
      />
      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load stock counts.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.stockCounts}
            sortFilterServer={sf}
            defaultHidden={['created_on']}
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText={filtered ? 'No stock counts match.' : 'No stock counts yet.'}
            onRowClick={(c) => void navigate({ to: '/stock-counts/$id', params: { id: c.id } })}
          />
        </Panel>
      )}
      {data ? (
        <ListFooter
          total={data.total}
          shown={data.items.length}
          noun="count"
          page={page}
          pageSize={PAGE_SIZE}
          onPage={setPage}
        />
      ) : null}
    </div>
  );
}
