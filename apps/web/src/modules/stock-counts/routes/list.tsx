// Stock Count list (ADR-193 phase 2) — opening stock + periodic counts.
import {
  STOCK_COUNT_PURPOSE_LABELS,
  STOCK_COUNT_STATUS_LABELS,
  STOCK_COUNT_STATUSES,
  type StockCountStatus,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useStockCounts } from '../api';

const PAGE_SIZE = 25;

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
  const { data, isLoading, isError, error } = useStockCounts({
    search: search.trim() || undefined,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

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
      <div className="panel">
        {isLoading ? (
          <div className="panel-body text3">
            <Loader2 size={14} className="inline animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="panel-body empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load stock counts.'}
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Count No.</th>
                  <th>Count Date</th>
                  <th>Purpose</th>
                  <th className="th-num">Items</th>
                  <th>Count Status</th>
                  <th>Counted By</th>
                  <th>Approved By</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((c) => (
                  <tr
                    key={c.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => void navigate({ to: '/stock-counts/$id', params: { id: c.id } })}
                  >
                    <td className="td-code" style={{ whiteSpace: 'nowrap' }}>
                      <Link to="/stock-counts/$id" params={{ id: c.id }}>
                        {c.code}
                      </Link>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.countDate)}</td>
                    <td>{STOCK_COUNT_PURPOSE_LABELS[c.purpose]}</td>
                    <td className="td-num mono">{c.lineCount}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[c.status]}`}>
                        {STOCK_COUNT_STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td>{c.createdByName ?? '—'}</td>
                    <td>{c.approvedByName ?? '—'}</td>
                    <td className="text3">{c.remarks ?? '—'}</td>
                  </tr>
                ))}
                {(data?.items ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No stock counts yet — start with an Opening Stock count.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
