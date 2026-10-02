// GRN list (UI-003-05). Ports legacy renderGRN L26444.
//
// ADR-199 table standard: ONE shared FIT table (<DataTable tableKey=…>), one
// line per GRN, the fit engine sizing columns to the screen and dropping the
// rightmost unpinned ones into a ▸ detail row when it is too narrow. Replaced
// the per-GRN card layout (frozen band, accent bar, metric strip, meta line);
// no field was dropped in the move — Received / Accepted / Rejected are now
// columns, Source and PO/NC No. are columns, and the card's DC / invoice /
// remarks meta line moved into the ▸ expand beside the GRN's line items.
//
// Pagination is KEPT (unlike SO/WO masters): the GRN API is paginated and the
// receipt book grows every day, so the list stays a pager register (ListFooter
// pager mode) rather than a one-fetch scroll.

import {
  GRN_QC_STATUSES,
  type GoodsReceiptNoteListItem,
  type GrnQcStatus,
  type ListGoodsReceiptNotesQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useGoodsReceiptNotesList } from '../api';
import { GrnExpandedLines } from '../components/grn-expanded-lines';
import { goodsReceiptNoteListColumns } from '../components/grn-list-columns';
import { GRN_QC_STATUS_LABELS } from '../lib/grn-labels';

// Pagination is KEPT here (unlike SO Master): the GRN API is paginated and the
// receipt book grows every day, so the whole list is not loaded in one go.
const PAGE_SIZE = 25;

// Card QC status → row tint (ADR-199 ROW_TINT). Real GrnQcStatus enum only:
// QC Pending reads as pending work, QC Cleared is done; QC In Progress is the
// active middle and stays untinted.
const ROW_TINT_BY_QC: Record<GrnQcStatus, string | undefined> = {
  pending: ROW_TINT.pending,
  in_progress: undefined,
  completed: ROW_TINT.done,
};

