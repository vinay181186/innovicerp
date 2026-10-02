// BOM Master list (ports legacy renderBOMMaster L8438).
//
// PHASE 4 — composed exactly like the reference list
// (modules/clients/routes/list.tsx), with the one thing this screen adds:
// the row's ▸ (the fit table's one expand control, ADR-199) still reveals the
// part list IN PLACE, right under the row (legacy UX), while the row itself
// opens the detail page.
//
//   <ListHeader>            title · count · ⟳ Updating… · + New BOM; filter bar:
//                           (25 rows a page, ADR-201; search / status / ▾ on the server)
//                           SearchInput · BOM Status dropdown (All | Draft |
//                           Active | Obsolete — no counts, the API returns none;
//                           it replaced the status pills, owner's filter-bar
//                           decision 2026-09-26) · Clear
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//     renderExpanded        the part list, as a nested compact DataTable
//   <ListFooter>            count line · 💡 hint
//   <PageState>             no-access and load-failure
//
// Gone from this file: the hand-rolled sticky band, the bare <input>, the
// pill buttons, the <table>/<colgroup>/<thead>, the three colSpan state rows,
// the badge, the row-action cluster, the second hand-written table inside the
// expanded row and the count line. What stays is the DATA and the RULES: the
// query, the permission gates, the expand set and the URL parameters.
//
// What did NOT change: the route and its search params, the 300ms debounce on
// the URL write, normalizeSearchTerm, the `status` pill writing the same URL
// param the query reads, row click -> detail, BOM No. -> detail, and the
// lazily-fetched part list (one detail request per OPENED row, not per row).

import type { BomStatus } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { statusText } from '@/lib/status-text';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { bomListColumns } from '../components/bom-list-columns';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useBomMaster, useBomMastersList } from '../api';

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['draft', 'active', 'obsolete']).optional(),
  page: pageSearchParam,
});

export const bomMastersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'bom-masters',
  validateSearch: searchSchema,
  component: BomMastersListPage,
});

const STATUS_PILLS: BomStatus[] = ['draft', 'active', 'obsolete'];

function BomMastersListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status, page } = bomMastersListRoute.useSearch();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Search lives in the URL (`search` param) so it survives refresh and Back;
  // the input mirrors it and a debounce writes it back — the SO list shape.
  // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
  // delayed is the URL write, and the box must show the keystroke at once.
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
        to: '/bom-masters',
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, status, navigate]);

  // 25 rows a page (ADR-201); search, status and Sort & Filter run on the
  // server over every BOM, and any change of them goes back to page 1.
  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({
        to: '/bom-masters',
        search: (prev) => ({ ...prev, page: p }),
        replace: true,
      });
    },
    [navigate],
  );
  const sf = useServerSortFilter(TABLE_KEYS.bomMasterList, () => gotoPage(1));
  const offset = pageOffset(page);
  const { data, isLoading, isFetching, isError, error } = useBomMastersList({
    search,
    status,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'bom_create');
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  useClampPage(page, data?.total, gotoPage);

  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const columns = useMemo(() => bomListColumns(offset), [offset]);

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, primary action and the filter
          bar stay put while the rows scroll underneath. */}
      <ListHeader
        title="BOM Master"
        count={total}
        noun="BOM"
        filterNote={status}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search BOM no., name, parent item…"
        updating={isFetching && !isLoading}
        filters={
          <Select
            aria-label="BOM Status"
            title="BOM Status"
            value={status ?? ''}
            options={[
              { value: '', label: 'All' },
              ...STATUS_PILLS.map((v) => ({ value: v, label: statusText(v) })),
            ]}
            onChange={(e) =>
              void navigate({
                to: '/bom-masters',
                search: (prev) => ({
                  ...prev,
                  status: e.target.value === '' ? undefined : (e.target.value as BomStatus),
                  page: 1,
                }),
                replace: true,
              })
            }
          />
        }
        onClearFilters={() => {
          setSearchInput('');
          sf.clearFilters();
          void navigate({ to: '/bom-masters', search: { page: 1 }, replace: true });
        }}
        filtersActive={searchInput.trim() !== '' || status != null || sf.filtering}
        primary={
          perms.entry ? (
            <Link to="/bom-masters/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New BOM
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load BOMs. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.bomMasterList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={search || status || sf.filtering ? 'No BOMs match.' : 'No BOMs yet.'}
            onRowClick={(b) => void navigate({ to: '/bom-masters/$id', params: { id: b.id } })}
            // The part list is fetched only for a row that is actually open —
            // returning null for a collapsed row means ExpandedLines (and its
            // detail query) never mounts for it.
            renderExpanded={(b) => (expanded.has(b.id) ? <ExpandedLines bomId={b.id} /> : null)}
            // The fit table's ▸ is the row's one expand control: it opens the
            // part list too.
            onToggleExpanded={(b) => toggleExpand(b.id)}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="BOM"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
    </div>
  );
}

/** The part list under an opened row. Its own fetch, so the list endpoint
 *  stays a single request and only the rows actually opened cost anything. */
function ExpandedLines({ bomId }: { bomId: string }): React.JSX.Element {
  const { data, isLoading } = useBomMaster(bomId);

  const columns = useMemo<DataTableColumn<NonNullable<typeof data>['lines'][number]>[]>(
    () => [
      {
        header: 'Sr No',
        width: '6%',
        className: 'mono fw-700',
        align: 'right',
        render: (_l, i) => i + 1,
      },
      {
        header: 'Item Code',
        className: 'td-code',
        nowrap: true,
        render: (l) => l.childItemCode ?? '—',
      },
      {
        header: 'Item Name',
        align: 'left',
        render: (l) => l.childItemName ?? '—',
        title: (l) => l.childItemName ?? '',
      },
      {
        header: 'Qty / Set',
        align: 'right',
        className: 'mono fw-700',
        nowrap: true,
        render: (l) => Number(l.qtyPerSet),
      },
      {
        header: 'BOM Type',
        nowrap: true,
        render: (l) => <BomTypeBadge type={l.bomType} />,
      },
    ],
    [],
  );

  if (isLoading) {
    return <PageState as="inline" state="loading" message="⟳ Loading lines…" />;
  }
  if (!data) return <PageState as="inline" state="empty" message="—" />;

  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        className="mono fw-700"
        style={{ fontSize: 'var(--fs-xs)', color: 'var(--cyan)', marginBottom: 'var(--sp-1)' }}
      >
        ▸ Part List — {data.bomNo}
      </div>
      {/* `compact` is the nested-line-table density — the same sheet, one step
          tighter, because it sits inside a row of the sheet above it. */}
      <DataTable columns={columns} rows={data.lines} density="compact" emptyText="No lines yet." />
    </div>
  );
}

/** Not a status chip — a one-word marker of how the child part is obtained.
 *  Local to this screen; nothing else renders a BOM line's type. */
function BomTypeBadge({ type }: { type: string }): React.JSX.Element {
  const cfg = {
    manufacture: { label: '🏭 Manufacture', color: 'var(--cyan)' },
    purchase: { label: '🛒 Buy', color: 'var(--green2)' },
    outsource: { label: '🏭 Outsource', color: 'var(--amber2)' },
  }[type] ?? { label: type, color: 'var(--text3)' };
  return (
    <span className="fw-700" style={{ color: cfg.color, fontSize: 'var(--fs-xs)' }}>
      {cfg.label}
    </span>
  );
}
