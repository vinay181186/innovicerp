// Assembly Tracker list (PL-5 + PL-5b). All Equipment SOs with assembled /
// dispatched counts + status badge. Click-through to the per-SO tracker.
//
// PL-5b parity port (renderAssemblyTracker L28738–28787):
//   - 5 status tiles (Total / Waiting / Ready / Assembling / Done) above table
//   - Search input + status filter dropdown
//   - Due Date column
// Legacy renders ONE screen: an accordion of per-SO cards. The port splits it —
// this list is legacy's collapsed card header (L28782–28787); the expanded body
// (L28788–28884) is /assemblies/$soId. Both map to renderAssemblyTracker in
// docs/page-registry.yaml. See docs/PARITY/assytracker.md §0/§8 for that DELTA.
//
// Port additions with NO legacy counterpart (kept deliberately, not parity):
//   - red/bold Due when overdue (legacy L28785 prints the date unstyled)
//   - active-tile ring + click-to-toggle (legacy tiles only set the filter)
//   - Dispatched column (legacy shows it only in the expanded body, L28795)

import type { AssemblyListItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useAssembliesList } from '../api';

export const assemblyListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'assemblies',
  component: AssemblyListPage,
});

type StatusKey = AssemblyListItem['status'];
type FilterKey = 'all' | StatusKey;

// Badge colours mirror legacy L28778–28781 (green / cyan / teal / amber).
const STATUS_BADGE_CLASS: Record<StatusKey, string> = {
  waiting: 'b-amber',
  ready: 'b-green',
  assembling: 'b-cyan',
  done: 'b-teal',
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
      return `Assembling ${row.assembledQty}/${row.orderQty}`;
    case 'done':
      return `Completed ${row.assembledQty}/${row.orderQty}`;
    case 'waiting':
      return row.totalCount > 0 ? `Waiting — ${row.readyCount}/${row.totalCount}` : 'Waiting';
  }
}

// Tile order matches legacy L28747–28749.
const TILES: Array<{ key: FilterKey; label: string; color: string }> = [
  { key: 'all', label: 'Total', color: 'var(--blue2)' },
  { key: 'waiting', label: 'Waiting', color: 'var(--amber2)' },
  { key: 'ready', label: 'Ready', color: 'var(--green2)' },
  { key: 'assembling', label: 'Assembling', color: 'var(--cyan)' },
  { key: 'done', label: 'Completed', color: 'var(--teal2)' },
];

function AssemblyListPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useAssembliesList();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState<string>('');

  const today = new Date().toISOString().slice(0, 10);

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
      // Every column the row shows (plus legacy's partName, L28768): SO no.,
      // customer, BOM no. + name, due date and the status text. Shared matcher —
      // case-insensitive, partial. Not the qty numbers: a bare "5" would match
      // nearly every row.
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

  return (
    <div>
      {/* The ONE list header (ui/layout ListHeader): title · count · search ·
          status filter, with the status tiles as one StatStrip in the band.
          Clicking a tile toggles its filter exactly as the old tiles did. */}
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
        tools={
          <select
            className="innovic-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
          >
            <option value="all">All Status</option>
            <option value="waiting">Waiting</option>
            <option value="ready">Ready</option>
            <option value="assembling">Assembling</option>
            <option value="done">Completed</option>
          </select>
        }
      >
        {data ? (
          <StatStrip
            items={TILES.map((t) => ({
              key: t.key,
              label: t.label,
              count: counts[t.key],
              color: t.color,
              active: filter === t.key,
              onClick: () => setFilter(filter === t.key ? 'all' : t.key),
            }))}
          />
        ) : null}
      </ListHeader>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load assemblies. Try again.'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          {filtered.length === 0 ? (
            <div className="panel">
              <div className="panel-body">
                <div className="empty-state">
                  <div className="empty-icon">🔧</div>
                  {data.items.length === 0
                    ? 'No equipment assembly orders found. Create an Equipment SO with a linked BOM to see assembly tracking here.'
                    : 'No results match your filter.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="panel">
              <div className="tbl-wrap">
                <table className="innovic-table tbl-grid">
                  <thead>
                    <tr>
                      <th>SO No.</th>
                      <th>Customer</th>
                      <th>BOM No.</th>
                      <th>Due Date</th>
                      <th className="th-num">Required</th>
                      <th className="th-num">Assembled</th>
                      <th className="th-num">Dispatched</th>
                      <th>Assembly Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const overdue =
                        row.dueDate !== null && row.dueDate < today && row.status !== 'done';
                      return (
                        <tr key={row.soId}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <Link
                              to="/assemblies/$soId"
                              params={{ soId: row.soId }}
                              className="td-code"
                              style={{ color: 'var(--cyan)', fontWeight: 600 }}
                            >
                              {row.soCode}
                            </Link>
                          </td>
                          <td>{row.customerName ?? '—'}</td>
                          {/* Legacy prints "BOM: <bomNo> Rev <n>" plus the BOM
                              NAME in the card title (L28784-28785). Both were
                              absent from the list payload until now. */}
                          <td>
                            <span className="text3" style={{ fontSize: 12 }}>
                              {row.bomCode ?? '—'}
                              {/* Loose != null on purpose: web and API deploy
                                  independently, so for a few minutes the old
                                  API returns no bomRevision at all. Strict
                                  !== null would print "Rev undefined". */}
                              {row.bomRevision != null ? ` BOM Rev ${row.bomRevision}` : ''}
                            </span>
                            {row.bomName ? <div style={{ fontSize: 11 }}>{row.bomName}</div> : null}
                          </td>
                          <td
                            style={{
                              whiteSpace: 'nowrap',
                              color: overdue ? 'var(--red2)' : undefined,
                              fontWeight: overdue ? 600 : undefined,
                            }}
                          >
                            {fmtDate(row.dueDate)}
                          </td>
                          <td className="td-num">{row.orderQty}</td>
                          <td className="td-num" style={{ color: 'var(--green2)' }}>
                            {row.assembledQty}
                          </td>
                          <td className="td-num" style={{ color: 'var(--cyan)' }}>
                            {row.dispatchedQty}
                          </td>
                          <td>
                            <span className={`badge ${STATUS_BADGE_CLASS[row.status]}`}>
                              {statusBadgeLabel(row)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <ListFooter total={data.items.length} shown={filtered.length} noun="assembly order" />
        </>
      ) : null}
    </div>
  );
}
