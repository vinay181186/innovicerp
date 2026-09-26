// SO Overview list (PL-2 + PL-2b parity port). Mirrors legacy renderSOOverview
// L9112 — list mode shows one row per open SO with overall status badge +
// progress + alert flags; PL-2b adds status pill filter and Equipment column.
// Clicking an SO row opens that SO's SO Status page
// (/sales-orders/$id/status, owner decision 2026-09-26) — the old in-memory
// drill view that replaced this list is gone, so Back / refresh now behave.

import type { SoOverallStatus, SoOverviewRow } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate, todayIst } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SearchInput } from '@/ui/forms';
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
  in_progress: { cls: 'b-amber', label: 'In Progress' },
  on_track: { cls: 'b-blue', label: 'On Track' },
  delayed: { cls: 'b-red', label: 'Delayed' },
  completed: { cls: 'b-green', label: 'Completed' },
  blocked: { cls: 'b-red', label: 'Blocked' },
};

/** Per-row status filter (different from header.status — this filters the
 *  *derived* overallStatus). Renders as a one-click pill row replacing the
 *  legacy dropdown. PL-2b §1.3. */
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">SO Overview</div>
        <div className="flex items-center gap-2">
          {/* Legacy placeholder promises "SO, client, equipment, item" search,
              but our server (so-overview/service.ts L100-104) only ILIKEs
              code / customerName / clientPoNo. Placeholder states what actually
              works rather than repeating legacy's wider claim. */}
          <SearchInput
            width={280}
            debounceMs={300}
            placeholder="Search SO No., customer, Client PO No.…"
            value={searchInput}
            onChange={setSearchInput}
          />
          <select
            className="innovic-select"
            style={{ width: 140 }}
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
        </div>
      </div>

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
          <OverallStatusPills rows={data.rows} value={overallFilter} onChange={setOverallFilter} />
          <OverviewTable
            rows={filteredRows}
            onRowClick={openSoStatus}
            filtered={
              !!search || (status !== undefined && status !== 'all') || overallFilter !== 'all'
            }
          />
        </>
      ) : null}
    </div>
  );
}

function OverallStatusPills({
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
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        margin: '0 0 14px',
        alignItems: 'center',
      }}
    >
      <span className="text3" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em' }}>
        Filter:
      </span>
      {OVERALL_STATUS_LABELS.map((opt) => {
        const active = value === opt.value;
        const count = counts[opt.value] ?? 0;
        // Skip non-"all" options when count is zero AND not active.
        if (opt.value !== 'all' && count === 0 && !active) return null;
        return (
          <button
            key={opt.value}
            type="button"
            className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 12,
            }}
            onClick={() => onChange(active && opt.value !== 'all' ? 'all' : opt.value)}
          >
            {opt.label} <b>{count}</b>
          </button>
        );
      })}
    </div>
  );
}

function OverviewTable({
  rows,
  onRowClick,
  filtered,
}: {
  rows: SoOverviewRow[];
  onRowClick: (soId: string) => void;
  filtered: boolean;
}): React.JSX.Element {
  return (
    <>
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>SO No.</th>
                <th>Customer</th>
                <th>SO Type</th>
                <th>Equipment</th>
                <th className="th-num">Lines</th>
                <th>Progress Status</th>
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
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="empty-state">
                    {filtered ? 'No SOs match.' : 'No SOs yet.'}
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
  const today = todayIst();
  const overdue =
    row.earliestDueDate !== null &&
    row.earliestDueDate < today &&
    row.overallStatus !== 'completed';
  return (
    <tr style={{ cursor: 'pointer' }} onClick={() => onRowClick(row.id)}>
      <td onClick={(e) => e.stopPropagation()}>
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
      <td style={{ width: 130 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ProgBar pct={row.overallPct} status={row.overallStatus} />
          <span
            className="mono fw-700"
            style={{ fontSize: 11, color: barColor(row.overallStatus) }}
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
        style={{ color: row.totalBalanceQty > 0 ? 'var(--red)' : 'var(--green)' }}
      >
        {row.totalBalanceQty}
      </td>
      <td style={{ fontSize: 11, fontWeight: 700, color: overdue ? 'var(--red)' : 'var(--text)' }}>
        {fmtDate(row.earliestDueDate)}
      </td>
      <td>
        <AlertFlags row={row} />
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {fmtDate(row.soDate)}
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
      <span key="hold" style={{ color: 'var(--red2)', fontSize: 11 }} title="Blocked lines">
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
 *  (L9122 / L9148): Delayed → red, Completed → green, everything else amber. */
function barColor(status: SoOverallStatus): string {
  return status === 'delayed'
    ? 'var(--red)'
    : status === 'completed'
      ? 'var(--green)'
      : status === 'on_track'
        ? 'var(--blue)'
        : 'var(--amber)';
}

function ProgBar({ pct, status }: { pct: number; status: SoOverallStatus }): React.JSX.Element {
  return (
    <div className="prog-wrap" style={{ flex: 1 }}>
      <div className="prog-bar" style={{ width: `${pct}%`, background: barColor(status) }} />
    </div>
  );
}
