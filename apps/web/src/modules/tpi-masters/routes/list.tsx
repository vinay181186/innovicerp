// TPI Master list — the third-party inspectors the TPI screen's Inspector field
// now picks from. Mirrors the QC Process Master list (its sibling in the Quality
// → Master menu), with one deliberate difference: this is a master, so it
// scrolls in ONE fetch instead of paging (styling skill, rule 4). 200 is the
// cap listTpiMastersQuerySchema allows, and an inspector list is tens of rows.
//
// `code` holds the inspector's NAME, so the column reads "Inspector Name" — see
// packages/shared/src/schemas/tpi-master.ts.
//
// PHASE 4 — migrated onto apps/web/src/ui/ with the Client Master list
// (modules/clients/routes/list.tsx) as the reference. The composition is the
// canonical one and nothing else:
//
//   <ListHeader>            title · count · primary; filter bar: SearchInput · Active · Clear
//   <Banner>                a refused delete, in the server's own words
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · 💡 hint
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the sticky band, the search box,
// the Active <select>, the <table>/<colgroup>/<thead>, the loading / error /
// empty rows, the badge, the row-action buttons, the count line, the hint,
// `confirm()` — now comes from ui/. What is left here is the DATA and the
// RULES: the query, the permission gates and the delete.
//
// What did NOT change: the route and its search params (search, isActive), the
// 300ms debounce on the URL write, normalizeSearchTerm, the single un-paged
// fetch capped at 200, perms -> entry/edit/canDelete, the softDelete.reset()
// before each attempt so a second try clears the previous banner, row click ->
// detail, the name cell -> detail.
//
// THE ONE BEHAVIOUR THAT DID CHANGE, deliberately: Delete no longer runs on a
// browser `confirm()`. It raises the shared ConfirmDialog through RowActions,
// which owns the wait — both buttons go dead, the button reads "Deleting…",
// and a refusal from the server keeps the question open instead of closing
// over a delete that never happened.

import type { ListTpiMastersQuery, TpiMaster } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useSoftDeleteTpiMaster, useTpiMastersList } from '../api';

const LIST_LIMIT = 200;

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const tpiMastersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi-masters',
  validateSearch: listSearchSchema,
  component: TpiMastersListPage,
});

