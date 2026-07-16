import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useActivityLog } from '../api';

const PAGE_SIZE = 50;

const searchSchema = z.object({
  search: z.string().optional(),
  action: z.string().optional(),
  userId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const activityLogListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'activity-log',
  validateSearch: searchSchema,
  component: ActivityLogListPage,
});

// Theme badge class keyed by action label — replaces the Tailwind map.
//
// Legacy `actionColors` (L11283) is a hex map; the port is a LIGHT theme
// (ISSUE-067) so the hex values are MAPPED to tokens, never copied:
//   CREATE      #22c55e → b-green   EDIT        #3b82f6 → b-blue
//   DELETE      #ef4444 → b-red     RESTORE     #f59e0b → b-amber
//   OP START    #f59e0b → b-amber   OP COMPLETE #22c55e → b-green
//   DISPATCH    #06b6d4 → b-cyan    PERM DELETE #b91c1c → b-red
// (--red2 IS #b91c1c, so PERM DELETE lands exactly; legacy's lighter
//  DELETE red has no separate token, so the two share b-red here.)
//
// The underscore forms + cross-module actions below have NO legacy
// counterpart — they are emitted by our own services (T-051a) and keep the
// colour the port already gave them. Legacy's space forms are kept beside
// them so migrated rows render identically.
//
// Unmapped actions fall back to b-grey. Legacy's default was `var(--text2)`
// text with `background:var(--text2)22` — an invalid declaration that never
// painted (ISSUE-063), so legacy's default chip is a bare muted label.
const ACTION_BADGE: Record<string, string> = {
  // CRUD baseline
  CREATE: 'b-green',
  EDIT: 'b-blue',
  DELETE: 'b-red',
  RESTORE: 'b-amber',
  DISPATCH: 'b-cyan',
  'PERM DELETE': 'b-red',
  // Op-entry (new — T-051a #4)
  OP_START: 'b-amber',
  OP_STOP: 'b-orange',
  OP_COMPLETE: 'b-green',
  // Legacy space-form variants (migrated rows render with the same colour)
  'OP START': 'b-amber',
  'OP COMPLETE': 'b-green',
  // Cross-module + NC dispositions (T-051a #6, #8)
  PR_CONVERT: 'b-cyan',
  NC_DISPOSE: 'b-amber',
  NC_CLOSE_REWORK: 'b-green',
  // Auto-cascade (T-051a #9) — line-close intermediate, header-close terminal
  JC_COMPLETE: 'b-green',
  SO_LINE_CLOSED: 'b-blue',
  SO_CLOSED: 'b-green',
  JW_LINE_CLOSED: 'b-blue',
  JW_CLOSED: 'b-green',
};

