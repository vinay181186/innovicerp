// Job cards list (UI-003-07) — read-only.

import {
  JC_COMPUTED_STATUSES,
  type JcComputedStatus,
  type JobCardListItem,
  type ListJobCardsQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { ItemBadge } from '@/components/shared/item-badge';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { StatStrip } from '@/components/shared/stat-strip';
import { useMachinesList } from '@/modules/machines/api';
import { useOperatorsList } from '@/modules/operators/api';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobCardsList } from '../api';
import { ExcelJcButton } from '../components/excel-jc-button';
import { JcRowWriteActions } from '../components/jc-row-write-actions';
import { JcStatusBadge } from '../components/jc-status-badge';
import { PrintJcButton } from '../components/print-jc-button';

// One fetch, cap 200 (mirrors the SO/WO list). List View paginates CLIENT-SIDE
// at PAGE_SIZE per page — so only a page's worth of product-image thumbnails
// load at a time (each is one signed-URL fetch, cached; paging keeps that
// bounded). The thumbnail is the shared <ItemBadge> — the Item Master's PRODUCT
// IMAGE (items.image_path), NOT the drawing (user decision 2026-09-21). The old
// drawing-based PartThumb wrote a drawing_view audit row per row shown; the
// product image is not a controlled document and is not logged.
const LIST_LIMIT = 200;
// One page = the whole loaded list (user, 2026-09-21: the sheet scrolls, no
// Prev / Next). The image badges lazy-load, so a long page costs nothing
// until a row is scrolled into view; the pager below still exists and simply
// never shows while everything fits one page.
const PAGE_SIZE = 200;
const VIEW_STORAGE_KEY = 'jc-list-view';

/** One cell of the card's metric strip — big mono value over a tiny uppercase
 *  label, mirroring the SO/WO list (ORDER QTY / COMPLETED / PENDING / OPS). */
