// Job cards list (UI-003-07).
//
// PHASE 4 — migrated onto apps/web/src/ui/ following the GROUP 1 reference
// implementation, modules/clients/routes/list.tsx:
//
//   <ListHeader>            title · count · ⟳ Updating… · the two create buttons
//     <StatStrip>           the KPI strip (loaded/filtered counts, read-only)
//     <FilterBar>           search · status · machine · operator · dates · ☰/▦
//   </ListHeader>           — all of it inside the ONE sticky band, as before
//   <Panel><DataTable>      LIST VIEW — the ruled sheet
//   … or the card list      CARD VIEW — unchanged anatomy, primitives inside
//   <ListFooter>            count line · pager · 💡 hint
//   <PageState>             no-access, load failure, and the card view's empty
//
// Gone from this file: the hand-built sticky band, the <table>/<colgroup>/
// <thead>, the loading / error / empty rows, the local QtyBox, the two
// hand-drawn progress bars, the local status badge, the action cluster and its
// two-step inline delete, both hand-written count lines and the pager.
//
// WHAT DID NOT CHANGE — this screen is the shop floor's board and every rule
// below is how the board is read:
//   · the route, its six search params and `page`; the 300ms debounce on the
//     URL write; normalizeSearchTerm; every filter writing page: 1;
//   · one fetch capped at 200, then CLIENT-SIDE paging at PAGE_SIZE — so only
//     a page's worth of product-image thumbnails load at a time (each is one
//     signed-URL fetch, cached). The thumbnail is the Item Master PRODUCT
//     IMAGE (items.image_path), NOT the drawing (user decision 2026-09-21);
//     the old drawing-based PartThumb wrote a drawing_view audit row per row
//     shown, and the product image is not a controlled document;
//   · the KPI buckets (open = not started · in progress = started · completed =
//     complete or closed · overdue = past due and not done · on hold = always
//     0, no such state exists) and their note that they count the LOADED list;
//   · the Days Left colour rule — no date or done: muted · late: red ·
//     5 days or less: amber · otherwise green — and the same isDone() behind
//     both it and the KPI buckets, so the two can never disagree;
//   · the card's left accent bar (red late · green finished · blue otherwise)
//     and its overdue "Due <date> ⚠" in red;
//   · the List/Card choice remembered per browser, in a try/catch so a
//     locked-down browser still renders;
//   · the permission expressions: create = entry, edit = edit, delete = the
//     edit+approve pair only L5 Department Admin and above hold.
//
// JC STATUS COLOURS are now <StatusBadge kind="jc">, whose map
// (open grey · qc_pending amber · complete green · closed green · no_ops red)
// is the SAME map the local jc-status-badge.tsx carries, checked value by
// value — nothing about what a colour means has changed. That file stays: the
// Job Card detail view, the stat tiles and two Production Order screens still
// import it, and they are other screens' migrations.

import {
  JC_COMPUTED_STATUSES,
  type JcComputedStatus,
  type JobCardListItem,
  type ListJobCardsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { fmtDate } from '@/lib/date';
import { ItemBadge, ItemImageBox, THUMBNAIL_COL_WIDTH } from '@/components/shared/item-badge';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useMachinesList } from '@/modules/machines/api';
import { useOperatorsList } from '@/modules/operators/api';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Badge, StatusBadge } from '@/ui/core';
import {
  DataTable,
  Panel,
  ProgressBar,
  QtyStrip,
  StatStrip,
  type DataTableColumn,
} from '@/ui/data';
import { Input } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions, ViewToggle } from '@/ui/layout';
import { FilterBar } from '@/ui/navigation';
import { useDeleteJobCard, useJobCardsList } from '../api';
import { ExcelJcButton } from '../components/excel-jc-button';
import { JC_STATUS_LABEL } from '../components/jc-status-badge';
import { PrintJcButton } from '../components/print-jc-button';

