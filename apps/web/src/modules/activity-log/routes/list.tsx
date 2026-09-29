import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDateTime } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useActivityLog } from '../api';
import { DocRefLink } from '../components/doc-ref-link';

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

// The words shown for each action code. The codes stay as stored (they are
// the filter values); only the text changes. Unmapped codes read as Title
// Case with document abbreviations (SO, JC, PR, …) kept upper-case.
const ACTION_LABEL: Record<string, string> = {
  CREATE: 'Created',
  EDIT: 'Edited',
  DELETE: 'Deleted',
  RESTORE: 'Restored',
  DISPATCH: 'Dispatched',
  'PERM DELETE': 'Deleted Permanently',
  OP_START: 'Operation Started',
  OP_STOP: 'Operation Stopped',
  OP_COMPLETE: 'Operation Completed',
  'OP START': 'Operation Started',
  'OP COMPLETE': 'Operation Completed',
  PR_CONVERT: 'PR Converted to PO',
  NC_DISPOSE: 'NC Disposition Set',
  NC_CLOSE_REWORK: 'NC Closed after Rework',
  JC_COMPLETE: 'JC Completed',
  SO_LINE_CLOSED: 'SO Line Closed',
  SO_CLOSED: 'SO Closed',
  JW_LINE_CLOSED: 'JWSO Line Closed',
  JW_CLOSED: 'JWSO Closed',
};
const ACTION_ABBR = new Set([
  'SO',
  'JC',
  'PR',
  'PO',
  'NC',
  'GRN',
  'DC',
  'QC',
  'JWSO',
  'BOM',
  'OSP',
  'TPI',
  'CAPA',
]);
function actionLabel(action: string): string {
  return (
    ACTION_LABEL[action] ??
    action
      .split(/[_ ]+/)
      .filter(Boolean)
      .map((w) =>
        ACTION_ABBR.has(w.toUpperCase())
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join(' ')
  );
}

function ActivityLogListPage() {
  const search = activityLogListRoute.useSearch();
  const navigate = activityLogListRoute.useNavigate();

  // The search term lives in the URL (?search=, server-side); the box mirrors
  // it and a 300ms debounce writes it back with replace + page 1 — the SO
  // Master shape. (It used to wait for an Apply button.)
  const [pendingSearch, setPendingSearch] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setPendingSearch((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(pendingSearch);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [pendingSearch, search.search, navigate]);

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

  const goToPage = (n: number) => {
    void navigate({ search: (prev) => ({ ...prev, page: n }), replace: true });
  };

  return (
    <div>
      <ListHeader
        title="Activity Log"
        icon="📜"
        count={data ? data.total : undefined}
        noun="entry"
        nounPlural="entries"
        search={pendingSearch}
        onSearch={setPendingSearch}
        searchPlaceholder="Search action, document type, detail, document no., user…"
        updating={isFetching && !isLoading}
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="Action"
              title="Action"
              value={search.action ?? ''}
              onChange={(e) => setFilter('action', e.target.value)}
            >
              <option value="">All Actions</option>
              {(data?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              aria-label="User"
              title="User"
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
              title="Log date from"
              aria-label="Log date from"
              value={search.fromDate ?? ''}
              onChange={(e) => setFilter('fromDate', e.target.value)}
            />
            <input
              type="date"
              className="innovic-input"
              title="Log date to"
              aria-label="Log date to"
              value={search.toDate ?? ''}
              onChange={(e) => setFilter('toDate', e.target.value)}
            />
          </>
        }
        onClearFilters={onClear}
        filtersActive={
          !!search.action ||
          !!search.userId ||
          !!search.fromDate ||
          !!search.toDate ||
          pendingSearch.trim() !== ''
        }
      />

      {/* Legacy L11302: bare panel → tbl-wrap → table. No panel-hdr, no
          tbl-frozen. Ref is a port-only column (see report). */}
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            <thead>
              <tr>
                <th>Log Date</th>
                <th>Log Time</th>
                <th>Action</th>
                <th>Document Type</th>
                <th>Detail</th>
                <th>Document No.</th>
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
                      {error instanceof Error
                        ? error.message
                        : 'Could not load activity log. Try again.'}
                    </span>
                  </td>
                </tr>
              ) : !data || data.entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state" style={{ padding: 24 }}>
                    {search.search ||
                    search.action ||
                    search.userId ||
                    search.fromDate ||
                    search.toDate
                      ? 'No entries match.'
                      : 'No activity yet.'}
                  </td>
                </tr>
              ) : (
                data.entries.map((e) => {
                  // `26-Sep-2026 14:05` IST, split across the Date and Time columns.
                  const [date = '—', time = ''] = fmtDateTime(e.ts).split(' ');
                  const badgeClass = ACTION_BADGE[e.action] ?? 'b-grey';
                  return (
                    <tr key={e.id}>
                      <td className="mono text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {date}
                      </td>
                      <td className="mono text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {time}
                      </td>
                      <td>
                        <span className={`badge ${badgeClass}`}>{actionLabel(e.action)}</span>
                      </td>
                      <td className="fw-700" style={{ fontSize: 12 }}>
                        {e.entity}
                      </td>
                      <td className="text2" style={{ fontSize: 11 }}>
                        {e.detail}
                      </td>
                      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        <DocRefLink entity={e.entity} refId={e.refId} />
                      </td>
                      <td className="amber" style={{ fontSize: 11 }}>
                        {e.userName}
                        {e.userId === null ? (
                          <span className="text3" style={{ fontSize: 11, marginLeft: 4 }}>
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
      {data ? (
        <ListFooter
          total={data.total}
          noun="entry"
          nounPlural="entries"
          page={search.page}
          pageSize={PAGE_SIZE}
          onPage={goToPage}
        />
      ) : null}
    </div>
  );
}