function TpiMastersListPage(): React.JSX.Element {
  const search = tpiMastersListRoute.useSearch();
  const navigate = tpiMastersListRoute.useNavigate();
  // Tier-driven, per department (QC) — same gate shape as QC Process Master.
  // Add is `entry`, Edit is `edit`, Del is the L5-and-above pair below.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'tpimaster_create');
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve.
  const canDelete = perms.edit && perms.approve;

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
    // "  Bureau  Veritas " and "Bureau Veritas" are one query, one cache entry,
    // one URL.
    //
    // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
    // delayed is the URL write, and the box must show the keystroke at once.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListTpiMastersQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.isActive],
  );

  const { data, isLoading, isFetching, isError, error } = useTpiMastersList(query);
  const softDelete = useSoftDeleteTpiMaster();

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  // The sheet's columns, unchanged from the hand-written <colgroup>: the widths
  // are `%` and must sum to 100 WITH the Action column (rowActionsWidth below):
  // 5+22+24+12+19+8 = 90, + 10 = 100, so the table never scrolls sideways.
  // Centred by the standard; only the inspector's name is left-aligned (a name
  // reads from its left edge), and the free text that runs long ellipsizes with
  // the whole value on hover.
  const columns = useMemo<DataTableColumn<TpiMaster>[]>(
    () => [
      { header: 'Sr No', width: '5%', className: 'text3', render: (_t, i) => i + 1 },
      {
        header: 'Inspector Name',
        width: '22%',
        align: 'left',
        ellipsis: true,
        title: (t) => t.code,
        // The master code (the inspector's name) — strong (mono fw-700 in
        // --text), never the faint --text3, and a real link so it can be
        // ctrl/middle-clicked into a new tab. stopPropagation sits on the link
        // (not the cell) so clicking the rest of the cell still opens the row.
        render: (t) => (
          <Link
            to="/tpi-masters/$id"
            params={{ id: t.id }}
            className="mono fw-700"
            style={{ color: 'var(--text)', textDecoration: 'none' }}
            title="Open this inspector"
            onClick={(e) => e.stopPropagation()}
          >
            {t.code}
          </Link>
        ),
      },
      {
        header: 'Organisation',
        width: '24%',
        className: 'text2',
        ellipsis: true,
        render: (t) => t.organization ?? '—',
        title: (t) => t.organization ?? '',
      },
      {
        header: 'Contact No.',
        width: '12%',
        className: 'mono',
        nowrap: true,
        render: (t) => t.contactNo ?? '—',
      },
      {
        header: 'Email',
        width: '19%',
        className: 'text2',
        ellipsis: true,
        render: (t) => t.email ?? '—',
        title: (t) => t.email ?? '',
      },
      {
        header: 'Active',
        width: '8%',
        nowrap: true,
        // kind="masteractive": a Quality master paints Inactive AMBER, not the
        // generic `active` kind's red — the row is retired from the TPI
        // pickers, which is a thing to notice, not a fault. Carried verbatim,
        // and the TPI detail page now draws the same chip, so the two cannot
        // disagree.
        render: (t) => <StatusBadge kind="masteractive" status={String(t.isActive)} />,
      },
    ],
    [],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load. Sits after every hook so the early
  // return never trips rules-of-hooks.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, search, the Active filter and
          the primary action stay put while the rows scroll underneath. */}
      <ListHeader
        title="TPI Master"
        icon="🔍"
        // Count is the list response's `total` — the only aggregate the
        // endpoint returns.
        count={total}
        noun="inspector"
        filterNote={
          search.isActive === undefined ? undefined : search.isActive ? 'Active' : 'Inactive'
        }
        search={searchInput}
        onSearch={setSearchInput}
        updating={isFetching && !isLoading}
        filters={
          <Select
            aria-label="Active"
            title="Active"
            value={search.isActive === undefined ? '' : String(search.isActive)}
            options={[
              { value: '', label: 'All' },
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ]}
            onChange={(e) => {
              const v = e.target.value;
              void navigate({
                search: (prev) => ({ ...prev, isActive: v === '' ? undefined : v === 'true' }),
                replace: true,
              });
            }}
          />
        }
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, isActive: undefined, search: undefined }),
            replace: true,
          });
        }}
        filtersActive={search.isActive !== undefined || searchInput.trim() !== ''}
        primary={
          perms.entry ? (
            <Link to="/tpi-masters/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> Add Inspector
            </Link>
          ) : null
        }
      />

      {/* Why a banner and not a toast: the delete may be refused for a reason
          the user has to act on (retire the inspector as Inactive instead). It
          stays on screen until the next attempt. */}
      {softDelete.error ? (
        <Banner tone="error" role="alert">
          ⚠ {softDelete.error.message}
        </Banner>
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load TPI Inspectors. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText="No inspectors defined. Click + Add Inspector."
            onRowClick={(t) => void navigate({ to: '/tpi-masters/$id', params: { id: t.id } })}
            rowActionsWidth="10%"
            rowActions={(t) => (
              <RowActions
                // View and Edit are ROUTES, so they stay real links —
                // ctrl-click / middle-click still open a new tab.
                viewTo={`/tpi-masters/${t.id}`}
                editTo={perms.edit ? `/tpi-masters/${t.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // The PROMISE is handed back, not swallowed: the confirm dialog
                // owns the wait, and a refusal from the server keeps the
                // question open instead of closing over a delete that never
                // happened. reset() first so a second attempt clears the
                // previous banner.
                onDelete={
                  canDelete
                    ? (): Promise<void> => {
                        softDelete.reset();
                        return softDelete.mutateAsync(t.id);
                      }
                    : undefined
                }
                // And every OTHER row's Delete greys out while one is in
                // flight, exactly as `disabled={softDelete.isPending}` did.
                deleteDisabled={softDelete.isPending}
                deleteConfirm={{
                  title: `Delete inspector "${t.code}"?`,
                  message: `${t.code} stops appearing in the TPI Master and in the TPI screen's Inspector picker.`,
                  pendingLabel: 'Deleting…',
                }}
              />
            )}
          />
        </Panel>
      )}

      {/* One fetch, no pager: `limit` makes the count line say "Showing first
          200 of N — refine with search" once the master outgrows the cap. */}
      <ListFooter
        total={total}
        noun="inspector"
        limit={LIST_LIMIT}
        hint="Click a row to open it."
      />
    </div>
  );
}
