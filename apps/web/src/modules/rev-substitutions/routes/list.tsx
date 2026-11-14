// Rev Substitutions (ADR-292, Design menu): every Engineering-approved use of
// one Drawing Rev's stock where an SO line / JWSO line / Job Card asks for
// another. Composed like the Engineering Change list: ListHeader · Panel +
// DataTable (fit table, server Sort & Filter, 25 rows a page) · ListFooter ·
// PageState. ⋯ Cancel… only while nothing has been used (Qty Used = 0).

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
import { ConfirmDialog, useToast } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { type RevSubstitutionRow, useCancelRevSubstitution, useRevSubstitutions } from '../api';
import { NewRevSubDialog } from '../components/new-rev-sub-dialog';
import { revSubColumns, scopeText } from '../components/rev-sub-columns';

const searchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const revSubstitutionsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'rev-substitutions',
  validateSearch: searchSchema,
  component: RevSubstitutionsPage,
});

function RevSubstitutionsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, page } = revSubstitutionsRoute.useSearch();

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
        to: '/rev-substitutions',
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, navigate]);

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({
        to: '/rev-substitutions',
        search: (prev) => ({ ...prev, page: p }),
        replace: true,
      });
    },
    [navigate],
  );
  const sf = useServerSortFilter(TABLE_KEYS.revSubstitutions, () => gotoPage(1));
  const offset = pageOffset(page);
  const { data, isLoading, isFetching, isError, error } = useRevSubstitutions({
    ...(search ? { search } : {}),
    ...(sf.param ? { sf: sf.param } : {}),
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ecr_create');
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  useClampPage(page, data?.total, gotoPage);
  const columns = useMemo(() => revSubColumns(offset), [offset]);
  const [newOpen, setNewOpen] = useState(false);
  const [toCancel, setToCancel] = useState<RevSubstitutionRow | null>(null);
  const cancel = useCancelRevSubstitution();
  const toast = useToast();

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div className="page-fill">
      <ListHeader
        title="Rev Substitutions"
        icon="🔀"
        count={total}
        noun="substitution"
        nounPlural="substitutions"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search item code, Drawing Rev, SO / JWSO / Job Card No., reason, approved by…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          sf.clearFilters();
          void navigate({ to: '/rev-substitutions', search: { page: 1 }, replace: true });
        }}
        filtersActive={searchInput.trim() !== '' || sf.filtering}
        primary={
          perms.approve ? (
            <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={14} /> New Substitution
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load Rev Substitutions. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.revSubstitutions}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={search || sf.filtering ? 'No substitutions match.' : 'No substitutions yet.'}
            renderLink={(p) => <Link {...p} />}
            rowMenu={(r) => [
              {
                key: 'cancel',
                label: 'Cancel…',
                icon: 'x',
                group: 'danger',
                hidden: !perms.approve,
                disabledReason: r.qtyUsed > 0 ? 'Already used' : undefined,
                onSelect: () => setToCancel(r),
              },
            ]}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="substitution"
        nounPlural="substitutions"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {newOpen ? <NewRevSubDialog onClose={() => setNewOpen(false)} /> : null}
      {toCancel ? (
        <ConfirmDialog
          title="Cancel this substitution?"
          message={`${toCancel.itemCode ?? ''} ${toCancel.fromLabel} for ${toCancel.toLabel} · ${scopeText(toCancel)}. Issue and dispatch can no longer use it.`}
          confirmLabel="Cancel Substitution"
          cancelLabel="Keep"
          pendingLabel="Cancelling…"
          tone="danger"
          onCancel={() => setToCancel(null)}
          onConfirm={async () => {
            await cancel.mutateAsync({ id: toCancel.id });
            toast.ok('Substitution cancelled');
            setToCancel(null);
          }}
        />
      ) : null}
    </div>
  );
}
