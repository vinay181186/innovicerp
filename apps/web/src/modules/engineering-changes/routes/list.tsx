// Engineering Change list (ADR-291). Composed like the Multi-Level Plan list:
// ListHeader · Panel + DataTable (fit table, server Sort & Filter, 25 rows a
// page) · ListFooter · PageState. ECR Status is filtered from its column ▾.
// Row actions live in the ⋯ menu (Open, Edit while Draft, Cancel…).

import type { EcrListRow } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useEcrList } from '../api';
import { EcrCancelDialog } from '../components/ecr-cancel-dialog';
import { ecrListColumns } from '../components/ecr-list-columns';

const searchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const ecrListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ecrs',
  validateSearch: searchSchema,
  component: EcrListPage,
});

function EcrListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, page } = ecrListRoute.useSearch();

  // Search lives in the URL; the box mirrors it and a debounce writes it back.
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
        to: '/ecrs',
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, navigate]);

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ to: '/ecrs', search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  const sf = useServerSortFilter(TABLE_KEYS.ecrList, () => gotoPage(1));
  const offset = pageOffset(page);
  const { data, isLoading, isFetching, isError, error } = useEcrList({
    ...(search ? { search } : {}),
    ...(sf.param ? { sf: sf.param } : {}),
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const { data: eff } = useMyAccess();
  const { data: me } = useSession();
  const perms = effectiveFormPerms(eff, 'ecr_create');
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  useClampPage(page, data?.total, gotoPage);
  const columns = useMemo(() => ecrListColumns(offset), [offset]);
  const [toCancel, setToCancel] = useState<EcrListRow | null>(null);

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  // The raiser (with Entry) or an editor may change / cancel an open ECR.
  const mayWrite = (r: EcrListRow): boolean =>
    perms.edit || (perms.entry && !!me && r.createdBy === me.id);
  const mayCancel = (r: EcrListRow): boolean =>
    (r.status === 'draft' || r.status === 'submitted') && mayWrite(r);

  return (
    <div className="page-fill">
      <ListHeader
        title="Engineering Change"
        icon="🔁"
        count={total}
        noun="ECR"
        nounPlural="ECRs"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search ECR No., item code, item name, Drawing Rev, replacement item…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          sf.clearFilters();
          void navigate({ to: '/ecrs', search: { page: 1 }, replace: true });
        }}
        filtersActive={searchInput.trim() !== '' || sf.filtering}
        primary={
          perms.entry ? (
            <Link to="/ecrs/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New ECR
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load ECRs. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.ecrList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={search || sf.filtering ? 'No ECRs match.' : 'No ECRs yet.'}
            onRowClick={(r) => void navigate({ to: '/ecrs/$id', params: { id: r.id } })}
            renderLink={(p) => <Link {...p} />}
            rowMenu={(r) => [
              { key: 'open', label: 'Open', icon: 'eye', to: `/ecrs/${r.id}` },
              {
                key: 'edit',
                label: 'Edit',
                icon: 'pencil',
                hidden: !mayWrite(r) || r.status !== 'draft',
                to: `/ecrs/${r.id}/edit`,
              },
              {
                key: 'cancel',
                label: 'Cancel ECR…',
                icon: 'x',
                group: 'danger',
                hidden: !mayCancel(r),
                onSelect: () => setToCancel(r),
              },
            ]}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="ECR"
        nounPlural="ECRs"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {toCancel ? (
        <EcrCancelDialog
          ecr={toCancel}
          onDone={() => setToCancel(null)}
          onCancel={() => setToCancel(null)}
        />
      ) : null}
    </div>
  );
}
