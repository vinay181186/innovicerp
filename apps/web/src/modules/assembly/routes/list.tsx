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
import { authenticatedRoute } from '@/routes/_authenticated';
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

// Legacy badge text (L28778–28781). Legacy's waiting variant reads
// "Waiting — <readyCount>/<totalCount>", but the /assemblies list payload
// carries no component-readiness counts (the service never computes them for
// the list — see service.ts listAssemblies), so the counter is omitted rather
// than computed in the browser.
function statusBadgeLabel(row: AssemblyListItem): string {
  switch (row.status) {
    case 'ready':
      return 'ALL READY ✓';
    case 'assembling':
      return `Assembling ${row.assembledQty}/${row.orderQty}`;
    case 'done':
      return `Done ✓ ${row.assembledQty}/${row.orderQty}`;
    case 'waiting':
      return 'Waiting';
  }
}

// Tile order matches legacy L28747–28749.
const TILES: Array<{ key: FilterKey; label: string; color: string }> = [
  { key: 'all', label: 'Total', color: 'var(--blue)' },
  { key: 'waiting', label: 'Waiting', color: 'var(--amber)' },
  { key: 'ready', label: 'Ready', color: 'var(--green)' },
  { key: 'assembling', label: 'Assembling', color: 'var(--cyan)' },
  { key: 'done', label: 'Done', color: 'var(--teal, #14b8a6)' },
];

function AssemblyListPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useAssembliesList();
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
    const q = search.trim().toLowerCase();
    return data.items.filter((it) => {
      if (filter !== 'all' && it.status !== filter) return false;
      if (q) {
        const hay = `${it.soCode} ${it.customerName ?? ''} ${it.bomCode ?? ''} ${it.partName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, filter, search]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">🔧 Assembly Tracker</div>
      </div>

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
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load assemblies'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <KpiTiles counts={counts} filter={filter} setFilter={setFilter} />

          <Toolbar
            search={search}
            setSearch={setSearch}
            filter={filter}
            setFilter={setFilter}
          />

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
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>SO #</th>
                      <th>Customer</th>
                      <th>BOM</th>
                      <th>Due</th>
                      <th className="td-right">Required</th>
                      <th className="td-right">Assembled</th>
                      <th className="td-right">Dispatched</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const overdue =
                        row.dueDate !== null && row.dueDate < today && row.status !== 'done';
                      return (
                        <tr key={row.soId}>
                          <td>
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
                          <td>
                            <span className="text3" style={{ fontSize: 12 }}>
                              {row.bomCode ?? '—'}
                            </span>
                          </td>
                          <td style={{ color: overdue ? 'var(--red)' : undefined, fontWeight: overdue ? 600 : undefined }}>
                            {row.dueDate ?? '—'}
                          </td>
                          <td className="td-right">{row.orderQty}</td>
                          <td className="td-right" style={{ color: 'var(--green2)' }}>
                            {row.assembledQty}
                          </td>
                          <td className="td-right" style={{ color: 'var(--cyan)' }}>
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
        </>
      ) : null}
    </div>
  );
}

function KpiTiles({
  counts,
  filter,
  setFilter,
}: {
  counts: Record<FilterKey, number>;
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
        gap: 10,
        marginBottom: 20,
      }}
    >
      {TILES.map((t) => {
        const active = filter === t.key;
        return (
          <div
            key={t.key}
            onClick={() => setFilter(filter === t.key ? 'all' : t.key)}
            style={{
              cursor: 'pointer',
              textAlign: 'center',
              padding: 14,
              borderRadius: 10,
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              boxShadow: active ? `0 0 0 2px ${t.color}` : undefined,
              transition: 'box-shadow .15s',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: t.color }}>{counts[t.key]}</div>
          </div>
        );
      })}
    </div>
  );
}

function Toolbar({
  search,
  setSearch,
  filter,
  setFilter,
}: {
  search: string;
  setSearch: (v: string) => void;
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        marginBottom: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <input
        type="text"
        className="innovic-input"
        placeholder="🔍 Search SO, customer, item…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ minWidth: 240 }}
      />
      <select
        className="innovic-select"
        value={filter}
        onChange={(e) => setFilter(e.target.value as FilterKey)}
      >
        <option value="all">All Status</option>
        <option value="waiting">Waiting</option>
        <option value="ready">Ready</option>
        <option value="assembling">Assembling</option>
        <option value="done">Done</option>
      </select>
    </div>
  );
}
