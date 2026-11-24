// ADR-312 — a department check's "View all N" page: Home › department › check ›
// View all opens /checks/<key> with EVERY line of that check. The table is the
// home check's own (CheckRowsTable: Sr No · head[0] · head[1] · Item · Qty ·
// head[2] · Status, no row actions; document / reference codes through
// ActionLink fallback="text"), plus the standard list chrome: ListHeader
// (title = the check's label, count, search, Back), ListFooter pager.
//
// Paging (ADR-201): 25 lines a page from the server (DASH_CHECK_PAGE_SIZE);
// search runs on the server over ALL lines (document no., reference, party,
// item code / name). Page and search live in the URL, so Back and a refresh
// keep them; any new search goes back to page 1.

import {
  DASH_CHECK_PAGE_SIZE,
  dashCheckKeySchema,
  type DashCheckKey,
  type DashCheckPageQuery,
  type DashCheckRow,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel, type ListExportSpec } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { fetchCheckPage, useCheckPage } from '../api';
import { CheckRowsTable, checkColumns } from '../components/check-table';
import { deptLabel } from '../components/home-menu';

const checkPageSearchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const dashCheckPageRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'checks/$key',
  validateSearch: checkPageSearchSchema,
  component: DashCheckPage,
});

function DashCheckPage(): React.JSX.Element {
  const { key: rawKey } = dashCheckPageRoute.useParams();
  const search = dashCheckPageRoute.useSearch();
  const navigate = dashCheckPageRoute.useNavigate();
  const parsedKey = dashCheckKeySchema.safeParse(rawKey);
  const key: DashCheckKey | undefined = parsedKey.success ? parsedKey.data : undefined;

  // Search box mirrors the URL `search`; a 300ms debounce writes it back
  // (replace, page 1) — the house list shape (Customer Master / SO Master).
  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const offset = pageOffset(search.page, DASH_CHECK_PAGE_SIZE);
  const query: DashCheckPageQuery = useMemo(
    () => ({ search: search.search, limit: DASH_CHECK_PAGE_SIZE, offset }),
    [search.search, offset],
  );
  const { data, isLoading, isFetching, isError, error } = useCheckPage(key, query);

  const gotoPage = useCallback(
    (p: number): void => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  useClampPage(search.page, data?.total, gotoPage, DASH_CHECK_PAGE_SIZE);

  const head = data?.check.head;
  const columns = useMemo(() => (head ? checkColumns(head, offset + 1) : []), [head, offset]);
  const title = data?.check.label ?? 'Check';
  // ADR-310 — the shared Export: every line matching the search, same columns.
  const exportSpec = useMemo((): ListExportSpec<DashCheckRow> | undefined => {
    if (!key || !head) return undefined;
    return {
      fileName: title,
      tableKey: TABLE_KEYS.dashCheckPage,
      columns,
      rowKey: (r) => r.key,
      filterSummary: query.search ? `search "${query.search}"` : undefined,
      fetchPage: async (limit, off) => {
        // The endpoint serves at most 100 a page.
        const res = await fetchCheckPage(key, { search: query.search, limit, offset: off });
        return { items: res.rows, total: res.total };
      },
      pageSize: 100,
    };
  }, [key, head, title, columns, query.search]);

  const status = (error as { status?: number } | null)?.status;
  const dept = data?.check.dept;

  if (!key) {
    return <PageState as="page" state="error" message="This check does not exist." />;
  }
  if (isError && status === 403) {
    return <PageState as="page" state="noaccess" message="You can't open this list." />;
  }

  return (
    // `page-fill` (ADR-202): the TABLE is this page's only scrollbar.
    <div className="page-fill">
      <ListHeader
        exportSpec={exportSpec}
        title={title}
        count={data?.total}
        noun="line"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search document no., reference, party, item…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, search: undefined, page: 1 }),
            replace: true,
          });
        }}
        filtersActive={search.search != null || searchInput !== ''}
        tools={
          <Link to="/" search={dept ? { view: dept } : {}} className="btn btn-ghost btn-sm">
            ← Back to {dept ? deptLabel(dept) : 'Home'}
          </Link>
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            status === 404 || status === 400
              ? 'This check does not exist.'
              : error instanceof Error
                ? error.message
                : 'Could not load the lines. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <CheckRowsTable
            tableKey={TABLE_KEYS.dashCheckPage}
            columns={columns}
            rows={data?.rows ?? []}
            loading={isLoading}
            emptyText={search.search ? 'No lines match.' : 'No lines.'}
          />
        </Panel>
      )}

      <ListFooter
        total={data?.total ?? 0}
        noun="line"
        page={search.page}
        pageSize={DASH_CHECK_PAGE_SIZE}
        onPage={gotoPage}
      />
    </div>
  );
}
