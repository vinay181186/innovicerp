// QC Process Master list — Phase A item 3. Mirrors legacy renderQCProcessMaster (L23446).
//
// PHASE 4 — migrated onto apps/web/src/ui/ with the Client Master list
// (modules/clients/routes/list.tsx) as the reference. The composition is the
// canonical one and nothing else:
//
//   <TabStrip>              QC Processes | Report Types
//   <ListHeader>            title · count · SearchInput · Active filter · primary
//   <Panel>                 the 💡 what-this-master-is-for note
//   <Banner>                a refused delete, in the server's own words
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · Prev / Page n / Next
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the tab strip, the sticky band,
// the search box, the Active <select>, the <table>/<colgroup>/<thead>, the
// loading / error / empty rows, the badge, the row-action buttons, the count
// line, the pager, `confirm()` — now comes from ui/. What is left here is the
// DATA and the RULES: the query, the permission gates and the delete.
//
// What did NOT change: the route and its search params (search, isActive,
// page, tab), the 300ms debounce on the URL write, normalizeSearchTerm, the
// 25-row server page, perms -> entry/edit/canDelete, the softDelete.reset()
// before each attempt so a second try clears the previous banner, row click ->
// detail, the code cell -> detail, and the Report Types tab (a separate
// component, untouched).
//
// THE ONE BEHAVIOUR THAT DID CHANGE, deliberately: Delete no longer runs on a
// browser `confirm()`. It raises the shared ConfirmDialog through RowActions,
// which owns the wait — both buttons go dead, the button reads "Deleting…",
// and a refusal from the server keeps the question open instead of closing
// over a delete that never happened.

import type { ListQcProcessesQuery, QcProcess } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { ReportTypesPanel } from '@/modules/report-types/components/report-types-panel';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useQcProcessesList, useSoftDeleteQcProcess } from '../api';

const PAGE_SIZE = 25;

const TABS = [
  { key: 'processes', label: '⚙ QC Processes' },
  { key: 'reports', label: '📄 Report Types' },
];

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  // Second tab: the Report / Document Master, folded in from the former
  // standalone /report-master screen.
  tab: z.enum(['reports']).optional(),
});

export const qcProcessesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-processes',
  validateSearch: listSearchSchema,
  component: QcProcessesListPage,
});

