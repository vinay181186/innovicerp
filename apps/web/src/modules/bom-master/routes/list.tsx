// BOM Master list (ports legacy renderBOMMaster L8438).
//
// PHASE 4 — composed exactly like the reference list
// (modules/clients/routes/list.tsx), with the one thing this screen adds:
// the ▸ chevron on the BOM No. still reveals the part list IN PLACE, right
// under the row (legacy UX), while the row itself opens the detail page.
//
//   <ListHeader>            title · count · SearchInput · ⟳ Updating… · + New BOM
//     <StatusPills>         draft | active | obsolete — a filter with no counts
//   </ListHeader>
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

import type { BomMasterListItem, BomStatus } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { ListFooter, ListHeader, PageState, RowActions, StatusPills } from '@/ui/layout';
import { useBomMaster, useBomMastersList } from '../api';

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['draft', 'active', 'obsolete']).optional(),
});

export const bomMastersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'bom-masters',
  validateSearch: searchSchema,
  component: BomMastersListPage,
});

const STATUS_PILLS: BomStatus[] = ['draft', 'active', 'obsolete'];

/** One fetch, scroll — masters do not paginate. The API caps `limit` at 200. */
const LIST_LIMIT = 100;

function BomMastersListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status } = bomMastersListRoute.useSearch();
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
        search: { ...(status ? { status } : {}), search: next },
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, status, navigate]);

  const { data, isLoading, isFetching, isError, error } = useBomMastersList({
    search,
    status,
    limit: LIST_LIMIT,
    offset: 0,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'bom_create');
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

  // The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
  // column (rowActionsWidth below): 4+11+19+23+6+7+9+8+7 = 94, + 6 = 100, so
  // the table never scrolls sideways. Centred by the standard; only BOM Name
  // is left-aligned.
  const columns = useMemo<DataTableColumn<BomMasterListItem>[]>(
    () => [
      { header: 'Sr No', width: '4%', className: 'text3', render: (_b, i) => i + 1 },
      {
        header: 'BOM No.',
        width: '11%',
        nowrap: true,
        render: (b) => (
          <span style={{ whiteSpace: 'nowrap' }}>
            {/* ▸ / ▾ opens the part list in place; the row itself navigates. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(b.id);
              }}
              title={expanded.has(b.id) ? 'Hide part list' : 'Show part list'}
              aria-expanded={expanded.has(b.id)}
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
              <Icon name={expanded.has(b.id) ? 'chevron-down' : 'chevron-right'} size={14} />
            </button>
            <Link
              to="/bom-masters/$id"
              params={{ id: b.id }}
              className="td-code"
              title="Open this BOM"
              // stopPropagation sits on the two controls, not on the cell, so
              // clicking the rest of the cell still opens the row — exactly as
              // before.
              onClick={(e) => e.stopPropagation()}
            >
              {b.bomNo}
            </Link>
          </span>
        ),
      },
      {
        header: 'BOM Name',
        width: '19%',
        align: 'left',
        className: 'fw-700',
        ellipsis: true,
        key: 'bomName',
      },
      {
        header: 'Parent Item',
        width: '23%',
        ellipsis: true,
        title: (b) =>
          b.parentItemCode ? `${b.parentItemCode} — ${b.parentItemName ?? ''}` : 'not set',
        // Item code strong, name quiet: the code is the value on this row.
        render: (b) =>
          b.parentItemCode ? (
            <>
              <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                {b.parentItemCode}
              </span>
              {b.parentItemName ? (
                <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
                  {' '}
                  — {b.parentItemName}
                </span>
              ) : null}
            </>
          ) : (
            <span style={{ color: 'var(--amber2)' }}>not set</span>
          ),
      },
      {
        header: 'Items',
        width: '6%',
        className: 'mono fw-700',
        nowrap: true,
        render: (b) => <span style={{ color: 'var(--purple)' }}>{b.lineCount}</span>,
      },
      {
        header: 'BOM Rev',
        width: '7%',
        className: 'mono fw-700',
        nowrap: true,
        render: (b) => <span style={{ color: 'var(--cyan)' }}>Rev {b.revision}</span>,
      },
      {
        header: 'Revision Date',
        width: '9%',
        className: 'mono text2',
        nowrap: true,
        key: 'revisionDate',
      },
      {
        header: 'Linked SOs',
        width: '8%',
        nowrap: true,
        render: (b) =>
          b.linkedSoCount > 0 ? (
            <span className="fw-700" style={{ color: 'var(--green)' }}>
              {b.linkedSoCount} SO{b.linkedSoCount > 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
      {
        header: 'BOM Status',
        width: '7%',
        nowrap: true,
        // `bom`, not the generic `doc` map: draft happens to agree, but active
        // and obsolete are not in `doc` at all. Same kind the BOM detail page
        // draws, so the two cannot disagree.
        render: (b) => <StatusBadge kind="bom" status={b.status} />,
      },
    ],
    [expanded, toggleExpand],
  );

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, search, primary action and the
          status pills stay put while the rows scroll underneath. */}
      <ListHeader
        title="BOM Master"
        icon="📦"
        count={total}
        noun="BOM"
        filterNote={status}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search BOM no., name, parent item…"
        updating={isFetching && !isLoading}
        primary={
          perms.entry ? (
            <Link to="/bom-masters/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New BOM
            </Link>
          ) : null
        }
      >
        {/* The status filter carries no counts, so it is pills, not a
            StatStrip — same `status` search param, same query as before. */}
        <StatusPills
          options={STATUS_PILLS}
          value={status ?? null}
          label="Filter by BOM status"
          onChange={(v) =>
            void navigate({
              to: '/bom-masters',
              search: {
                ...(search ? { search } : {}),
                status: (v as BomStatus | null) ?? undefined,
              },
              replace: true,
            })
          }
        />
      </ListHeader>

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load BOMs. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            empty={
              <>
                No BOMs created yet — click <strong>+ New BOM</strong>
              </>
            }
            onRowClick={(b) => void navigate({ to: '/bom-masters/$id', params: { id: b.id } })}
            // The part list is fetched only for a row that is actually open —
            // returning null for a collapsed row means ExpandedLines (and its
            // detail query) never mounts for it.
            renderExpanded={(b) => (expanded.has(b.id) ? <ExpandedLines bomId={b.id} /> : null)}
            rowActionsWidth="6%"
            rowActions={(b) => (
              // View is a ROUTE, so it stays a real link — ctrl-click /
              // middle-click still open a new tab. Editing and revising a BOM
              // happen on the detail page, so the row offers neither.
              <RowActions viewTo={`/bom-masters/${b.id}`} renderLink={(p) => <Link {...p} />} />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="BOM"
        limit={LIST_LIMIT}
        hint={
          <>
            Click a row to open it · click ▸ before the <b>BOM No.</b> to show its part list. BOM
            Master defines part lists (items + qty per set). Link a BOM to Equipment SO orders. Use{' '}
            <strong>Revise</strong> to create a new revision with change log.
          </>
        }
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
      { header: 'Sr No', width: '6%', className: 'mono fw-700', render: (_l, i) => i + 1 },
      {
        header: 'Item Code',
        width: '20%',
        className: 'td-code',
        nowrap: true,
        render: (l) => l.childItemCode ?? '—',
      },
      {
        header: 'Item Name',
        width: '46%',
        align: 'left',
        ellipsis: true,
        render: (l) => l.childItemName ?? '—',
        title: (l) => l.childItemName ?? '',
      },
      {
        header: 'Qty / Set',
        width: '13%',
        className: 'mono fw-700',
        nowrap: true,
        render: (l) => Number(l.qtyPerSet),
      },
      {
        header: 'BOM Type',
        width: '15%',
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
        ▸ PART LIST / ITEMS — {data.bomNo}
      </div>
      {/* `compact` is the nested-line-table density — the same sheet, one step
          tighter, because it sits inside a row of the sheet above it. */}
      <DataTable columns={columns} rows={data.lines} density="compact" emptyText="No lines" />
    </div>
  );
}

/** Not a status chip — a one-word marker of how the child part is obtained.
 *  Local to this screen; nothing else renders a BOM line's type. */
function BomTypeBadge({ type }: { type: string }): React.JSX.Element {
  const cfg = {
    manufacture: { label: '🏭 Mfg', color: 'var(--cyan)' },
    purchase: { label: '🛒 Buy', color: 'var(--green)' },
    outsource: { label: '🏭 Outsrc', color: 'var(--amber2)' },
  }[type] ?? { label: type, color: 'var(--text3)' };
  return (
    <span className="fw-700" style={{ color: cfg.color, fontSize: 'var(--fs-xs)' }}>
      {cfg.label}
    </span>
  );
}
