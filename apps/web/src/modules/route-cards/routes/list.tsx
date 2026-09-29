// Route Card list (ports legacy renderRouteCards L10078).
//
// PHASE 4 — composed exactly like the reference list
// (modules/clients/routes/list.tsx), with the one thing this screen adds:
// the ▸ chevron on the RC No. still reveals the operation sequence IN PLACE,
// right under the row (legacy UX), while the row itself opens the detail page.
// Legacy renders that sequence as an inline 8th column, but
// `RouteCardListItem` carries only `opCount` — the ops live behind the detail
// endpoint — so the expand-row lazily fetches them instead of firing a detail
// request per row. See ISSUE-019.
//
//   <ListHeader>            title · count · SearchInput · ⟳ Updating… · + Add Route Card
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

import type { RouteCardListItem } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, Tag } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useDeleteRouteCard, useRouteCard, useRouteCardsList } from '../api';
import { PrintRouteCardButton } from '../components/print-route-card-button';

const searchSchema = z.object({
  search: z.string().optional(),
});

export const routeCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards',
  validateSearch: searchSchema,
  component: RouteCardsListPage,
});

/** One fetch, scroll — masters do not paginate. The API caps `limit` at 200. */
const LIST_LIMIT = 100;

function RouteCardsListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search } = routeCardsListRoute.useSearch();
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
      void navigate({ to: '/route-cards', search: { search: next }, replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, navigate]);

  const { data, isLoading, isFetching, isError, error } = useRouteCardsList({
    search,
    limit: LIST_LIMIT,
    offset: 0,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'routecard_create');
  // Legacy delRouteCard (L10279): confirm, then remove. Delete is admin-only
  // server-side (route-cards service L698), so it stays expressed as the pair
  // only L5 Department Admin and above hold — matching the detail page.
  const canDelete = perms.edit && perms.approve;
  const del = useDeleteRouteCard();
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;

  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The sheet's columns. The sheet lays out AUTO (2026-09-26 list standard):
  // only Sr No keeps a width; codes, revs, counts and dates sit on one line
  // and Item Name wraps into what is left. Centred by the standard; only Item
  // Name is left-aligned, the op count sits right.
  const columns = useMemo<DataTableColumn<RouteCardListItem>[]>(
    () => [
      { header: 'Sr No', width: '4%', className: 'text3', render: (_rc, i) => i + 1 },
      {
        header: 'RC No.',
        nowrap: true,
        render: (rc) => (
          <span style={{ whiteSpace: 'nowrap' }}>
            {/* ▸ / ▾ opens the op sequence in place; the row itself navigates. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(rc.id);
              }}
              title={expanded.has(rc.id) ? 'Hide operation sequence' : 'Show operation sequence'}
              aria-expanded={expanded.has(rc.id)}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                marginRight: 'var(--sp-0)',
                cursor: 'pointer',
                color: 'var(--blue)',
                display: 'inline-flex',
                verticalAlign: 'middle',
              }}
            >
              <Icon name={expanded.has(rc.id) ? 'chevron-down' : 'chevron-right'} size={14} />
            </button>
            <Link
              to="/route-cards/$id"
              params={{ id: rc.id }}
              className="td-code"
              title="Open this route card"
              // stopPropagation sits on the two controls, not on the cell, so
              // clicking the rest of the cell still opens the row — exactly as
              // before.
              onClick={(e) => e.stopPropagation()}
            >
              {rc.code}
            </Link>
          </span>
        ),
      },
      {
        header: 'Item Code',
        // The item code is the main thing on this row: mono, bold, full --text.
        className: 'mono fw-700',
        nowrap: true,
        render: (rc) => rc.itemCode ?? '—',
      },
      {
        header: 'Item Name',
        align: 'left',
        className: 'fw-700',
        render: (rc) => rc.itemName ?? '— unknown item —',
        title: (rc) => rc.itemName ?? '',
      },
      {
        // Grade then size on one line — the stock this card is cut from, so the
        // master answers "what is it made of" without opening a card.
        header: 'RM Grade / RM Size',
        className: 'mono',
        title: (rc) => `${rc.rawMaterialGradeText ?? '—'} / ${rc.rawMaterialSizeText ?? '—'}`,
        render: (rc) => (
          <>
            <span className="fw-700">{rc.rawMaterialGradeText ?? '—'}</span>
            <span className="text3"> / {rc.rawMaterialSizeText ?? '—'}</span>
          </>
        ),
      },
      { header: 'Ops', align: 'right', className: 'mono', nowrap: true, key: 'opCount' },
      {
        header: 'Route Card Rev',
        className: 'mono fw-700',
        nowrap: true,
        render: (rc) => <span style={{ color: 'var(--cyan)' }}>R{rc.currentRevision}</span>,
      },
      {
        header: 'Last Updated',
        className: 'mono text2',
        nowrap: true,
        render: (rc) => fmtDate(rc.updatedAt),
      },
    ],
    [expanded, toggleExpand],
  );

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
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
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            empty={search ? 'No Route Cards match.' : 'No Route Cards yet.'}
            onRowClick={(rc) => void navigate({ to: '/route-cards/$id', params: { id: rc.id } })}
            // The op sequence is fetched only for a row that is actually open —
            // returning null for a collapsed row means ExpandedOps (and its
            // detail query) never mounts for it.
            renderExpanded={(rc) => (expanded.has(rc.id) ? <ExpandedOps rcId={rc.id} /> : null)}
            rowActionsWidth="1%"
            rowActions={(rc) => (
              <RowActions
                // Row click opens the card (no separate View). Edit is a ROUTE,
                // so it stays a real link — ctrl-click still opens a new tab.
                editTo={perms.edit ? `/route-cards/${rc.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // 🖨 Print is this screen's own action, not one of the three
                // RowActions knows about, so it comes in through `extra` —
                // unchanged, including its lazy per-row fetch.
                extra={<PrintRouteCardButton rc={rc} />}
                // The PROMISE is handed back, not swallowed. The confirm dialog
                // then owns the wait: both its buttons go dead, "Deleting…"
                // shows on the button, and it closes only once the card really
                // is gone. A failure stays on screen as an error in the dialog,
                // where the old `window.alert` used to interrupt.
                onDelete={
                  canDelete
                    ? async (): Promise<void> => {
                        await del.mutateAsync(rc.id);
                      }
                    : undefined
                }
                // And every OTHER row's Delete greys out while one is in
                // flight, which the old per-row mutation could not do.
                deleteDisabled={del.isPending}
                deleteConfirm={{
                  title: `Move Route Card ${rc.code} to Trash?`,
                  message: `You can restore it from Trash. Plans raised from it keep the ops they already copied.`,
                  confirmLabel: 'Move to Trash',
                  pendingLabel: 'Moving to Trash…',
                }}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="route card"
        limit={LIST_LIMIT}
        hint={
          <>
            Click ▸ before the <b>RC No.</b> to show its operation sequence.
          </>
        }
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