function QcProcessesListPage(): React.JSX.Element {
  const search = qcProcessesListRoute.useSearch();
  const navigate = qcProcessesListRoute.useNavigate();
  // Tier-driven, per department (QC). The old gate was admin/manager only —
  // narrower than every sibling QC screen, so a QC lead could not maintain the
  // master they run. Add is `entry`, Edit is `edit`, Del is the L5-and-above
  // pair below.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'qcprocess_create');
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve. L3
  // Editor has edit without approve; L4 Approver has approve without edit. The
  // owner decided L5 gets delete rights — admin-only was locking out the very
  // tier meant to run the department.
  const canDelete = perms.edit && perms.approve;

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  Final  Inspection " and "Final Inspection" are one query, one cache entry, one URL.
    //
    // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
    // delayed is the URL write, and the box must show the keystroke at once.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListQcProcessesQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.isActive, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useQcProcessesList(query);
  const softDelete = useSoftDeleteQcProcess();

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const currentPage = search.page;
  const tab = search.tab ?? 'processes';

  // The sheet's columns, unchanged from the hand-written <colgroup>: the widths
  // are `%` and must sum to 100 WITH the Action column (rowActionsWidth below):
  // 5+24+40+11+10 = 90, + 10 = 100, so the table never scrolls sideways.
  // Centred by the standard; only the process name is left-aligned (a name
  // reads from its left edge).
  const columns = useMemo<DataTableColumn<QcProcess>[]>(
    () => [
      {
        header: 'Sr No',
        width: '5%',
        className: 'text3',
        // Server-paged list: the serial number continues across pages.
        render: (_p, i) => (currentPage - 1) * PAGE_SIZE + i + 1,
      },
      {
        header: 'QC Process Name',
        width: '24%',
        align: 'left',
        ellipsis: true,
        title: (p) => p.code,
        // The master code — strong (mono fw-700 in --text), never the faint
        // --text3, and a real link so it can be ctrl/middle-clicked into a new
        // tab. stopPropagation sits on the link (not the cell) so clicking the
        // rest of the cell still opens the row, exactly as before.
        render: (p) => (
          <Link
            to="/qc-processes/$id"
            params={{ id: p.id }}
            className="mono fw-700"
            style={{ color: 'var(--text)', textDecoration: 'none' }}
            title="Open this QC process"
            onClick={(e) => e.stopPropagation()}
          >
            {p.code}
          </Link>
        ),
      },
      {
        header: 'Description',
        width: '40%',
        className: 'text2',
        ellipsis: true,
        render: (p) => p.description ?? '—',
        title: (p) => p.description ?? '',
      },
      {
        header: 'Std Time (min)',
        width: '11%',
        className: 'mono',
        nowrap: true,
        render: (p) =>
          Number(p.defaultCycleTimeMin) > 0 ? Number(p.defaultCycleTimeMin).toFixed(2) : '—',
      },
      {
        header: 'Active',
        width: '10%',
        nowrap: true,
        // kind="masteractive": a Quality master paints Inactive AMBER, not the
        // generic `active` kind's red — the row is retired from the QC pickers,
        // which is a thing to notice, not a fault. Carried verbatim, and it is
        // the same chip the QC process DETAIL page draws, so the two cannot
        // disagree.
        render: (p) => <StatusBadge kind="masteractive" status={String(p.isActive)} />,
      },
    ],
    [currentPage],
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
      {/* QC Processes | Report Types tabs (Report Types is the former standalone
          Report / Document Master screen). */}
      <TabStrip
        label="QC master"
        tabs={TABS}
        activeKey={tab}
        onChange={(k) =>
          void navigate({
            search: (prev) => ({ ...prev, tab: k === 'processes' ? undefined : 'reports' }),
            replace: true,
          })
        }
      />

      {tab === 'reports' ? (
        <ReportTypesPanel />
      ) : (
        <>
          {/* The frozen header band: title, count, search, the Active filter
              and the primary action stay put while the rows scroll
              underneath. */}
          <ListHeader
            title="QC Process Master"
            icon="⚙"
            // Count is the list response's `total` — the only aggregate the
            // endpoint returns.
            count={total}
            noun="process"
            nounPlural="processes"
            filterNote={
              search.isActive === undefined ? undefined : search.isActive ? 'Active' : 'Inactive'
            }
            search={searchInput}
            onSearch={setSearchInput}
            updating={isFetching && !isLoading}
            tools={
              <Select
                aria-label="Active"
                fieldWidth="md"
                value={search.isActive === undefined ? '' : String(search.isActive)}
                options={[
                  { value: '', label: 'All' },
                  { value: 'true', label: 'Active' },
                  { value: 'false', label: 'Inactive' },
                ]}
                onChange={(e) => {
                  const v = e.target.value;
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      isActive: v === '' ? undefined : v === 'true',
                      page: 1,
                    }),
                    replace: true,
                  });
                }}
              />
            }
            primary={
              perms.entry ? (
                <Link to="/qc-processes/new" className="btn btn-primary">
                  <Icon name="plus" size={14} /> Add QC Process
                </Link>
              ) : null
            }
          />

          {/* What this master is for. It sits ABOVE the sheet, not in the
              ListFooter hint, because it is read once before the first row is
              created — not a hint about operating the list. */}
          <Panel>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text2)' }}>
              💡 Define QC inspection processes here (e.g. Dimensional Check, Hardness Test, CMM
              Inspection). These can be added as <b>QC operations</b> in Route Cards and Job Cards,
              just like machining operations.
            </span>
          </Panel>

          {/* Why a banner and not a toast: the delete is refused for a reason the
          user has to act on (retire it as Inactive instead), and that sentence
          names the documents holding it. It stays on screen until the next
          attempt. */}
          {softDelete.error ? (
            <Banner tone="error" role="alert">
              ⚠ {softDelete.error.message}
            </Banner>
          ) : null}

          {isError ? (
            <PageState
              state="error"
              message={error instanceof Error ? error.message : 'Failed to load QC processes'}
            />
          ) : (
            <Panel bodyPadding="none">
              <DataTable
                columns={columns}
                rows={rows}
                loading={isLoading}
                emptyText="No QC processes defined. Click + Add QC Process."
                onRowClick={(p) => void navigate({ to: '/qc-processes/$id', params: { id: p.id } })}
                rowActionsWidth="10%"
                rowActions={(p) => (
                  <RowActions
                    // View and Edit are ROUTES, so they stay real links —
                    // ctrl-click / middle-click still open a new tab.
                    viewTo={`/qc-processes/${p.id}`}
                    editTo={perms.edit ? `/qc-processes/${p.id}/edit` : undefined}
                    renderLink={(p2) => <Link {...p2} />}
                    // The PROMISE is handed back, not swallowed: the confirm
                    // dialog owns the wait, and the server's refusal (a process
                    // job cards, plans or route cards still name —
                    // qc-processes/service.ts) keeps the question open instead
                    // of closing over a delete that never happened. reset()
                    // first so a second attempt clears the previous banner.
                    onDelete={
                      canDelete
                        ? (): Promise<void> => {
                            softDelete.reset();
                            return softDelete.mutateAsync(p.id);
                          }
                        : undefined
                    }
                    // And every OTHER row's Delete greys out while one is in
                    // flight, exactly as `disabled={softDelete.isPending}` did.
                    deleteDisabled={softDelete.isPending}
                    deleteConfirm={{
                      title: `Delete QC process "${p.code}"?`,
                      message: `${p.code} stops appearing in the QC Process Master and in every QC operation picker.`,
                      pendingLabel: 'Deleting…',
                    }}
                  />
                )}
              />
            </Panel>
          )}

          <ListFooter
            total={total}
            noun="QC process"
            nounPlural="QC processes"
            // Server-paged register: `page` switches the footer to the
            // Prev/Next pager, the same one this screen drew by hand.
            page={currentPage}
            pageSize={PAGE_SIZE}
            onPage={(p) =>
              void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })
            }
          />
        </>
      )}
    </div>
  );
}