// One fetch, cap 200 (mirrors the SO/WO list).
const LIST_LIMIT = 200;
// One page = the whole loaded list (user, 2026-09-21: the sheet scrolls, no
// Prev / Next). The image badges lazy-load, so a long page costs nothing until
// a row is scrolled into view; the pager below still exists and simply never
// shows while everything fits one page.
const PAGE_SIZE = 200;
const VIEW_STORAGE_KEY = 'jc-list-view';

/** Left accent bar — red when late & unfinished, green when finished, blue
 *  otherwise. Same tokens the badges use (mirrors the SO/WO list). */
function accentFor(jc: JobCardListItem, today: string): string {
  const overdue =
    jc.dueDate != null &&
    jc.dueDate < today &&
    jc.computedStatus !== 'closed' &&
    jc.computedStatus !== 'complete';
  if (overdue) return 'var(--red)';
  if (jc.computedStatus === 'closed' || jc.computedStatus === 'complete') return 'var(--green)';
  return 'var(--blue)';
}

/** A job is "done" when it has reached complete or closed — used by both the KPI
 *  buckets and the Days Left column so the two never disagree. */
function isDone(jc: JobCardListItem): boolean {
  return jc.computedStatus === 'complete' || jc.computedStatus === 'closed';
}

/** Days from today until the due date (negative = late). null when there is no
 *  due date or the job is already done, so the column shows "—" instead of a
 *  meaningless countdown. */
function daysLeftFor(jc: JobCardListItem, today: string): number | null {
  if (jc.dueDate == null || isDone(jc)) return null;
  const ms = Date.parse(jc.dueDate) - Date.parse(today);
  return Math.round(ms / 86_400_000);
}

/** The Days Left colour — late red, due within the working week amber, else
 *  green; muted when there is nothing to count down to. */
function daysLeftColor(days: number | null): string {
  if (days == null) return 'var(--text3)';
  if (days < 0) return 'var(--red)';
  if (days <= 5) return 'var(--amber)';
  return 'var(--green)';
}

/** Where a job card's source document lives — the SO / JWSO link in the row. */
function sourceRoute(link: NonNullable<JobCardListItem['sourceLink']>): {
  to: '/sales-orders/$id' | '/job-work-orders/$id';
  id: string;
} {
  return link.type === 'so'
    ? { to: '/sales-orders/$id', id: link.salesOrderId }
    : { to: '/job-work-orders/$id', id: link.jobWorkOrderId };
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(JC_COMPUTED_STATUSES).optional(),
  machineId: z.string().uuid().optional(),
  operatorId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const jobCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards',
  validateSearch: listSearchSchema,
  component: JobCardsListPage,
});