function QtyBox({
  label,
  value,
  color,
  bordered,
}: {
  label: string;
  value: number | string;
  color?: string;
  bordered?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '4px 12px',
        textAlign: 'center',
        minWidth: 58,
        borderLeft: bordered ? '1px solid var(--border)' : undefined,
      }}
    >
      <div
        className="mono fw-700"
        style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 9,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
    </div>
  );
}

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

  // List View (new table) vs Card View (the original SO-style cards). List is the
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
  // Tier-driven, per department (jc_create sits in Production). Replaces the old
  // admin/manager flag. Creating a Job Card is `entry` (L2 Data Entry and up).
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').entry;

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];
  const today = new Date().toISOString().slice(0, 10);

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
  //   Open        = not started (no ops done) and not done
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

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'jc_create').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      {/* Frozen header band — matches the SO/WO list (sales-orders/routes/list.tsx).
          Title + create buttons, KPI strip AND the filter panel (search / status /
          machine / operator / dates) stay pinned while the list scrolls
          underneath, so filters stay reachable like the SO list's search.
          Background must be opaque var(--bg) or rows show through as they pass
          under. Not bled edge-to-edge — that would give the app a horizontal
          scrollbar. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 12,
            gap: 8,
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 2 }}>
              Job Cards
            </div>
            <div className="text3" style={{ fontSize: 12 }}>
              Plan, track and manage manufacturing jobs
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            {canWrite ? (
              <>
                <Link to="/planning" className="btn btn-primary">
                  + Plan &amp; Create Job Card
                </Link>
                <Link
                  to="/job-cards/new"
                  className="btn btn-ghost"
                  title="Job Work Sales Orders (JWSO) only. Sales Order items are created via Planning."
                >
                  + New JWSO Job Card
                </Link>
              </>
            ) : null}
          </div>
        </div>

        {/* KPI strip — ONE single-row strip (styling skill Rule 3), reused
          <StatStrip>. Counts reflect the loaded/filtered set, not global. */}
        <div style={{ marginBottom: 10 }}>
          <StatStrip
            items={[
              { key: 'total', label: 'Total Job Cards', count: kpis.total, color: 'var(--cyan)' },
              { key: 'open', label: 'Open', count: kpis.open, color: 'var(--amber)' },
              {
                key: 'in_progress',
                label: 'In Progress',
                count: kpis.inProgress,
                color: 'var(--blue)',
              },
              {
                key: 'on_hold',
                label: 'On Hold',
                count: kpis.onHold,
                color: 'var(--text3)',
                title: 'No hold state exists in job-card data — see report',
              },
              {
                key: 'completed',
                label: 'Completed',
                count: kpis.completed,
                color: 'var(--green)',
              },
              { key: 'overdue', label: 'Overdue', count: kpis.overdue, color: 'var(--red)' },
            ]}
          />
          <div className="text3" style={{ fontSize: 10, marginTop: 4 }}>
            Counts reflect the currently loaded / filtered list, not every job card in the system.
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-body" style={{ padding: '10px 14px' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <input
                className="innovic-input"
                placeholder="Search JC no., item code / name, customer, SO no.…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ width: 320, fontSize: 12 }}
              />
              <select
                className="innovic-select"
                value={search.status ?? ''}
                onChange={(e) => {
                  const v = e.target.value as JcComputedStatus | '';
                  setNav({ status: v === '' ? undefined : v });
                }}
                style={{ width: 180, fontSize: 12 }}
              >
                <option value="">All statuses</option>
                {JC_COMPUTED_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
              <span style={{ flex: 1 }} />
              {/* List / Card view toggle */}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => changeView('list')}
                  aria-pressed={view === 'list'}
                >
                  List View
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${view === 'card' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => changeView('card')}
                  aria-pressed={view === 'card'}
                >
                  Card View
                </button>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              <select
                className="innovic-select"
                value={search.machineId ?? ''}
                onChange={(e) => setNav({ machineId: e.target.value || undefined })}
                style={{ fontSize: 12 }}
              >
                <option value="">All machines</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} — {m.name}
                  </option>
                ))}
              </select>
              <select
                className="innovic-select"
                value={search.operatorId ?? ''}
                onChange={(e) => setNav({ operatorId: e.target.value || undefined })}
                style={{ fontSize: 12 }}
              >
                <option value="">All operators</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} — {o.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="innovic-input"
                value={search.fromDate ?? ''}
                onChange={(e) => setNav({ fromDate: e.target.value || undefined })}
                placeholder="From date"
                style={{ fontSize: 12 }}
              />
              <input
                type="date"
                className="innovic-input"
                value={search.toDate ?? ''}
                onChange={(e) => setNav({ toDate: e.target.value || undefined })}
                placeholder="To date"
                style={{ fontSize: 12 }}
              />
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20 }}>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading job cards…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20, color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load job cards'}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 20 }}>
            No job cards match these filters.
          </div>
        </div>
      ) : view === 'list' ? (
        // ── LIST VIEW (new table) ────────────────────────────────────────────
        <>
          {/* The sheet look (tbl-grid, the Plans list's): bold blue column
              names, gridlines, cream / white rows, fixed widths that add up
              to the page so nothing scrolls sideways. */}
          <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
            <table className="innovic-table tbl-grid">
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '17%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Sr No</th>
                  <th>Job Card No.</th>
                  <th style={{ textAlign: 'left' }}>Part / Description</th>
                  <th>SO No.</th>
                  <th>Qty (Plan)</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Start Date</th>
                  <th>Due Date</th>
                  <th>Days Left</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((jc, i) => {
                  const rowNo = (currentPage - 1) * PAGE_SIZE + i + 1;
                  const done = jc.lastOpCompletedQty;
                  const pct =
                    jc.orderQty > 0 ? Math.min(100, Math.round((done / jc.orderQty) * 100)) : 0;
                  const dLeft = daysLeftFor(jc, today);
                  const dColor =
                    dLeft == null
                      ? 'var(--text3)'
                      : dLeft < 0
                        ? 'var(--red)'
                        : dLeft <= 5
                          ? 'var(--amber)'
                          : 'var(--green)';
                  const s = jc.sourceLink;
                  return (
                    <tr
                      key={jc.id}
                      onClick={() => void navigate({ to: '/job-cards/$id', params: { id: jc.id } })}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="text3">{rowNo}</td>
                      <td>
                        <Link
                          to="/job-cards/$id"
                          params={{ id: jc.id }}
                          className="td-code"
                          style={{ color: 'var(--blue)', fontWeight: 800 }}
                          title="View job card status"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {jc.code}
                        </Link>
                        {jc.itemRevision ? (
                          <div className="mono" style={{ fontSize: 9, color: 'var(--text3)' }}>
                            Rev. {jc.itemRevision}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {/* Product image + CODE/REV + name. The revision is the
                            customer's drawing revision off the SO line (null →
                            bare code). Click the picture to see it large.
                            Left-aligned and full-width on purpose: the table
                            standard centres cells, and a centred inline badge
                            moves its picture box left or right with the length
                            of the text beside it — every row's box then sat at
                            a different x ("dancing"). Filling the cell pins the
                            box to the same left edge in every row. */}
                        <ItemBadge
                          size="row"
                          code={jc.itemCode}
                          name={jc.itemName}
                          revision={jc.itemRevision}
                          imagePath={jc.itemImagePath}
                          style={{ display: 'flex', width: '100%' }}
                        />
                      </td>
                      <td>
                        {s ? (
                          <Link
                            to={s.type === 'so' ? '/sales-orders/$id' : '/job-work-orders/$id'}
                            params={{ id: s.type === 'so' ? s.salesOrderId : s.jobWorkOrderId }}
                            className="mono"
                            style={{ fontSize: 11, color: 'var(--blue)', textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {s.code}
                            {s.lineNo !== 1 ? (
                              <span style={{ fontSize: 9 }}>/{s.lineNo}</span>
                            ) : null}
                          </Link>
                        ) : (
                          <span className="text3">—</span>
                        )}
                      </td>
                      <td>
                        <span className="mono fw-700">{jc.orderQty}</span>{' '}
                        <span className="text3" style={{ fontSize: 10 }}>
                          Nos
                        </span>
                      </td>
                      <td>
                        <div
                          style={{
                            display: 'inline-flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 2,
                            minWidth: 80,
                          }}
                        >
                          <div
                            style={{
                              width: 80,
                              height: 4,
                              background: 'var(--bg5)',
                              borderRadius: 2,
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: '100%',
                                background: 'var(--green)',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                          <div className="mono" style={{ fontSize: 9, color: 'var(--text3)' }}>
                            {done} / {jc.orderQty} · {pct}%
                          </div>
                        </div>
                      </td>
                      <td>
                        <JcStatusBadge status={jc.computedStatus} />
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {jc.jcDate}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {jc.dueDate ?? '—'}
                        {/* The plan's Customer Dispatch Date under the due
                            date — a second line, not a column, so the tuned
                            widths above still add up to the page. */}
                        {jc.customerDispatchDate ? (
                          <div
                            className="text3"
                            style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                            title="Customer Dispatch Date (from the plan)"
                          >
                            Disp {jc.customerDispatchDate}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className="mono fw-700" style={{ color: dColor }}>
                          {dLeft == null ? '—' : dLeft}
                        </span>
                      </td>
                      <td>
                        {/* Two buttons per line: five ghost buttons in a row
                            were what pushed the sheet past the page edge. */}
                        <div
                          className="jc-row-acts"
                          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            to="/job-cards/$id"
                            params={{ id: jc.id }}
                            className="btn btn-primary btn-sm"
                            title="View job card status"
                          >
                            👁 View
                          </Link>
                          <PrintJcButton jc={jc} />
                          <ExcelJcButton jc={jc} />
                          <JcRowWriteActions jc={jc} />
                          <AssignTaskButton
                            linkedRef={{
                              type: 'job_card',
                              id: jc.id,
                              display: `JC ${jc.code}`,
                              navPage: '/job-cards',
                            }}
                            suggestedTitle={`Follow up on JC ${jc.code}`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
            💡 Click a row to open the job card.
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 8,
              fontSize: 12,
              color: 'var(--text3)',
            }}
          >
            <span>
              {total > LIST_LIMIT
                ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
                : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, rows.length)} of ${rows.length} job card${rows.length === 1 ? '' : 's'}`}
            </span>
            {totalPages > 1 ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={currentPage <= 1}
                  onClick={() => gotoPage(currentPage - 1)}
                >
                  ‹ Prev
                </button>
                <span className="mono">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => gotoPage(currentPage + 1)}
                >
                  Next ›
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        // ── CARD VIEW (original SO-style cards, unchanged) ───────────────────
        <>
          {rows.map((jc) => {
            const done = jc.lastOpCompletedQty;
            const pending = Math.max(0, jc.orderQty - done);
            const pct = jc.orderQty > 0 ? Math.min(100, Math.round((done / jc.orderQty) * 100)) : 0;
            const overdue =
              jc.dueDate != null &&
              jc.dueDate < today &&
              jc.computedStatus !== 'closed' &&
              jc.computedStatus !== 'complete';
            const s = jc.sourceLink;
            const high = jc.priority === 'high';
            return (
              <div
                key={jc.id}
                className="panel"
                style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
              >
                <div style={{ width: 4, flexShrink: 0, background: accentFor(jc, today) }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Band 1: identity + priority + status + actions */}
                  <div
                    onClick={() => void navigate({ to: '/job-cards/$id', params: { id: jc.id } })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                      padding: '10px 14px',
                      cursor: 'pointer',
                    }}
                  >
                    <Link
                      to="/job-cards/$id"
                      params={{ id: jc.id }}
                      className="td-code"
                      style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
                      title="View job card status"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {jc.code}
                    </Link>
                    {/* Product image + `CODE/REV` + name — the customer's
                        drawing revision from the SO line this card was raised
                        against; a JW-sourced or standalone card has none and
                        keeps the bare code, with no trailing slash. Same shared
                        badge as the List View and the Job Card view so the
                        screens cannot spell it differently. */}
                    <ItemBadge
                      size="card"
                      code={jc.itemCode}
                      name={jc.itemName}
                      revision={jc.itemRevision}
                      imagePath={jc.itemImagePath}
                    />
                    {s
                      ? (() => {
                          const to = s.type === 'so' ? '/sales-orders/$id' : '/job-work-orders/$id';
                          const sid = s.type === 'so' ? s.salesOrderId : s.jobWorkOrderId;
                          return (
                            <Link
                              to={to}
                              params={{ id: sid }}
                              className="mono"
                              style={{ fontSize: 11, color: 'var(--blue)', textDecoration: 'none' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {s.code}
                              {s.lineNo !== 1 ? (
                                <span style={{ fontSize: 9, color: 'var(--blue)', marginLeft: 2 }}>
                                  /{s.lineNo}
                                </span>
                              ) : null}
                            </Link>
                          );
                        })()
                      : null}
                    {/* ADR-170 — the Production Order that built this card, in
                        the same quiet mono as the SO link beside it. Old cards
                        carry null and show nothing. */}
                    {jc.productionOrderId && jc.productionOrderCode ? (
                      <Link
                        to="/production-orders/$id"
                        params={{ id: jc.productionOrderId }}
                        className="mono"
                        style={{
                          fontSize: 11,
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
                    <span className={`badge ${high ? 'b-amber' : 'b-grey'}`}>
                      {high ? 'High' : 'Normal'}
                    </span>
                    <JcStatusBadge status={jc.computedStatus} />
                    {jc.runningCount > 0 ? (
                      <span style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700 }}>
                        ▶{jc.runningCount}
                      </span>
                    ) : null}
                    <span style={{ flex: 1 }} />
                    <div
                      style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        to="/job-cards/$id"
                        params={{ id: jc.id }}
                        className="btn btn-ghost btn-sm"
                        title="View job card status"
                      >
                        👁 View
                      </Link>
                      <PrintJcButton jc={jc} />
                      <ExcelJcButton jc={jc} />
                      <JcRowWriteActions jc={jc} />
                      <AssignTaskButton
                        linkedRef={{
                          type: 'job_card',
                          id: jc.id,
                          display: `JC ${jc.code}`,
                          navPage: '/job-cards',
                        }}
                        suggestedTitle={`Follow up on JC ${jc.code}`}
                      />
                    </div>
                  </div>
                  {/* Band 2: metric strip + progress + meta line */}
                  <div
                    onClick={() => void navigate({ to: '/job-cards/$id', params: { id: jc.id } })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'wrap',
                      padding: '0 14px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                      }}
                    >
                      <QtyBox label="Order Qty" value={jc.orderQty} />
                      <QtyBox label="Completed" value={done} color="var(--green)" bordered />
                      <QtyBox
                        label="Pending"
                        value={pending}
                        color={pending > 0 ? 'var(--red)' : 'var(--green)'}
                        bordered
                      />
                      <QtyBox label="Ops" value={`${jc.doneOps}/${jc.totalOps}`} bordered />
                    </div>
                    <div style={{ minWidth: 90 }}>
                      <div
                        style={{ width: 90, height: 4, background: 'var(--bg5)', borderRadius: 2 }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: 'var(--green)',
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <div
                        className="mono"
                        style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}
                      >
                        {pct}% complete
                      </div>
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--text3)',
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className="text2">{jc.jcDate}</span>
                      {jc.clientPoLineNo ? (
                        <>
                          <span>·</span>
                          <span>
                            CPO{' '}
                            <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
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
                        {jc.dueDate ? `Due ${jc.dueDate}${overdue ? ' ⚠' : ''}` : 'No due date'}
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
          })}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              marginTop: 8,
              fontSize: 12,
              color: 'var(--text3)',
            }}
          >
            <span>
              {total === 0
                ? 'No job cards'
                : total > LIST_LIMIT
                  ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
                  : `Showing all ${total} job card${total === 1 ? '' : 's'}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
