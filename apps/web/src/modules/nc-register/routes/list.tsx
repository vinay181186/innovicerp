// NC register list (UI-003-06) — ONE ROW PER NC on the shared FIT table
// (ADR-199: <DataTable tableKey=…>), the fit engine sizing columns to the screen
// and dropping the rightmost unpinned ones into a ▸ detail row when it is too
// narrow. Row click opens the NC; the ▸ reveals POL, JC No., Op, Rework done and
// the linked CAPA (NcExpanded). Replaces the hand-built card list.
//
// Columns (first pinned) + tint + the per-row ⋯ menu live in
// components/nc-list-columns.tsx so this file stays under the 400-line ceiling.
// CAPA stays folded in as a tab; the NC filters, StatStrip and permission gates
// are unchanged.

import {
  type ListNcRegisterQuery,
  type NcRegisterListItem,
  NC_REASON_CATEGORIES,
  NC_STATUSES,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, PageState } from '@/ui/layout';
import { CapaView } from '@/modules/capa/components/capa-view';
import { useNcRegisterList, useNcRegisterSummary } from '../api';
import { NcListHeader } from '../components/nc-list-header';
import {
  NC_LIST_HIDDEN_COLUMNS,
  NcExpanded,
  ncListColumns,
  ncRowMenu,
  ncRowTint,
} from '../components/nc-list-columns';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(NC_STATUSES).optional(),
  reasonCategory: z.enum(NC_REASON_CATEGORIES).optional(),
  page: z.coerce.number().int().positive().default(1),
  // Deep-link seed for Global Search: `?tab=capa&capa=CAPA-0003` lands on
  // the CAPA tab with its box pre-filled. Read once into local tab state.
  // `capa` is separate from `search` on purpose — `search` is the NC list's
  // own server filter and must not be touched by a CAPA landing.
  tab: z.enum(['nc', 'capa']).optional(),
  capa: z.string().optional(),
  // `capaEdit=1` — open that CAPA in its 5-step edit (set by NC Detail's
  // "Create CAPA", so the user lands on the root-cause/actions work).
  capaEdit: z.coerce.boolean().optional(),
});

export const ncRegisterListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register',
  validateSearch: listSearchSchema,
  component: NcRegisterListPage,
});