const listSearchSchema = z.object({
  search: z.string().optional(),
  qcStatus: z.enum(GRN_QC_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const goodsReceiptNotesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes',
  validateSearch: listSearchSchema,
  component: GoodsReceiptNotesListPage,
});

function GoodsReceiptNotesListPage(): React.JSX.Element {
  const search = goodsReceiptNotesListRoute.useSearch();
  const navigate = goodsReceiptNotesListRoute.useNavigate();
  // Tier-driven, per department (Store). Was `role === admin || manager`, which
  // handed a Purchase manager the Store's receipt book and locked out the L2
  // storekeeper whose job this is.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'grn_create');

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
    // "  IN-GRN  00012 " and "IN-GRN 00012" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss GRNs. Every change goes to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.grnList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const query: ListGoodsReceiptNotesQuery = useMemo(
    () => ({
      search: search.search,
      qcStatus: search.qcStatus,
      sf: sf.param,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [sf.param, search.search, search.qcStatus, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useGoodsReceiptNotesList(query);
  // The KPI summary has no "QC In Progress" count, so the QC-status dropdown's
  // In Progress count reads the pager total of the same list filtered to it
  // (same endpoint). The rows also tell each line whether it is in QC right now
  // — the same rule (a line with QC status 'in_progress'), so row and count
  // always agree.
  const { data: inProgressData } = useGoodsReceiptNotesList({
    search: search.search,
    qcStatus: 'in_progress',
    // Same column filters, so this count agrees with the others in the dropdown.
    sf: sf.param,
    limit: 200,
    offset: 0,
  });
  const inProgressIds = useMemo(
    () => new Set((inProgressData?.items ?? []).map((g) => g.id)),
    [inProgressData],
  );
  const filtered = sf.filtering || Boolean(search.search) || search.qcStatus !== undefined;

  // ▸ expand: the caller owns the open set; the fit table's ▸ is the row's one
  // expand control (onToggleExpanded), and renderExpanded returns null for a
  // collapsed row so a closed GRN never fetches its lines.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rows = data?.items ?? [];

  /** Card QC status: cleared once every line is inspected; "In Progress" only
   *  when a line's QC status is 'in_progress' (the tile's rule); else pending. */
  const qcStatusFor = useCallback(
    (grn: GoodsReceiptNoteListItem): GrnQcStatus =>
      grn.grnStatus === 'close'
        ? 'completed'
        : search.qcStatus === 'in_progress' || inProgressIds.has(grn.id)
          ? 'in_progress'
          : 'pending',
    [search.qcStatus, inProgressIds],
  );

  const columns = useMemo(() => goodsReceiptNoteListColumns(qcStatusFor), [qcStatusFor]);

  // ⋯ row menu — Assign Task (link a task to this GRN), the same gate the
  // retired card used: shown only while a line still awaits QC
  // (qcPendingCount > 0). Hidden for the read-only viewer role, which
  // POST /tasks refuses (tasks service requireNotViewer).
  const { data: me } = useSession();
  const [assignGrn, setAssignGrn] = useState<GoodsReceiptNoteListItem | null>(null);
  const rowActions = (grn: GoodsReceiptNoteListItem): React.JSX.Element | undefined =>
    grn.qcPendingCount > 0 && me && me.role !== 'viewer' ? (
      <RowActions
        renderLink={(p) => <Link {...p} />}
        items={[
          {
            key: 'assign',
            label: 'Assign Task',
            icon: 'user-round',
            group: 'assign',
            onSelect: () => setAssignGrn(grn),
          },
        ]}
      />
    ) : undefined;

  const total = data?.total ?? 0;

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view GRNs. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · + New GRN, then
          the filter bar (search · QC status with counts · Clear), with the
          read-only "Today" tile inside the same band. */}
      <ListHeader
        title="GRN"
        icon="📥"
        count={total}
        noun="GRN"
        filterNote={search.qcStatus ? GRN_QC_STATUS_LABELS[search.qcStatus] : undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search GRN no., PO, vendor, DC, invoice…"
        updating={isFetching && !isLoading}
        filters={
          // QC status, every GRN_QC_STATUSES value, with the summary counts
          // the old pill row + KPI strip showed folded into the labels (owner
          // decision 2026-09-26). Same `qcStatus` search param, same query.
          <select
            className="innovic-select"
            aria-label="QC status"
            title="QC status"
            value={search.qcStatus ?? ''}
            onChange={(e) => {
              const v = e.target.value as GrnQcStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, qcStatus: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
          >
            <option value="">{withCount('All', data?.summary?.total)}</option>
            {GRN_QC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {withCount(
                  GRN_QC_STATUS_LABELS[s],
                  qcCountFor(s, data?.summary, inProgressData?.total),
                )}
              </option>
            ))}
          </select>
        }
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, search: undefined, qcStatus: undefined, page: 1 }),
            replace: true,
          });
        }}
        filtersActive={sf.filtering || search.qcStatus !== undefined || searchInput !== ''}
        primary={
          perms.entry ? (
            <Link to="/goods-receipt-notes/new" className="btn btn-primary">
              <Plus size={14} /> New GRN
            </Link>
          ) : null
        }
      >
        {/* Read-only context tile: the three filtering tiles (Total / QC
            Pending / QC Cleared) moved into the QC-status dropdown's option
            labels; "Today" has no filter behind it, so it stays here. */}
        {data?.summary ? <GrnTodayStrip today={data.summary.today} /> : null}
      </ListHeader>

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load GRNs. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.grnList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText={filtered ? 'No GRNs match.' : 'No GRNs yet.'}
            defaultHidden={['created_on']}
            sortFilterServer={sf}
            onRowClick={(grn) =>
              void navigate({ to: '/goods-receipt-notes/$id', params: { id: grn.id } })
            }
            rowClassName={(grn) => ROW_TINT_BY_QC[qcStatusFor(grn)]}
            rowActions={(grn) => rowActions(grn)}
            // The lines are fetched only for a row actually open — returning null
            // for a collapsed row means GrnExpandedLines (and its detail query)
            // never mounts for it.
            renderExpanded={(grn) =>
              expandedIds.has(grn.id) ? <GrnExpandedLines grnId={grn.id} /> : null
            }
            // The fit table's ▸ is the row's one expand control: it opens the
            // line items too.
            onToggleExpanded={(grn) => toggleExpand(grn.id)}
          />
        </Panel>
      )}

      {/* Legacy L26502-26503 — the tip line under the register. GRN keeps the
          Prev/Next pager (ListFooter pager mode) — an unbounded register. */}
      <ListFooter
        total={total}
        noun="goods receipt note"
        page={search.page}
        pageSize={PAGE_SIZE}
        onPage={(p) =>
          void navigate({
            search: (prev) => ({
              ...prev,
              page: Math.min(Math.max(1, Math.ceil(total / PAGE_SIZE)), Math.max(1, p)),
            }),
            replace: true,
          })
        }
        hint="Only QC-accepted qty goes into stock."
      />

      {assignGrn ? (
        <AssignTaskModal
          linkedRef={{
            type: 'GRN',
            id: assignGrn.id,
            display: assignGrn.code,
            navPage: '/incoming-qc',
          }}
          suggestedTitle={`Inspect ${assignGrn.code}`}
          onClose={() => setAssignGrn(null)}
        />
      ) : null}
    </div>
  );
}

// PL-GRN-1b — legacy renderGRN L26483–26488 showed four tiles. Total / QC
// Pending / QC Cleared filtered by qcStatus; they are now the counts in the
// QC-status dropdown (2026-09-26 filter bar). "Today" never filtered — it is
// context only — so it stays as a read-only tile.

interface GrnSummary {
  total: number;
  qcPending: number;
  qcCleared: number;
  today: number;
}

/** "Label (N)" when a count is known, bare label otherwise. */
function withCount(label: string, n: number | undefined): string {
  return n === undefined ? label : `${label} (${n})`;
}

/** The count behind one QC status — the same mapping the old KPI tiles used
 *  (QC Pending → pending, QC Cleared → completed). The summary has no
 *  In Progress count, so that one is the pager total of the in-progress list. */
function qcCountFor(
  s: GrnQcStatus,
  summary: GrnSummary | undefined,
  inProgressTotal: number | undefined,
): number | undefined {
  if (s === 'in_progress') return inProgressTotal;
  if (!summary) return undefined;
  if (s === 'pending') return summary.qcPending;
  if (s === 'completed') return summary.qcCleared;
  return undefined;
}

function GrnTodayStrip({ today }: { today: number }): React.JSX.Element {
  return (
    <StatStrip
      items={[
        {
          // Read-only total (no onClick) — legacy showed a "Today" count for
          // context only, with no filter behind it.
          key: 'today',
          label: 'Today',
          count: today,
          color: 'var(--blue)',
        },
      ]}
    />
  );
}
