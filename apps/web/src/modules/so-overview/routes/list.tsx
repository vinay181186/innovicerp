// SO Overview list (PL-2 + PL-2b parity port). Mirrors legacy renderSOOverview
// L9112 — list mode shows one row per open SO with overall status badge +
// progress + alert flags; PL-2b adds the overall-status filter and Equipment column.
// Clicking an SO row (or its Activity button) opens that SO's SO Status page
// (/sales-orders/$id/status, owner decision 2026-09-26) — the old in-memory
// drill view that replaced this list is gone, so Back / refresh now behave.

import type { SoOverallStatus, SoOverviewRow } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Activity, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SearchInput } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useSoOverview } from '../api';

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['open', 'closed', 'dispatched', 'cancelled', 'all']).optional(),
});

export const soOverviewListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-overview',
  validateSearch: searchSchema,
  component: SoOverviewPage,
});

const STATUS_BADGE: Record<SoOverallStatus, { cls: string; label: string }> = {
  not_started: { cls: 'b-grey', label: 'Not Started' },
  in_progress: { cls: 'b-cyan', label: 'In Progress' },
  on_track: { cls: 'b-green', label: 'On Track' },
  delayed: { cls: 'b-red', label: 'Delayed' },
  completed: { cls: 'b-green', label: 'Completed' },
  blocked: { cls: 'b-red', label: 'Blocked' },
};

/** Per-row status filter (different from header.status — this filters the
 *  *derived* overallStatus). A dropdown in the filter bar with the counts in
 *  its option labels (was a pill row, PL-2b §1.3; owner decision
 *  2026-09-26). */
type OverallStatusFilter = SoOverallStatus | 'all';
const OVERALL_STATUS_LABELS: Array<{ value: OverallStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_track', label: 'On Track' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'completed', label: 'Completed' },
  { value: 'blocked', label: 'Blocked' },
];

function SoOverviewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status } = soOverviewListRoute.useSearch();
  const [overallFilter, setOverallFilter] = useState<OverallStatusFilter>('all');
  // Bumped by Clear so a still-pending debounced keystroke cannot re-apply
  // the search it just cleared (SearchInput RESET SEMANTICS).
  const [clearKey, setClearKey] = useState(0);

  // The box keeps what the user typed (a trailing space included); only the
  // normalised term goes to the URL. Feeding the trimmed URL term back as the
  // box value made SearchInput overwrite the draft and eat a typed space.
  const urlRef = useRef({ search, status });
  urlRef.current = { search, status };
  const [searchInput, setSearchInput] = useState(search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link).
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search ?? '') ? prev : (search ?? ''),
    );
  }, [search]);
  useEffect(() => {
    // Runs only when the box changes (not when the URL does), so a Back to
    // another term is adopted above instead of being written over here.
    const next = normalizeSearchTerm(searchInput) || undefined;
    const cur = urlRef.current;
    if (next === cur.search) return;
    void navigate({
      to: '/so-overview',
      search: { ...(cur.status ? { status: cur.status } : {}), ...(next ? { search: next } : {}) },
      replace: true,
    });
  }, [searchInput, navigate]);
  const { data, isLoading, isError, error } = useSoOverview({
    search,
    status,
  });

  const openSoStatus = (soId: string): void => {
    void navigate({ to: '/sales-orders/$id/status', params: { id: soId } });
  };

  const filteredRows =
    overallFilter === 'all'
      ? (data?.rows ?? [])
      : (data?.rows ?? []).filter((r) => r.overallStatus === overallFilter);

  return (
    <div>
      {/* The ONE list header (ui/layout ListHeader). The debounced SearchInput
          rides in `searchSlot` so the URL write keeps its 300ms delay; the
          SO status and overall-status (with counts) dropdowns sit beside it
          in the filter bar. */}
      <ListHeader
        title="SO Overview"
        icon="📊"
        count={data ? filteredRows.length : undefined}
        noun="SO"
        filterNote={
          overallFilter !== 'all'
            ? OVERALL_STATUS_LABELS.find((o) => o.value === overallFilter)?.label
            : undefined
        }
        searchSlot={
          // Our server (so-overview/service.ts) ILIKEs code / customerName /
          // clientPoNo only — the placeholder states what actually works.
          <SearchInput
            debounceMs={300}
            resetKey={clearKey}
            placeholder="Search SO No., customer, client PO No.…"
            value={searchInput}
            onChange={setSearchInput}
          />
        }
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="SO status"
              title="SO status"
              value={status ?? ''}
              onChange={(e) =>
                void navigate({
                  to: '/so-overview',
                  search: {
                    ...(search ? { search } : {}),
                    status:
                      (e.target.value as
                        | 'open'
                        | 'closed'
                        | 'dispatched'
                        | 'cancelled'
                        | 'all'
                        | '') || undefined,
                  },
                })
              }
            >
              <option value="">Open (default)</option>
              <option value="closed">Closed</option>
              <option value="dispatched">Dispatched</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </select>
            <OverallStatusSelect
              rows={data?.rows ?? []}
              value={overallFilter}
              onChange={setOverallFilter}
            />
          </>
        }
        onClearFilters={() => {
          setOverallFilter('all');
          setClearKey((k) => k + 1);
          void navigate({ to: '/so-overview', search: {}, replace: true });
        }}
        filtersActive={!!(search || status || searchInput) || overallFilter !== 'all'}
      />

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading SO overview…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load SO overview. Try again.'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <OverviewTable rows={filteredRows} onRowClick={openSoStatus} />
          <ListFooter total={data.rows.length} shown={filteredRows.length} noun="SO" />
        </>
      ) : null}
    </div>
  );
}

