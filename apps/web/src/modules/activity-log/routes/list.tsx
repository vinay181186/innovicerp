import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { activityActionLabel as actionLabel } from '@innovic/shared';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDateTime } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useActivityLog } from '../api';
import { DocRefLink } from '../components/doc-ref-link';
import { activityActionBadge } from '../lib/activity-entity';

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

// Action words and badge colours come from ONE place (ADR-197): the label
// from @innovic/shared `activityActionLabel` (standard, legacy and ad-hoc
// names alike — legacy rows keep their old wording), the colour from
// lib/activity-entity.ts `activityActionBadge` (legacy hex map → tokens,
// ISSUE-067; unmapped names are grey). The stored codes stay the filter values.

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
                  const badgeClass = activityActionBadge(e.action);
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
                        <DocRefLink entity={e.entity} refId={e.refId} entityId={e.entityId} />
                      </td>
                      <td className="amber" style={{ fontSize: 11 }} title={e.userName}>
                        {e.userFullName}
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