function NcRegisterListPage(): React.JSX.Element {
  const search = ncRegisterListRoute.useSearch();
  const navigate = ncRegisterListRoute.useNavigate();
  const { data: eff } = useMyAccess();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  NC  0012 " and "NC 0012" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss NCs. Every change goes back to
  // page 1.
  const sf = useServerSortFilter(TABLE_KEYS.ncRegister, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const query: ListNcRegisterQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      reasonCategory: search.reasonCategory,
      sf: sf.param,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [sf.param, search.search, search.status, search.reasonCategory, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useNcRegisterList(query);
  const { data: summary } = useNcRegisterSummary();
  // Tier-driven, per department (QC). Was a global role string
  // (admin||manager||operator), which handed dispose rights to a manager whose
  // QC tier is L1 view-only and withheld them from a QC L3 Editor.
  const ncPerms = effectiveFormPerms(eff, 'nc_dispose');
  // Reporting an NC creates a record → entry. Disposing / closing rework
  // rewrites a saved one → edit.
  const canReportNc = ncPerms.entry;
  const canDispose = ncPerms.edit;
  // The CAPA button creates a CAPA, so it follows the CAPA form key — gating it
  // on nc_dispose meant the button could open a form the API then refused.
  const canCreateCapa = effectiveFormPerms(eff, 'capa_create').entry;

  // Screen-merge: CAPA folded in as a tab (it used to be its own /capa page,
  // which stays registered). Tab choice is local: the `?tab` URL param is a
  // ONE-TIME seed for deep links (Global Search), read here lazily; the tab
  // click itself does not navigate, so the NC list's own ?search/?status/?page
  // params are untouched by switching tabs.
  const [tab, setTab] = useState<'nc' | 'capa'>(() => search.tab ?? 'nc');

  // ▸ expand: the caller owns the open set; the fit table's ▸ is the row's one
  // expand control (onToggleExpanded), and renderExpanded returns null for a
  // collapsed row.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }, []);

  // The NC whose ⋯ → Assign Task is open (one modal for the whole list).
  const [assignTarget, setAssignTarget] = useState<NcRegisterListItem | null>(null);

  const openCapa = useCallback(
    (capaCode: string): void => {
      void navigate({ search: (prev) => ({ ...prev, tab: 'capa', capa: capaCode }) });
      setTab('capa');
    },
    [navigate],
  );

  const columns = useMemo(() => ncListColumns(), []);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load. Sits after every hook so the early
  // return never trips rules-of-hooks.
  if (eff && !ncPerms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  const emptyText =
    sf.filtering || search.search || search.status || search.reasonCategory
      ? 'No NCs match.'
      : 'No NCs yet.';

  const tabBar = (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--border)',
        marginBottom: 14,
      }}
    >
      {(
        [
          ['nc', 'NC Register'],
          ['capa', 'CAPA'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: tab === key ? '2px solid var(--cyan)' : '2px solid transparent',
            color: tab === key ? 'var(--cyan)' : 'var(--text3)',
            fontSize: 12,
            fontWeight: 700,
            padding: '6px 12px',
            cursor: 'pointer',
            marginBottom: -1,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {tabBar}
      {tab === 'capa' ? (
        // key: a new ?capa landing while already on this page remounts the
        // view so it re-seeds; nothing else changes the key.
        <CapaView
          key={search.capa ?? ''}
          initialSearch={search.capa}
          openForEdit={search.capaEdit}
        />
      ) : (
        <>
          <NcListHeader
            count={data ? total : undefined}
            searchInput={searchInput}
            onSearch={setSearchInput}
            updating={isFetching && !isLoading}
            status={search.status}
            reasonCategory={search.reasonCategory}
            onStatusChange={(v) =>
              void navigate({
                search: (prev) => ({ ...prev, status: v, page: 1 }),
                replace: true,
              })
            }
            onReasonChange={(v) =>
              void navigate({
                search: (prev) => ({ ...prev, reasonCategory: v, page: 1 }),
                replace: true,
              })
            }
            onClearFilters={() => {
              sf.clearFilters();
              setSearchInput('');
              void navigate({
                search: (prev) => ({
                  ...prev,
                  status: undefined,
                  reasonCategory: undefined,
                  search: undefined,
                  page: 1,
                }),
                replace: true,
              });
            }}
            columnFiltering={sf.filtering}
            canReportNc={canReportNc}
            summary={summary}
          />

          {isError ? (
            <PageState
              state="error"
              message={error instanceof Error ? error.message : 'Could not load NCs. Try again.'}
            />
          ) : (
            <Panel bodyPadding="none">
              <DataTable
                tableKey={TABLE_KEYS.ncRegister}
                columns={columns}
                rows={rows}
                loading={isLoading}
                emptyText={emptyText}
                rowKey={(nc) => nc.id}
                // Server-paginated page: the column ▾ sort / filter runs on the
                // server (ADR-200), over every NC, not this page only.
                sortFilterServer={sf}
                defaultHidden={NC_LIST_HIDDEN_COLUMNS}
                onRowClick={(nc) =>
                  void navigate({ to: '/nc-register/$id', params: { id: nc.id } })
                }
                rowClassName={(nc) => ncRowTint(nc.status)}
                rowMenu={(nc) =>
                  ncRowMenu(nc, { canDispose, canCreateCapa, onAssign: setAssignTarget })
                }
                renderLink={(p) => <Link {...p} />}
                renderExpanded={(nc) =>
                  expandedIds.has(nc.id) ? <NcExpanded nc={nc} onOpenCapa={openCapa} /> : null
                }
                onToggleExpanded={(nc) => toggleExpand(nc.id)}
              />
            </Panel>
          )}

          <ListFooter
            total={total}
            noun="NC"
            page={currentPage}
            pageSize={PAGE_SIZE}
            onPage={(p) =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, Math.max(1, p)) }),
                replace: true,
              })
            }
          />
        </>
      )}

      {assignTarget ? (
        <AssignTaskModal
          linkedRef={{
            type: 'nc',
            id: assignTarget.id,
            display: `NC ${assignTarget.code}`,
            navPage: `/nc-register/${assignTarget.id}`,
          }}
          suggestedTitle={
            assignTarget.status === 'pending'
              ? `Dispose ${assignTarget.code}`
              : `Review ${assignTarget.code}`
          }
          onClose={() => setAssignTarget(null)}
        />
      ) : null}
    </div>
  );
}
