// Route Card list (ports legacy renderRouteCards L10078).
//
// PHASE 4 — composed exactly like the reference list
// (modules/clients/routes/list.tsx), with the one thing this screen adds:
// the row's ▸ (the fit table's one expand control, ADR-199) still reveals the
// operation sequence IN PLACE, right under the row (legacy UX), while the row
// itself opens the detail page.
// Legacy renders that sequence as an inline 8th column, but
// `RouteCardListItem` carries only `opCount` — the ops live behind the detail
// endpoint — so the expand-row lazily fetches them instead of firing a detail
// request per row. See ISSUE-019.
//
//   <ListHeader>            title · count · SearchInput · ⟳ Updating… · + Add Route Card
//                           (25 rows a page, ADR-201; search + ▾ on the server)
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//     renderExpanded        the op sequence, as Tag chips
//   <ListFooter>            count line · 💡 hint
//   <PageState>             no-access and load-failure
//
// Gone from this file: the hand-rolled sticky band, the bare <input>, the
// tinted info box with its raw rgba() colours, the <table>/<colgroup>/<thead>,
// the three colSpan state rows, the row-action cluster, the hand-rolled op
// chips, the count line, `window.confirm` and `window.alert`. What stays is
// the DATA and the RULES: the query, the permission gates, the expand set and
// the URL parameter.
//
// What did NOT change: the route and its search param, the 300ms debounce on
// the URL write, normalizeSearchTerm, the gates (Edit needs edit, Delete needs
// edit AND approve), the per-row 🖨 Print button and everything it does, row
// click -> detail, RC No. -> detail, and the lazily-fetched op sequence (one
// detail request per OPENED row, not per row).
//
// TWO DELIBERATE BEHAVIOUR CHANGES, both of them fixes the reference list
// already carries:
//   * Delete asked through `window.confirm` and reported failure through
//     `window.alert`. It now raises the shared ConfirmDialog, which stays open
//     on its own pending state until the delete settles and shows a rejection
//     in place of closing over a delete that never happened.
//   * The delete mutation used to be mounted PER ROW, so `del.isPending` only
//     ever greyed out the row you clicked. It is mounted once here, so every
//     row's Delete greys out while one is in flight — the reference behaviour.

import { opSrNo } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, Tag } from '@/ui/core';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useDeleteRouteCard, useRouteCard, useRouteCardsList } from '../api';
import { routeCardListColumns } from '../components/route-card-list-columns';
import { RouteCardRowMenu } from '../components/route-card-row-menu';

const searchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const routeCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards',
  validateSearch: searchSchema,
  component: RouteCardsListPage,
});

function RouteCardsListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, page } = routeCardsListRoute.useSearch();
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
        to: '/route-cards',
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, navigate]);

  // 25 rows a page (ADR-201); search and Sort & Filter run on the server over
  // every card, and any change of them goes back to page 1.
  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({
        to: '/route-cards',
        search: (prev) => ({ ...prev, page: p }),
        replace: true,
      });
    },
    [navigate],
  );
  const sf = useServerSortFilter(TABLE_KEYS.routeCardsList, () => gotoPage(1));
  const offset = pageOffset(page);
  const { data, isLoading, isFetching, isError, error } = useRouteCardsList({
    search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'routecard_create');
  // Legacy delRouteCard (L10279): confirm, then remove. Delete is admin-only
  // server-side (route-cards service L698), so it stays expressed as the pair
  // only L5 Department Admin and above hold — matching the detail page.
  const canDelete = perms.edit && perms.approve;
  const del = useDeleteRouteCard();
  // ADR-197: Delete asks for a reason, so the row hands the question to this
  // page's own ConfirmDialog (RowActions' built-in one has no reason box).
  const [pendingDelete, setPendingDelete] = useState<{ id: string; code: string } | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
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

  const columns = useMemo(() => routeCardListColumns(offset), [offset]);

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header can never ride off the
    // top of the screen at the last row.
    <div className="page-fill">
      {/* The frozen header band: title, count, search and the primary action
          stay put while the rows scroll underneath. */}
      <ListHeader
        title="Route Card Master"
        icon="🗒"
        count={total}
        noun="card"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search RC no., item code, item name…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          sf.clearFilters();
          void navigate({ to: '/route-cards', search: { page: 1 }, replace: true });
        }}
        filtersActive={searchInput.trim() !== '' || sf.filtering}
        primary={
          perms.entry ? (
            <Link to="/route-cards/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Route Card
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load Route Cards. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.routeCardsList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={search || sf.filtering ? 'No Route Cards match.' : 'No Route Cards yet.'}
            onRowClick={(rc) => void navigate({ to: '/route-cards/$id', params: { id: rc.id } })}
            // The op sequence is fetched only for a row that is actually open —
            // returning null for a collapsed row means ExpandedOps (and its
            // detail query) never mounts for it.
            renderExpanded={(rc) => (expanded.has(rc.id) ? <ExpandedOps rcId={rc.id} /> : null)}
            // The fit table's ▸ is the row's one expand control: it opens the
            // op sequence too.
            onToggleExpanded={(rc) => toggleExpand(rc.id)}
            rowActionsWidth="1%"
            rowActions={(rc) => (
              // The ⋯ menu: Edit · Print · ─ · Move to Trash (no View — the
              // row click opens the card).
              <RouteCardRowMenu
                rc={rc}
                canEdit={perms.edit}
                onDelete={
                  canDelete
                    ? (): void => {
                        setDeleteReason('');
                        setPendingDelete({ id: rc.id, code: rc.code });
                      }
                    : undefined
                }
                deleteDisabled={del.isPending}
              />
            )}
          />
        </Panel>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Move Route Card ${pendingDelete?.code ?? ''} to Trash?`}
        message={
          <>
            You can restore it from Trash. Plans raised from it keep the ops they already copied.
            <textarea
              className="innovic-input"
              aria-label="Reason"
              placeholder="Reason (required)"
              rows={2}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 8 }}
            />
          </>
        }
        confirmLabel="Move to Trash"
        pendingLabel="Moving to Trash…"
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const reason = deleteReason.trim();
          // Thrown, not returned: the ConfirmDialog shows it and stays open.
          if (!reason) throw new Error('Enter a reason to move this Route Card to Trash.');
          await del.mutateAsync({ id: pendingDelete.id, reason });
          setPendingDelete(null);
        }}
      />

      <ListFooter
        total={total}
        noun="route card"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
    </div>
  );
}

/** The operation sequence under an opened row. Its own fetch, so the list
 *  endpoint stays a single request and only the rows actually opened cost
 *  anything. */
function ExpandedOps({ rcId }: { rcId: string }): React.JSX.Element {
  const { data, isLoading } = useRouteCard(rcId);

  if (isLoading) {
    return <PageState as="inline" state="loading" message="⟳ Loading ops…" />;
  }
  if (!data) return <PageState as="inline" state="empty" message="—" />;

  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        className="mono fw-700"
        style={{ fontSize: 'var(--fs-xs)', color: 'var(--cyan)', marginBottom: 'var(--sp-1)' }}
      >
        ▸ Operation Sequence — {data.code}
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
        {data.ops.map((op, i) => {
          // QC green, outsourcing purple, everything else the primary blue —
          // the same three families as before, but as the token pairs the rest
          // of the app uses (the raw `#7c3aed` and the rgba() tints are gone).
          const tone =
            op.opType === 'qc'
              ? { color: 'var(--green2)', bg: 'var(--green3)' }
              : op.opType === 'outsource'
                ? { color: 'var(--purple2)', bg: 'var(--purple3)' }
                : { color: 'var(--cyan2)', bg: 'var(--cyan3)' };
          const label =
            op.opType === 'qc'
              ? op.operation || 'QC'
              : op.opType === 'outsource'
                ? `${op.operation} → ${op.ospVendorCode ?? op.ospVendorCodeText ?? '—'}`
                : `${op.machineCode ?? op.machineCodeText ?? '—'} · ${op.operation}`;
          return (
            <Tag key={op.id} color={tone.color} bg={tone.bg}>
              {opSrNo(i + 1)}. {label}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