function JobCardsListPage(): React.JSX.Element {
  const search = jobCardsListRoute.useSearch();
  const navigate = jobCardsListRoute.useNavigate();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  // List View (the sheet) vs Card View (the SO-style cards). List is the
  // default; the choice is remembered per browser, wrapped in try/catch so a
  // locked-down browser (no localStorage) still renders.
  const [view, setView] = useState<'list' | 'card'>(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'card' ? 'card' : 'list';
    } catch {
      return 'list';
    }
  });
  const changeView = (next: 'list' | 'card'): void => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // ignore — persistence is best-effort
    }
  };

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-JC  26 " and "IN-JC 26" are one query, one cache entry, one URL.
    //
    // The debounce stays HERE, not on <FilterBar searchDebounceMs>: what is
    // being delayed is the URL write, and the box must show the keystroke at
    // once. FilterBar reports every keystroke into `searchInput`; this effect
    // is what waits 300ms before the route changes.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListJobCardsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      machineId: search.machineId,
      operatorId: search.operatorId,
      fromDate: search.fromDate,
      toDate: search.toDate,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [
      search.search,
      search.status,
      search.machineId,
      search.operatorId,
      search.fromDate,
      search.toDate,
    ],
  );

  const { data, isLoading, isFetching, isError, error } = useJobCardsList(query);
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  const { data: operatorsData } = useOperatorsList({ limit: 200, offset: 0 });
  const machines = machinesData?.machines ?? [];
  const operators = operatorsData?.operators ?? [];
  // Tier-driven, per department (jc_create sits in Production). Creating a Job
  // Card is `entry` (L2 Data Entry and up); Edit needs `edit` (L3+); Delete
  // needs the edit+approve pair only L5 Department Admin and above hold. The
  // last two used to be read inside JcRowWriteActions, which this file
  // replaced with <RowActions> — the expressions are carried over unchanged.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jc_create');
  const canWrite = perms.entry;
  const canEditJc = perms.edit;
  const canDeleteJc = perms.edit && perms.approve;
  const del = useDeleteJobCard();

  const total = data?.total ?? 0;
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const today = todayIst();
  const filtered =
    !!search.search ||
    !!search.status ||
    !!search.machineId ||
    !!search.operatorId ||
    !!search.fromDate ||
    !!search.toDate;
  const emptyText = filtered ? 'No Job Cards match.' : 'No Job Cards yet.';

  // Client-side pagination for the List View (Card View keeps its full scroll).
  // Keeps each page to PAGE_SIZE rows so only a page's worth of thumbnails load.
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(search.page, totalPages);
  const pagedRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const gotoPage = (p: number): void => {
    void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
  };

  // KPI tiles — computed from the CURRENTLY LOADED/filtered rows (the API returns
  // a filtered total, not global per-status counts). Buckets:
  //   Not Started = no op done, nothing running and not done (NOT the
  //                 filter's "Open", which also holds started cards)
  //   In Progress = started (an op done / QC pending / a running session) not done
  //   Completed   = complete or closed
  //   Overdue     = past due and not done
  //   On Hold     = no such state exists in job-card data → always 0 (see report)
  const kpis = useMemo(() => {
    let open = 0;
    let inProgress = 0;
    let completed = 0;
    let overdue = 0;
    for (const jc of rows) {
      if (isDone(jc)) {
        completed += 1;
      } else if (jc.doneOps > 0 || jc.computedStatus === 'qc_pending' || jc.runningCount > 0) {
        inProgress += 1;
      } else {
        open += 1;
      }
      if (!isDone(jc) && jc.dueDate != null && jc.dueDate < today) overdue += 1;
    }
    return { total: rows.length, open, inProgress, onHold: 0, completed, overdue };
  }, [rows, today]);

  const setNav = (
    update: Partial<
      Pick<typeof search, 'status' | 'machineId' | 'operatorId' | 'fromDate' | 'toDate'>
    >,
  ): void => {
    void navigate({
      search: (prev) => ({ ...prev, ...update, page: 1 }),
      replace: true,
    });
  };

  /** The six row actions, in the sheet's order: View · Edit · Print · Excel ·
   *  Assign · Delete. `labelled` draws the card view's text buttons instead of
   *  the sheet's icons. Delete now raises the shared ConfirmDialog and hands
   *  it the mutation's promise, so the dialog owns the wait and a second click
   *  cannot fire a no-op delete. */
  const rowActions = (jc: JobCardListItem, labelled: boolean): React.JSX.Element => (
    <RowActions
      labelled={labelled}
      // View and Edit are ROUTES, so they stay real links — ctrl-click /
      // middle-click / "open in new tab" keep working.
      viewTo={`/job-cards/${jc.id}`}
      editTo={canEditJc ? `/job-cards/${jc.id}/edit` : undefined}
      renderLink={(p) => <Link {...p} />}
      extra={
        <>
          <PrintJcButton jc={jc} iconOnly={!labelled} />
          <ExcelJcButton jc={jc} iconOnly={!labelled} />
          <AssignTaskButton
            linkedRef={{
              type: 'job_card',
              id: jc.id,
              display: `JC ${jc.code}`,
              navPage: '/job-cards',
            }}
            suggestedTitle={`Follow up on JC ${jc.code}`}
            {...(labelled ? {} : { className: 'btn btn-ghost btn-sm btn-icon', label: '' })}
          />
        </>
      }
      onDelete={canDeleteJc ? (): Promise<void> => del.mutateAsync(jc.id) : undefined}
      deleteDisabled={del.isPending}
      deleteConfirm={{
        title: `Move Job Card ${jc.code} to Trash?`,
        message: `${itemCodeWithRev(jc.itemCode, jc.itemRevision)} stops appearing in Job Cards, on the shop floor and in Op Entry. You can restore it from Trash.`,
        confirmLabel: 'Move to Trash',
        pendingLabel: 'Moving to Trash…',
      }}
    />
  );

  // The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
  // column (rowActionsWidth below): 4+10+8+4+12+8+6+7+8+6+7+5 = 85, + 15 = 100,
  // so the table never scrolls sideways. Centred by the standard; only the
  // item code · name is left-aligned, so the code starts at the same x in
  // every row.
  const columns = useMemo<DataTableColumn<JobCardListItem>[]>(
    () => [
      {
        header: 'Sr No',
        width: '4%',
        className: 'text3',
        render: (_jc, i) => (currentPage - 1) * PAGE_SIZE + i + 1,
      },
      {
        header: 'JC No.',
        width: '10%',
        nowrap: true,
        render: (jc) => (
          <Link
            to="/job-cards/$id"
            params={{ id: jc.id }}
            className="td-code"
            style={{ color: 'var(--blue)', fontWeight: 800 }}
            onClick={(e) => e.stopPropagation()}
          >
            {jc.code}
          </Link>
        ),
      },
      {
        header: 'Image',
        width: THUMBNAIL_COL_WIDTH,
        // The picture fills the cell edge to edge, the gridlines being its
        // frame (user decision 2026-09-22 — the thumbnail column sits before
        // the item code · name on every list). The negative margins cancel the
        // sheet's own cell padding so the box reaches the rules;
        // `position: relative` is what `fill` pins itself to. ItemImageBox
        // stops its own click, so opening the picture never opens the row.
        render: (jc) => (
          <div
            style={{
              position: 'relative',
              height: 40,
              margin: 'calc(var(--sp-1) * -1) calc(var(--sp-2) * -1)',
            }}
          >
            <ItemImageBox
              imagePath={jc.itemImagePath}
              size="row"
              alt={jc.itemName || itemCodeWithRev(jc.itemCode, jc.itemRevision)}
              fill
            />
          </div>
        ),
      },
      {
        // The CUSTOMER's PO line no. (never our SO line no.), beside CODE/REV.
        header: 'POL',
        width: '4%',
        nowrap: true,
        render: (jc) =>
          jc.clientPoLineNo ? (
            <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
              {jc.clientPoLineNo}
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
      {
        header: 'Item Code',
        width: '12%',
        align: 'left',
        // CODE/REV + name, text only — the picture is the column to the left.
        // The revision is the customer's drawing revision off the SO line
        // (null → the bare code, never a trailing slash).
        render: (jc) => (
          <ItemBadge
            size="row"
            showImage={false}
            code={jc.itemCode}
            name={jc.itemName}
            revision={jc.itemRevision}
            imagePath={jc.itemImagePath}
            style={{ display: 'flex', width: '100%' }}
          />
        ),
      },
      {
        header: 'SO No.',
        width: '8%',
        nowrap: true,
        render: (jc) => {
          const s = jc.sourceLink;
          if (!s) return <span className="text3">—</span>;
          const route = sourceRoute(s);
          return (
            <Link
              to={route.to}
              params={{ id: route.id }}
              className="mono"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--blue)',
                textDecoration: 'none',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {s.code}
              {s.lineNo !== 1 ? <span>/{s.lineNo}</span> : null}
            </Link>
          );
        },
      },
      {
        header: 'Order Qty',
        width: '6%',
        align: 'right',
        nowrap: true,
        render: (jc) => (
          <>
            <span className="mono fw-700">{jc.orderQty}</span>{' '}
            <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
              Nos
            </span>
          </>
        ),
      },
      {
        header: 'Progress',
        width: '7%',
        // Completed pieces at the LAST operation over the order qty — the
        // same figure the card view's Completed box shows.
        render: (jc) => {
          const done = jc.lastOpCompletedQty;
          const pct = jc.orderQty > 0 ? Math.min(100, Math.round((done / jc.orderQty) * 100)) : 0;
          return (
            <>
              <ProgressBar
                value={pct}
                color="var(--green)"
                label={`${done} of ${jc.orderQty} Completed`}
              />
              <div className="mono text3" style={{ fontSize: 'var(--fs-xs)' }}>
                {done} / {jc.orderQty} · {pct}%
              </div>
            </>
          );
        },
      },
      {
        header: 'JC Status',
        width: '8%',
        nowrap: true,
        render: (jc) => <StatusBadge kind="jc" status={jc.computedStatus} />,
      },
      {
        header: 'JC Date',
        width: '6%',
        className: 'mono',
        nowrap: true,
        render: (jc) => fmtDate(jc.jcDate),
      },
      {
        header: 'Due Date',
        width: '7%',
        className: 'mono',
        nowrap: true,
        render: (jc) => (
          <>
            {fmtDate(jc.dueDate)}
            {/* The plan's Customer Dispatch Date under the due date — a second
                line, not a column, so the tuned widths above still add up. */}
            {jc.customerDispatchDate ? (
              <div
                className="text3"
                style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}
                title="Customer Dispatch Date (from the plan)"
              >
                Dispatch {fmtDate(jc.customerDispatchDate)}
              </div>
            ) : null}
          </>
        ),
      },
      {
        header: 'Days Left',
        width: '5%',
        align: 'right',
        nowrap: true,
        render: (jc) => {
          const dLeft = daysLeftFor(jc, today);
          return (
            <span className="mono fw-700" style={{ color: daysLeftColor(dLeft) }}>
              {dLeft == null ? '—' : dLeft}
            </span>
          );
        },
      },
    ],
    [currentPage, today],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, the create buttons, the KPI
          strip AND the filter panel stay pinned while the list scrolls
          underneath, so the filters stay reachable. */}
      <ListHeader
        title="Job Cards"
        icon="▭"
        count={total}
        noun="job card"
        filterNote={search.status ? JC_STATUS_LABEL[search.status] : undefined}
        updating={isFetching && !isLoading}
        primary={
          canWrite ? (
            <>
              <Link to="/planning" className="btn btn-primary">
                + Plan &amp; Create Job Card
              </Link>
              <Link
                to="/job-cards/new"
                className="btn btn-ghost"
                title="JWSO only. Sales Order items: Planning → Production Order."
              >
                + New JWSO Job Card
              </Link>
            </>
          ) : null
        }
      >
        {/* KPI strip — ONE single-row strip (styling skill Rule 3). Counts
            reflect the loaded / filtered set, not global, so they are read-only
            figures: no onClick, no filtering. */}
        <StatStrip
          items={[
            {
              key: 'not_started',
              label: 'Not Started',
              count: kpis.open,
              color: 'var(--text3)',
            },
            {
              key: 'in_progress',
              label: 'In Progress',
              count: kpis.inProgress,
              color: 'var(--amber2)',
            },
            {
              key: 'completed',
              label: 'Completed',
              count: kpis.completed,
              color: 'var(--green2)',
            },
            { key: 'overdue', label: 'Overdue', count: kpis.overdue, color: 'var(--red2)' },
          ]}
        />

        <FilterBar
          search={searchInput}
          onSearch={setSearchInput}
          placeholder="Search JC no., item code / name, customer, SO no.…"
          filters={[
            {
              key: 'status',
              value: search.status ?? '',
              onChange: (v) => setNav({ status: v === '' ? undefined : (v as JcComputedStatus) }),
              options: [
                { value: '', label: 'All statuses' },
                ...JC_COMPUTED_STATUSES.map((s) => ({
                  value: s,
                  label: JC_STATUS_LABEL[s],
                })),
              ],
            },
            {
              key: 'machine',
              value: search.machineId ?? '',
              onChange: (v) => setNav({ machineId: v === '' ? undefined : v }),
              options: [
                { value: '', label: 'All machines' },
                ...machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` })),
              ],
            },
            {
              key: 'operator',
              value: search.operatorId ?? '',
              onChange: (v) => setNav({ operatorId: v === '' ? undefined : v }),
              options: [
                { value: '', label: 'All operators' },
                ...operators.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` })),
              ],
            },
          ]}
        >
          {/* Dates and the view switch are not dropdowns, so they ride in
              FilterBar's own slot for extra controls rather than becoming
              fake selects. */}
          <Input
            type="date"
            value={search.fromDate ?? ''}
            onChange={(e) => setNav({ fromDate: e.target.value || undefined })}
            title="JC Date from"
            aria-label="JC Date from"
          />
          <Input
            type="date"
            value={search.toDate ?? ''}
            onChange={(e) => setNav({ toDate: e.target.value || undefined })}
            title="JC Date to"
            aria-label="JC Date to"
          />
          <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            <ViewToggle value={view} onChange={changeView} />
          </div>
        </FilterBar>
      </ListHeader>

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load Job Cards. Try again.'}
        />
      ) : view === 'list' ? (
        // ── LIST VIEW (the ruled sheet) ──────────────────────────────────────
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={pagedRows}
            loading={isLoading}
            emptyText={emptyText}
            onRowClick={(jc) => void navigate({ to: '/job-cards/$id', params: { id: jc.id } })}
            rowActionsWidth="15%"
            rowActions={(jc) => rowActions(jc, false)}
          />
        </Panel>
      ) : isLoading ? (
        <PageState state="loading" />
      ) : rows.length === 0 ? (
        <PageState state="empty" message={emptyText} />
      ) : (
        // ── CARD VIEW ────────────────────────────────────────────────────────
        // Kept as its own card, NOT <DocCard>: a DocCard's band click is its
        // expand toggle and it draws a chevron to say so, but these cards do
        // not expand — the whole card opens the job. Everything INSIDE the
        // card is now the kit's (QtyStrip, ProgressBar, StatusBadge, Badge,
        // ItemBadge, RowActions).
        rows.map((jc) => {
          const done = jc.lastOpCompletedQty;
          const pending = Math.max(0, jc.orderQty - done);
          const pct = jc.orderQty > 0 ? Math.min(100, Math.round((done / jc.orderQty) * 100)) : 0;
          const overdue =
            jc.dueDate != null &&
            jc.dueDate < today &&
            jc.computedStatus !== 'closed' &&
            jc.computedStatus !== 'complete';
          const s = jc.sourceLink;
          const route = s ? sourceRoute(s) : null;
          const high = jc.priority === 'high';
          const open = (): void => {
            void navigate({ to: '/job-cards/$id', params: { id: jc.id } });
          };
          return (
            <div
              key={jc.id}
              className="panel"
              style={{
                display: 'flex',
                overflow: 'hidden',
                padding: 0,
                marginBottom: 'var(--sp-2)',
              }}
            >
              <div style={{ width: 4, flexShrink: 0, background: accentFor(jc, today) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Band 1: identity + priority + status + actions */}
                <div
                  onClick={open}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                    padding: 'var(--sp-2) var(--sp-3)',
                    cursor: 'pointer',
                  }}
                >
                  <Link
                    to="/job-cards/$id"
                    params={{ id: jc.id }}
                    className="td-code"
                    style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 'var(--fs-sm)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {jc.code}
                  </Link>
                  {/* Product image + `CODE/REV` + name — the customer's drawing
                      revision from the SO line this card was raised against; a
                      JW-sourced or standalone card has none and keeps the bare
                      code. Same shared badge as the List View and the Job Card
                      view, so the screens cannot spell it differently. */}
                  <ItemBadge
                    size="card"
                    code={jc.itemCode}
                    name={jc.itemName}
                    revision={jc.itemRevision}
                    imagePath={jc.itemImagePath}
                  />
                  {s && route ? (
                    <Link
                      to={route.to}
                      params={{ id: route.id }}
                      className="mono"
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--blue)',
                        textDecoration: 'none',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {s.code}
                      {s.lineNo !== 1 ? <span>/{s.lineNo}</span> : null}
                    </Link>
                  ) : null}
                  {/* ADR-170 — the Production Order that built this card, in
                      the same quiet mono as the SO link beside it. Old cards
                      carry null and show nothing. */}
                  {jc.productionOrderId && jc.productionOrderCode ? (
                    <Link
                      to="/production-orders/$id"
                      params={{ id: jc.productionOrderId }}
                      className="mono"
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--blue)',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                      title="Production Order"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {jc.productionOrderCode}
                    </Link>
                  ) : null}
                  <Badge tone={high ? 'amber' : 'grey'}>{high ? 'High' : 'Normal'}</Badge>
                  <StatusBadge kind="jc" status={jc.computedStatus} />
                  {jc.runningCount > 0 ? (
                    <span
                      className="fw-700"
                      style={{ fontSize: 'var(--fs-xs)', color: 'var(--green2)' }}
                      title="Operations running now"
                    >
                      ▶{jc.runningCount}
                    </span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  {rowActions(jc, true)}
                </div>
                {/* Band 2: metric strip + progress + meta line */}
                <div
                  onClick={open}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--sp-3)',
                    flexWrap: 'wrap',
                    padding: '0 var(--sp-3) var(--sp-2)',
                    cursor: 'pointer',
                  }}
                >
                  <QtyStrip
                    items={[
                      { label: 'Order Qty', value: jc.orderQty },
                      { label: 'Completed', value: done, color: 'var(--green2)' },
                      {
                        label: 'Pending',
                        value: pending,
                        color: pending > 0 ? 'var(--blue)' : 'var(--green)',
                      },
                      { label: 'Ops', value: `${jc.doneOps}/${jc.totalOps}` },
                    ]}
                  />
                  <div style={{ minWidth: 90 }}>
                    <ProgressBar value={pct} color="var(--green)" label="Completed" />
                    <div
                      className="mono text3"
                      style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-0)' }}
                    >
                      {pct}% complete
                    </div>
                  </div>
                  <div
                    className="mono text3"
                    style={{
                      fontSize: 'var(--fs-xs)',
                      display: 'flex',
                      gap: 'var(--sp-1)',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="text2">{fmtDate(jc.jcDate)}</span>
                    {jc.clientPoLineNo ? (
                      <>
                        <span>·</span>
                        <span>
                          POL{' '}
                          <span className="fw-700" style={{ color: 'var(--purple)' }}>
                            {jc.clientPoLineNo}
                          </span>
                        </span>
                      </>
                    ) : null}
                    <span>·</span>
                    <span
                      style={{
                        color: overdue ? 'var(--red)' : undefined,
                        fontWeight: overdue ? 700 : undefined,
                      }}
                    >
                      {jc.dueDate
                        ? `Due ${fmtDate(jc.dueDate)}${overdue ? ' ⚠' : ''}`
                        : 'No due date'}
                    </span>
                    {jc.remarks ? (
                      <>
                        <span>·</span>
                        <span
                          title={jc.remarks}
                          style={{
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {jc.remarks}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}

      {isError ? null : (
        <ListFooter
          // Scroll mode while everything fits one page — which it always does
          // while PAGE_SIZE equals the fetch cap — so the count line still
          // warns when the server truncated the set. The pager only appears if
          // the loaded list ever outgrows a page, and then the totals it
          // divides are the LOADED rows, not the server's count.
          total={totalPages > 1 ? rows.length : total}
          shown={rows.length}
          noun="job card"
          limit={LIST_LIMIT}
          {...(totalPages > 1 && view === 'list'
            ? { page: currentPage, pageSize: PAGE_SIZE, onPage: gotoPage }
            : {})}
        />
      )}
    </div>
  );
}