function OverallStatusSelect({
  rows,
  value,
  onChange,
}: {
  rows: SoOverviewRow[];
  value: OverallStatusFilter;
  onChange: (next: OverallStatusFilter) => void;
}): React.JSX.Element {
  const counts: Record<OverallStatusFilter, number> = {
    all: rows.length,
    not_started: 0,
    in_progress: 0,
    on_track: 0,
    delayed: 0,
    completed: 0,
    blocked: 0,
  };
  for (const r of rows) counts[r.overallStatus] = (counts[r.overallStatus] ?? 0) + 1;
  return (
    <select
      className="innovic-select"
      aria-label="Overall status"
      title="Overall status"
      value={value}
      onChange={(e) => onChange(e.target.value as OverallStatusFilter)}
    >
      {OVERALL_STATUS_LABELS.map((opt) => {
        const count = counts[opt.value] ?? 0;
        // Skip non-"all" options when count is zero AND not selected.
        if (opt.value !== 'all' && count === 0 && value !== opt.value) return null;
        return (
          <option key={opt.value} value={opt.value}>
            {opt.label} ({count})
          </option>
        );
      })}
    </select>
  );
}

function OverviewTable({
  rows,
  onRowClick,
}: {
  rows: SoOverviewRow[];
  onRowClick: (soId: string) => void;
}): React.JSX.Element {
  return (
    <>
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            <thead>
              <tr>
                <th>SO No.</th>
                <th>Customer</th>
                <th>SO Type</th>
                <th>Equipment</th>
                <th className="th-num">Lines</th>
                <th>SO Status</th>
                <th>Progress</th>
                <th className="th-num">Order Qty</th>
                <th className="th-num" style={{ color: 'var(--green2)' }}>
                  Completed
                </th>
                <th className="th-num" style={{ color: 'var(--red2)' }}>
                  Pending
                </th>
                <th>Due Date</th>
                <th>Alerts</th>
                <th>SO Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="empty-state">
                    No open SOs found
                  </td>
                </tr>
              ) : (
                rows.map((row) => <Row key={row.id} row={row} onRowClick={onRowClick} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Row({
  row,
  onRowClick,
}: {
  row: SoOverviewRow;
  onRowClick: (soId: string) => void;
}): React.JSX.Element {
  const badge = STATUS_BADGE[row.overallStatus];
  const today = new Date().toISOString().slice(0, 10);
  const overdue =
    row.earliestDueDate !== null &&
    row.earliestDueDate < today &&
    row.overallStatus !== 'completed';
  return (
    <tr style={{ cursor: 'pointer' }} onClick={() => onRowClick(row.id)}>
      <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        <Link
          to="/sales-orders/$id"
          params={{ id: row.id }}
          className="td-code"
          style={{ color: 'var(--cyan)', fontSize: 13, fontWeight: 800 }}
        >
          {row.code}
        </Link>
        {row.clientPoNo ? (
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Client PO No. {row.clientPoNo}
          </div>
        ) : null}
      </td>
      <td className="fw-700">{row.customerName ?? '—'}</td>
      <td style={{ fontSize: 11 }}>
        {row.type === 'equipment'
          ? 'Equipment'
          : row.type === 'with_material'
            ? 'With Material'
            : 'Component'}
      </td>
      <td style={{ color: 'var(--purple)', fontSize: 12 }}>{row.equipmentItemName ?? '—'}</td>
      <td className="td-num mono fw-700" style={{ color: 'var(--purple)' }}>
        {row.lineCount}
      </td>
      <td>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 110 }}>
          <ProgBar pct={row.overallPct} status={row.overallStatus} />
          <span
            className="mono fw-700"
            style={{ fontSize: 11, color: barTextColor(row.overallStatus) }}
          >
            {row.overallPct}%
          </span>
        </div>
      </td>
      <td className="td-num mono fw-700">{row.totalRequiredQty}</td>
      <td className="td-num mono fw-700" style={{ color: 'var(--green2)' }}>
        {row.totalDoneQty}
      </td>
      <td
        className="td-num mono fw-700"
        style={{ color: row.totalBalanceQty > 0 ? 'var(--red2)' : 'var(--green2)' }}
      >
        {row.totalBalanceQty}
      </td>
      <td
        style={{
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          color: overdue ? 'var(--red2)' : 'var(--text)',
        }}
      >
        {fmtDate(row.earliestDueDate)}
      </td>
      <td>
        <AlertFlags row={row} />
      </td>
      <td className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {fmtDate(row.soDate)}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <Link
          to="/sales-orders/$id/status"
          params={{ id: row.id }}
          className="btn btn-ghost btn-sm"
          title="Open SO Status"
        >
          <Activity size={13} />
        </Link>
      </td>
    </tr>
  );
}

/** Legacy L9135 renders alerts as plain coloured spans (not badges), in the
 *  order ⚠ delayed → 🏭 at-vendor → 🔬 QC → 🚫 blocked, falling back to an
 *  em-dash. Titles describe what OUR server actually returns (a qty for
 *  at-vendor, an op count for QC) rather than legacy's per-line counts. */
function AlertFlags({ row }: { row: SoOverviewRow }): React.JSX.Element {
  const flags: React.ReactNode[] = [];
  if (row.alerts.delayedLines > 0) {
    flags.push(
      <span
        key="delayed"
        style={{ color: 'var(--red2)', fontWeight: 700, fontSize: 11 }}
        title="Lines past due"
      >
        ⚠{row.alerts.delayedLines}
      </span>,
    );
  }
  if (row.alerts.atVendorQty > 0) {
    flags.push(
      <span
        key="atvendor"
        style={{ color: 'var(--purple)', fontSize: 11 }}
        title="Qty at outsource vendor"
      >
        🏭{row.alerts.atVendorQty}
      </span>,
    );
  }
  if (row.alerts.qcPendingOps > 0) {
    flags.push(
      <span key="qcpend" style={{ color: 'var(--amber2)', fontSize: 11 }} title="Ops awaiting QC">
        🔬{row.alerts.qcPendingOps}
      </span>,
    );
  }
  if (row.stageCounts.hold > 0) {
    flags.push(
      <span key="hold" style={{ color: 'var(--red2)', fontSize: 11 }} title="Lines on hold">
        🚫{row.stageCounts.hold}
      </span>,
    );
  }
  if (flags.length === 0) {
    return (
      <span className="text3" style={{ fontSize: 11 }}>
        —
      </span>
    );
  }
  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{flags}</div>;
}

/** Legacy colours the progress bar by overall STATUS, not by percentage
 *  (L9122 / L9148): Delayed → red, Completed → green, everything else cyan. */
function barColor(status: SoOverallStatus): string {
  return status === 'delayed'
    ? 'var(--red)'
    : status === 'completed'
      ? 'var(--green)'
      : 'var(--cyan)';
}

/** The same status colours as text — the "2" variants, which hold contrast. */
function barTextColor(status: SoOverallStatus): string {
  return status === 'delayed'
    ? 'var(--red2)'
    : status === 'completed'
      ? 'var(--green2)'
      : 'var(--cyan)';
}

function ProgBar({ pct, status }: { pct: number; status: SoOverallStatus }): React.JSX.Element {
  return (
    <div className="prog-wrap" style={{ flex: 1 }}>
      <div className="prog-bar" style={{ width: `${pct}%`, background: barColor(status) }} />
    </div>
  );
}
