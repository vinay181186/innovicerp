// Assembly Tracker list (PL-5 + PL-5b). All Equipment SOs with assembled /
// dispatched counts + status badge. Click-through to the per-SO tracker.
//
// PL-5b parity port (renderAssemblyTracker L28738–28787):
//   - 5 status tiles (Total / Waiting / Ready / In Assembly / Completed) above table
//   - Search input (the status tiles are the status filter)
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
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { fmtDate, todayIst } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
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

// Tile order matches legacy L28747–28749.
const TILES: Array<{ key: FilterKey; label: string; color: string }> = [
  { key: 'all', label: 'Total', color: 'var(--text)' },
  { key: 'waiting', label: 'Waiting', color: 'var(--text3)' },
  { key: 'ready', label: 'Ready', color: 'var(--blue)' },
  { key: 'assembling', label: 'In Assembly', color: 'var(--amber)' },
  { key: 'done', label: 'Completed', color: 'var(--green)' },
];

function AssemblyListPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useAssembliesList();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState<string>('');

  // IST today (the UTC date is yesterday before 05:30 IST).
  const today = todayIst();
  const navigate = useNavigate();

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
        // Legacy matches on soNo + customer + partName + BOM NAME (L28768).
        // bomName was not in the payload before, so a search for the BOM by
        // name silently matched nothing.
        const hay =
          `${it.soCode} ${it.customerName ?? ''} ${it.bomCode ?? ''} ${it.bomName ?? ''} ${it.partName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, filter, search]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">Assembly Tracker</div>
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
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load assemblies. Try again.'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <KpiTiles counts={counts} filter={filter} setFilter={setFilter} />

          <Toolbar search={search} setSearch={setSearch} />

          {filtered.length === 0 ? (
            <div className="panel">
              <div className="panel-body">
                <div className="empty-state">
                  {data.items.length === 0
                    ? 'No assembly orders yet.'
                    : 'No assembly orders match.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="panel">
              <div className="tbl-wrap">
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>SO No.</th>
                      <th>Customer</th>
                      <th>BOM No.</th>
                      <th>Due Date</th>
                      <th>Required</th>
                      <th>Assembled</th>
                      <th>Dispatched</th>
                      <th>Assembly Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const overdue =
                        row.dueDate !== null && row.dueDate < today && row.status !== 'done';
                      return (
                        <tr
                          key={row.soId}
                          onClick={() =>
                            void navigate({ to: '/assemblies/$soId', params: { soId: row.soId } })
                          }
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <Link
                              to="/assemblies/$soId"
                              params={{ soId: row.soId }}
                              className="td-code"
                              style={{ color: 'var(--cyan)', fontWeight: 600 }}
                              onClick={(e) => e.stopPropagation()}
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
                              color: overdue ? 'var(--red)' : undefined,
                              fontWeight: overdue ? 600 : undefined,
                            }}
                          >
                            {fmtDate(row.dueDate)}
                          </td>
                          <td>{row.orderQty}</td>
                          <td style={{ color: 'var(--green2)' }}>{row.assembledQty}</td>
                          <td style={{ color: 'var(--green2)' }}>{row.dispatchedQty}</td>
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
  // One StatStrip; the tiles ARE the status filter (the old dropdown is gone).
  return (
    <div style={{ marginBottom: 16 }}>
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
    </div>
  );
}

function Toolbar({
  search,
  setSearch,
}: {
  search: string;
  setSearch: (v: string) => void;
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
    </div>
  );
}
