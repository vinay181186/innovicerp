// Multi-Level Plan list (ADR-225 phase 3). Composed exactly like the
// Multi-Level BOM list: ListHeader · Panel + DataTable (fit table, server Sort
// & Filter, 25 rows a page) · ListFooter · PageState. Row actions live in the
// ⋯ menu (Open, Edit, Refresh, Cancel).

import type { MlPlanListItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useMlPlansList, useRefreshMlPlan } from '../api';
import { CancelMlPlanDialog } from '../components/cancel-ml-plan-dialog';
import { mlPlanListColumns } from '../components/ml-plan-list-columns';

const searchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const mlPlansListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ml-plans',
  validateSearch: searchSchema,
  component: MlPlansListPage,
});

function MlPlansListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, page } = mlPlansListRoute.useSearch();

  // Search lives in the URL; the box mirrors it and a debounce writes it back
  // (the SO / Multi-Level BOM list shape).
  const [searchInput, setSearchInput] = useState(search ?? '');
  useEffect(() => {
    setSearchInput(search ?? '');
  }, [search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search) return;
    const id = window.setTimeout(() => {
      void navigate({
        to: '/ml-plans',
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, navigate]);

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ to: '/ml-plans', search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  const sf = useServerSortFilter(TABLE_KEYS.mlPlanList, () => gotoPage(1));
  const offset = pageOffset(page);
  const { data, isLoading, isFetching, isError, error } = useMlPlansList({
    search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'mlplan_create');
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  useClampPage(page, data?.total, gotoPage);

  const refresh = useRefreshMlPlan();
  const [toCancel, setToCancel] = useState<MlPlanListItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const columns = useMemo(() => mlPlanListColumns(offset), [offset]);

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  const onRefresh = async (p: MlPlanListItem): Promise<void> => {
    setActionError(null);
    try {
      await refresh.mutateAsync({ id: p.id, expectedUpdatedAt: p.updatedAt });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : `Could not refresh ${p.code}.`);
    }
  };

  return (
    <div className="page-fill">
      <ListHeader
        title="Multi-Level Plan"
        count={total}
        noun="plan"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search MLP no., SO no., item code, item name, BOM no.…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          sf.clearFilters();
          void navigate({ to: '/ml-plans', search: { page: 1 }, replace: true });
        }}
        filtersActive={searchInput.trim() !== '' || sf.filtering}
        primary={
          perms.entry ? (
            <Link to="/ml-plans/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Multi-Level Plan
            </Link>
          ) : null
        }
      />

      {actionError ? (
        <Banner tone="error" role="alert" onDismiss={() => setActionError(null)}>
          {actionError}
        </Banner>
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load plans. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.mlPlanList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={search || sf.filtering ? 'No plans match.' : 'No plans yet.'}
            onRowClick={(p) => void navigate({ to: '/ml-plans/$id', params: { id: p.id } })}
            renderLink={(p) => <Link {...p} />}
            rowMenu={(p) => [
              { key: 'open', label: 'Open', icon: 'eye', to: `/ml-plans/${p.id}` },
              {
                key: 'edit',
                label: 'Edit',
                icon: 'pencil',
                hidden: !perms.edit || p.status !== 'draft',
                to: `/ml-plans/${p.id}/edit`,
              },
              {
                key: 'refresh',
                label: 'Refresh',
                icon: 'refresh-cw',
                group: 'workflow',
                hidden: !perms.edit || p.status !== 'draft',
                onSelect: () => onRefresh(p),
              },
              {
                key: 'cancel',
                label: 'Cancel',
                icon: 'x',
                group: 'danger',
                hidden: !perms.edit || p.status === 'cancelled',
                onSelect: () => setToCancel(p),
              },
            ]}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="plan"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {toCancel ? (
        <CancelMlPlanDialog
          plan={toCancel}
          onDone={() => setToCancel(null)}
          onCancel={() => setToCancel(null)}
        />
      ) : null}
    </div>
  );
}
