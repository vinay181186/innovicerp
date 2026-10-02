// Assembly Tracker list (PL-5 + PL-5b). All Equipment SOs with assembled /
// dispatched counts + status badge. Click-through to the per-SO tracker.
//
// ADR-199: on the shared FIT table (<DataTable tableKey={TABLE_KEYS.assemblies}>)
// so the Columns / density toolbar, the saved layout, the pinned first column
// (SO No.) and the one ▸ expand control come for free. The ▸ reveals the BOM
// Name in place under the row; the row itself opens the per-SO tracker. Rows
// wash by assembly status (ROW_TINT) — waiting is pending work, done is green.
//
// PL-5b parity port (renderAssemblyTracker L28738–28787):
//   - the 5 status tile counts (Total / Waiting / Ready / In Assembly / Completed)
//     ride in the status dropdown's option labels (owner decision 2026-09-26:
//     no tiles/capsules beside a filter dropdown)
//   - Search input + status filter dropdown
//   - Due Date column
// Legacy renders ONE screen: an accordion of per-SO cards. The port splits it —
// this list is legacy's collapsed card header (L28782–28787); the expanded body
// (L28788–28884) is /assemblies/$soId. Both map to renderAssemblyTracker in
// docs/page-registry.yaml. See docs/PARITY/assytracker.md §0/§8 for that DELTA.
//
// Port additions with NO legacy counterpart (kept deliberately, not parity):
//   - red/bold Due when overdue (legacy L28785 prints the date unstyled)
//   - Dispatched column (legacy shows it only in the expanded body, L28795)

import type { AssemblyListItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { fmtDate, todayIst } from '@/lib/date';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useAssembliesList } from '../api';

export const assemblyListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'assemblies',
  component: AssemblyListPage,
});

type StatusKey = AssemblyListItem['status'];
type FilterKey = 'all' | StatusKey;

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
const ROW_TINT_BY_STATUS: Record<StatusKey, string | undefined> = {
  waiting: ROW_TINT.pending,
  ready: undefined,
  assembling: undefined,
  done: ROW_TINT.done,
};

// Legacy badge text (L28778–28781). The waiting variant's "— <ready>/<total>"
// component counter used to be dropped because the list payload carried no
// readiness figures; listAssemblies now computes them (batched), so it reads
// exactly as legacy does.
function statusBadgeLabel(row: AssemblyListItem): string {
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

// Status order + labels match legacy's tiles (L28747–28749).
const TILES: Array<{ key: FilterKey; label: string; color: string }> = [
  { key: 'all', label: 'Total', color: 'var(--text)' },
  { key: 'waiting', label: 'Waiting', color: 'var(--text3)' },
  { key: 'ready', label: 'Ready', color: 'var(--blue)' },
  { key: 'assembling', label: 'In Assembly', color: 'var(--amber)' },
  { key: 'done', label: 'Completed', color: 'var(--green)' },
];

function AssemblyListPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useAssembliesList();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState<string>('');
  // The soIds whose ▸ BOM Name row is open. The fit table's ▸ is the row's one
  // expand control: it toggles this set AND its own detail row (ADR-199).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // IST today (the UTC date is yesterday before 05:30 IST).
  const today = todayIst();
  const navigate = useNavigate();

  const toggleExpand = useCallback((soId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(soId)) next.delete(soId);
      else next.add(soId);
      return next;
    });
  }, []);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, waiting: 0, ready: 0, assembling: 0, done: 0 };
    if (data) {
      c.all = data.items.length;
      for (const it of data.items) c[it.status]++;
    }
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = normalizeSearchTerm(search);
    return data.items.filter((it) => {
      if (filter !== 'all' && it.status !== filter) return false;
      // Every column the row shows (plus the ▸ BOM name and legacy's partName,
      // L28768): SO no., customer, BOM no. + name, due date and the status text.
      // Shared matcher — case-insensitive, partial. Not the qty numbers: a bare
      // "5" would match nearly every row.
      return matchesSearchTerm(
        [
          it.soCode,
          it.customerName,
          it.bomCode,
          it.bomName,
          it.partName,
          fmtDate(it.dueDate),
          statusBadgeLabel(it),
        ],
        q,
      );
    });
  }, [data, filter, search]);

  const columns = useMemo<DataTableColumn<AssemblyListItem>[]>(
    () => [
      {
        id: 'so_no',
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
        id: 'customer',
        header: 'Customer',
        kind: 'text',
        align: 'left',
        ellipsis: true,
        render: (row) => row.customerName ?? '—',
        title: (row) => row.customerName ?? '',
      },
      {
        id: 'bom_no',
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
    ],
    [today],
  );

  return (
    // `page-fill` (ADR-201): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header can never ride off the
    // top of the screen at the last row.
    <div className="page-fill">
      {/* The ONE list header (ui/layout ListHeader): title · count, then the
          filter bar — search · status dropdown (the old tiles' counts in its
          option labels) · Clear. */}
      <ListHeader
        title="Assembly Tracker"
        icon="🔧"
        count={data ? filtered.length : undefined}
        noun="assembly order"
        filterNote={filter !== 'all' ? TILES.find((t) => t.key === filter)?.label : undefined}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search SO no., customer, BOM no. / name, part, due date, status…"
        updating={isFetching && !isLoading}
        filters={
          <select
            className="innovic-select"
            aria-label="Assembly status"
            title="Assembly status"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
          >
            {TILES.map((t) => (
              <option key={t.key} value={t.key}>
                {`${t.key === 'all' ? 'All Status' : t.label}${data ? ` (${counts[t.key]})` : ''}`}
              </option>
            ))}
          </select>
        }
        onClearFilters={() => {
          setSearch('');
          setFilter('all');
        }}
        filtersActive={search !== '' || filter !== 'all'}
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load assemblies. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.assemblies}
            columns={columns}
            rows={filtered}
            loading={isLoading}
            rowKey={(row) => row.soId}
            empty={
              data && data.items.length === 0
                ? 'No assembly orders yet.'
                : 'No assembly orders match.'
            }
            onRowClick={(row) =>
              void navigate({ to: '/assemblies/$soId', params: { soId: row.soId } })
            }
            rowClassName={(row) => ROW_TINT_BY_STATUS[row.status]}
            // The ▸ reveals the BOM Name in place. Returning null for a closed
            // row keeps the row collapsed; the caller owns the open set.
            renderExpanded={(row) =>
              expanded.has(row.soId) ? (
                <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
                  <span
                    className="fw-700"
                    style={{ fontSize: 'var(--fs-xs)', color: 'var(--cyan)' }}
                  >
                    BOM Name — {row.bomName ?? '—'}
                  </span>
                </div>
              ) : null
            }
            onToggleExpanded={(row) => toggleExpand(row.soId)}
          />
        </Panel>
      )}

      <ListFooter total={data?.items.length ?? 0} shown={filtered.length} noun="assembly order" />
    </div>
  );
}