function ActivityLogListPage() {
  const search = activityLogListRoute.useSearch();
  const navigate = activityLogListRoute.useNavigate();

  const [pendingSearch, setPendingSearch] = useState(search.search ?? '');

  const offset = (search.page - 1) * PAGE_SIZE;
  const query = useMemo(
    () => ({
      ...(search.search ? { search: search.search } : {}),
      ...(search.action ? { action: search.action } : {}),
      ...(search.userId ? { userId: search.userId } : {}),
      ...(search.fromDate ? { fromDate: search.fromDate } : {}),
      ...(search.toDate ? { toDate: search.toDate } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    [search, offset],
  );
  const { data, isLoading, isError, error, isFetching } = useActivityLog(query);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      search: () => ({
        ...(pendingSearch ? { search: pendingSearch } : {}),
        ...(search.action ? { action: search.action } : {}),
        ...(search.userId ? { userId: search.userId } : {}),
        ...(search.fromDate ? { fromDate: search.fromDate } : {}),
        ...(search.toDate ? { toDate: search.toDate } : {}),
        page: 1,
      }),
      replace: true,
    });
  };

  const setFilter = (key: 'action' | 'userId' | 'fromDate' | 'toDate', value: string) => {
    void navigate({
      search: (prev) => {
        const next = { ...prev, page: 1 };
        if (value) {
          (next as Record<string, unknown>)[key] = value;
        } else {
          delete (next as Record<string, unknown>)[key];
        }
        return next;
      },
      replace: true,
    });
  };

  const onClear = () => {
    setPendingSearch('');
    void navigate({ search: () => ({ page: 1 }), replace: true });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const goToPage = (n: number) => {
    void navigate({ search: (prev) => ({ ...prev, page: n }), replace: true });
  };

  return (
    <div>
      {/* Legacy L11292: header flex row — section-hdr left, controls right. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Activity Log
        </div>
        {/* Legacy L11294: inline control row. From/To + Apply/Clear are
            port-only — legacy searches in-memory on every keystroke, we hit
            the server, so the text search stays submit-driven. */}
        <form
          onSubmit={onSearchSubmit}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input
            type="search"
            className="innovic-input"
            style={{ width: 180 }}
            placeholder="Search..."
            value={pendingSearch}
            onChange={(e) => setPendingSearch(e.target.value)}
          />
          <select
            className="innovic-select"
            style={{ width: 150 }}
            value={search.action ?? ''}
            onChange={(e) => setFilter('action', e.target.value)}
          >
            <option value="">All Actions</option>
            {(data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            className="innovic-select"
            style={{ width: 130 }}
            value={search.userId ?? ''}
            onChange={(e) => setFilter('userId', e.target.value)}
          >
            <option value="">All Users</option>
            {(data?.users ?? [])
              .filter((u) => u.id !== null)
              .map((u) => (
                <option key={u.id ?? u.name} value={u.id ?? ''}>
                  {u.name}
                </option>
              ))}
          </select>
          <input
            type="date"
            className="innovic-input"
            style={{ width: 140 }}
            title="From"
            value={search.fromDate ?? ''}
            onChange={(e) => setFilter('fromDate', e.target.value)}
          />
          <input
            type="date"
            className="innovic-input"
            style={{ width: 140 }}
            title="To"
            value={search.toDate ?? ''}
            onChange={(e) => setFilter('toDate', e.target.value)}
          />
          {/* Legacy L11298: `log.length` is the full filtered count (legacy
              renders every row). data.total is the server's count over the
              same WHERE — never data.entries.length, which is one page. */}
          <span className="text3" style={{ fontSize: 11 }}>
            {data ? data.total : 0} entries
          </span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Apply
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
            Clear
          </button>
        </form>
      </div>

      {/* Legacy L11302: bare panel → tbl-wrap → table. No panel-hdr, no
          tbl-frozen. Ref is a port-only column (see report). */}
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Detail</th>
                <th>Ref</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    <span className="red">
                      {error instanceof Error ? error.message : 'Failed to load activity log'}
                    </span>
                  </td>
                </tr>
              ) : !data || data.entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state" style={{ padding: 24 }}>
                    No activity recorded yet
                  </td>
                </tr>
              ) : (
                data.entries.map((e) => {
                  const dt = new Date(e.ts);
                  const date = dt.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  });
                  const time = dt.toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  });
                  const badgeClass = ACTION_BADGE[e.action] ?? 'b-grey';
                  return (
                    <tr key={e.id}>
                      <td className="mono text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {date}
                      </td>
                      <td className="mono text3" style={{ fontSize: 11 }}>
                        {time}
                      </td>
                      <td>
                        <span className={`badge ${badgeClass}`}>{e.action}</span>
                      </td>
                      <td className="fw-700" style={{ fontSize: 12 }}>
                        {e.entity}
                      </td>
                      <td className="text2" style={{ fontSize: 11 }}>
                        {e.detail}
                      </td>
                      <td className="mono text3" style={{ fontSize: 11 }}>
                        {e.refId ?? '—'}
                      </td>
                      <td className="amber" style={{ fontSize: 11 }}>
                        {e.userName}
                        {e.userId === null ? (
                          <span className="text3" style={{ fontSize: 10, marginLeft: 4 }}>
                            (snapshot)
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Port-only: legacy renders every row with no pager. */}
      {data && data.total > PAGE_SIZE ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => goToPage(search.page - 1)}
            disabled={search.page <= 1}
          >
            Previous
          </button>
          <span className="text3" style={{ fontSize: 11 }}>
            Page {search.page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => goToPage(search.page + 1)}
            disabled={search.page >= totalPages}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
