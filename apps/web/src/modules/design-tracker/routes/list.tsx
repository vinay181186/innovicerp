// Design Tracker (Design slice B) — per-SO design assignment.
// Mirrors legacy renderDesignTracker (HTML L7259) + helpers L7338–7489.
//
// ADR-199 table standard (2026-10-01): the tracker is the ONE fit table
// (<DataTable tableKey={TABLE_KEYS.designTracker}>). The column defs, row tint,
// ⋯ menu and ▸ detail live in components/design-tracker-columns.tsx; the three
// dialogs live in components/{add,edit,log-time}-design-modal.tsx. This file
// owns the page: query, filters, access gates and the modal / confirm wiring.
//
// ADR-201: 25 designs a page (page in the URL). Search, the status filter and
// the column ▾ Sort & Filter run on the server over every design; any change of
// them goes back to page 1. The filter counts come from the server over the
// same search + Sort & Filter.

import { type DesignTrackerListItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import {
  useApproveDesign,
  useDesignTrackerList,
  useReviseDesign,
  useSubmitDesignReview,
} from '../api';
import { AddDesignModal } from '../components/add-design-modal';
import {
  DesignTrackerExpanded,
  designTrackerColumns,
  designTrackerRowMenu,
  designTrackerRowTint,
} from '../components/design-tracker-columns';
import { EditDesignModal } from '../components/edit-design-modal';
import { LogTimeModal } from '../components/log-time-modal';

type FilterKey = 'all' | 'pending' | 'progress' | 'review' | 'approved' | 'overdue';

const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'All',
  pending: 'Pending',
  progress: 'In Progress',
  review: 'Review',
  approved: 'Approved',
  overdue: 'Overdue',
};

// Deep-link seed for Global Search (no detail page here): `?search=DT-0012`
// pre-fills the search box. Read ONCE (lazy useState); typing stays local.
const searchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const designTrackerListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-tracker',
  validateSearch: searchSchema,
  component: DesignTrackerListPage,
});

function DesignTrackerListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'design_create');
  const routeSearch = designTrackerListRoute.useSearch();
  const routeNavigate = designTrackerListRoute.useNavigate();
  const page = routeSearch.page;
  const [search, setSearch] = useState(() => routeSearch.search ?? '');
  const [term, setTerm] = useState<string | undefined>(
    () => normalizeSearchTerm(routeSearch.search ?? '') || undefined,
  );
  const [filter, setFilter] = useState<FilterKey>('all');
  const gotoPage = useCallback(
    (p: number): void => {
      void routeNavigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [routeNavigate],
  );
  // Debounced search → server; a new term goes back to page 1.
  useEffect(() => {
    const trimmed = normalizeSearchTerm(search);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term, gotoPage]);
  const sf = useServerSortFilter(TABLE_KEYS.designTracker, () => gotoPage(1));
  const [showAdd, setShowAdd] = useState(false);
  const [editRow, setEditRow] = useState<DesignTrackerListItem | null>(null);
  const [logTimeRow, setLogTimeRow] = useState<DesignTrackerListItem | null>(null);

  // The row's ▸ opens its Start Date detail. A Set — many can be open at once.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Submit / Approve ask through the ONE confirm dialog (lifted off each row).
  const [confirm, setConfirm] = useState<{
    row: DesignTrackerListItem;
    kind: 'submit' | 'approve';
  } | null>(null);
  const submitMut = useSubmitDesignReview();
  const approveMut = useApproveDesign();
  const reviseMut = useReviseDesign();

  const onRevise = (row: DesignTrackerListItem): void => {
    const reason = window.prompt('Revision reason:');
    if (reason && reason.trim()) {
      void reviseMut.mutateAsync({ id: row.id, input: { reason: reason.trim() } });
    }
  };

  const { data, isLoading, isFetching, isError, error } = useDesignTrackerList({
    search: term,
    filter,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, gotoPage);
  const summary = data?.summary ?? {
    total: 0,
    pending: 0,
    inProgress: 0,
    review: 0,
    approved: 0,
    overdue: 0,
  };
  const filterCount: Record<FilterKey, number> = {
    all: summary.total,
    pending: summary.pending,
    progress: summary.inProgress,
    review: summary.review,
    approved: summary.approved,
    overdue: summary.overdue,
  };

  const today = todayIst();
  const rows = data?.items ?? [];
  const columns = useMemo(() => designTrackerColumns({ today }), [today]);

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    // `page-fill` (ADR-202): the TABLE is this page's only scrollbar, so the
    // column header cannot ride off the top of the screen at the last row.
    <div className="page-fill">
      <ListHeader
        title="Design Tracker"
        icon="🎨"
        count={data?.total}
        noun="design"
        filterNote={filter === 'all' ? undefined : FILTER_LABEL[filter]}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search design no., SO no., POL, item code, engineer…"
        updating={isFetching && !isLoading}
        filters={
          <Select
            aria-label="Design Status"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as FilterKey);
              gotoPage(1);
            }}
            // Counts in the labels — they were the clickable Total / Pending /
            // In Progress / Review / Approved / Overdue strip (owner's
            // filter-bar decision 2026-09-26).
            options={(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => ({
              value: k,
              label: `${FILTER_LABEL[k]} (${filterCount[k]})`,
            }))}
          />
        }
        onClearFilters={() => {
          setSearch('');
          setFilter('all');
          sf.clearFilters();
          gotoPage(1);
        }}
        filtersActive={search.trim() !== '' || filter !== 'all' || sf.filtering}
        primary={
          perms.entry ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              + Assign Design
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load designs. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable<DesignTrackerListItem>
            tableKey={TABLE_KEYS.designTracker}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={
              search.trim() || filter !== 'all' || sf.filtering
                ? 'No Designs match.'
                : 'No Designs yet.'
            }
            rowClassName={(d) => designTrackerRowTint(d, today)}
            // The fit table's ▸ opens the Start Date detail — no row click, there
            // is no standalone design detail page.
            renderExpanded={(d) =>
              expandedIds.has(d.id) ? <DesignTrackerExpanded row={d} /> : null
            }
            onToggleExpanded={(d) => toggleExpand(d.id)}
            rowMenu={(d) =>
              designTrackerRowMenu(d, {
                canWrite,
                isAdmin: canWrite,
                canEdit: perms.edit,
                onLogTime: setLogTimeRow,
                onEdit: setEditRow,
                onSubmit: (row) => setConfirm({ row, kind: 'submit' }),
                onApprove: (row) => setConfirm({ row, kind: 'approve' }),
                onRevise,
              })
            }
            renderLink={(p) => <Link {...p} />}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter
          total={data.total}
          noun="design"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={gotoPage}
        />
      ) : null}
      <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>
        BOM creation for an Equipment SO is blocked until its design is Approved.
      </div>

      {showAdd ? <AddDesignModal onClose={() => setShowAdd(false)} /> : null}
      {editRow ? <EditDesignModal row={editRow} onClose={() => setEditRow(null)} /> : null}
      {logTimeRow ? <LogTimeModal row={logTimeRow} onClose={() => setLogTimeRow(null)} /> : null}

      <ConfirmDialog
        open={confirm?.kind === 'submit'}
        title={`Submit ${confirm?.row.code ?? ''} for review?`}
        message="The design moves to Review for approval."
        confirmLabel="Submit"
        tone="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await submitMut.mutateAsync(confirm.row.id);
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'approve'}
        title={`Approve design ${confirm?.row.code ?? ''}?`}
        message={`This unlocks BOM creation for ${confirm?.row.soCodeText ?? 'the SO'}.`}
        confirmLabel="Approve"
        tone="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await approveMut.mutateAsync(confirm.row.id);
          setConfirm(null);
        }}
      />
    </div>
  );
}
