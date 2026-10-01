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
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
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
  // ADR-197: Delete asks for a reason, so the row hands the question to this
  // page's own ConfirmDialog (RowActions' built-in one has no reason box).
  const [pendingDelete, setPendingDelete] = useState<{ id: string; code: string } | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
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
      { id: 'sr_no', header: 'Sr No', width: '4%', className: 'text3', render: (_rc, i) => i + 1 },
      {
        id: 'code',
        header: 'RC No.',
        nowrap: true,
        // The op sequence opens from the fit table's ▸ (the row's ONE expand
        // control, ADR-199) — no chevron of its own, so hiding or dropping
        // this column can never take the op sequence away.
        render: (rc) => (
          <Link
            to="/route-cards/$id"
            params={{ id: rc.id }}
            className="td-code"
            title="Open this route card"
            // stopPropagation on the link, not the cell, so clicking the rest
            // of the cell still opens the row.
            onClick={(e) => e.stopPropagation()}
          >
            {rc.code}
          </Link>
        ),
      },
      {
        id: 'item_code',
        header: 'Item Code',
        // The item code is the main thing on this row: mono, bold, full --text.
        className: 'mono fw-700',
        nowrap: true,
        render: (rc) => rc.itemCode ?? '—',
      },
      {
        id: 'item_name',
        kind: 'text',
        header: 'Item Name',
        align: 'left',
        className: 'fw-700',
        render: (rc) => rc.itemName ?? '— unknown item —',
        title: (rc) => rc.itemName ?? '',
      },
      {
        // Grade then size on one line — the stock this card is cut from, so the
        // master answers "what is it made of" without opening a card.
        id: 'raw_material',
        kind: 'text',
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
      {
        id: 'op_count',
        header: 'Ops',
        align: 'right',
        className: 'mono',
        nowrap: true,
        key: 'opCount',
      },
      {
        id: 'current_revision',
        header: 'Route Card Rev',
        className: 'mono fw-700',
        nowrap: true,
        render: (rc) => <span style={{ color: 'var(--cyan)' }}>R{rc.currentRevision}</span>,
      },
      {
        id: 'updated_at',
        kind: 'date',
        header: 'Last Updated',
        className: 'mono text2',
        nowrap: true,
        render: (rc) => fmtDate(rc.updatedAt),
      },
    ],
    [],
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
            tableKey={TABLE_KEYS.routeCardsList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            empty={search ? 'No Route Cards match.' : 'No Route Cards yet.'}
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
              <RowActions
                // Row click opens the card (no separate View). Edit is a ROUTE,
                // so it stays a real link — ctrl-click still opens a new tab.
                editTo={perms.edit ? `/route-cards/${rc.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // 🖨 Print is this screen's own action, not one of the three
                // RowActions knows about, so it comes in through `extra` —
                // unchanged, including its lazy per-row fetch.
                extra={<PrintRouteCardButton rc={rc} />}
                // Caller-owned confirm (below): it asks for the reason, owns
                // the wait, and keeps a failure on screen inside the dialog.
                onDelete={
                  canDelete
                    ? (): void => {
                        setDeleteReason('');
                        setPendingDelete({ id: rc.id, code: rc.code });
                      }
                    : undefined
                }
                // Every row's Delete greys out while one is in flight.
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

      <ListFooter total={total} noun="route card" limit={LIST_LIMIT} />
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
