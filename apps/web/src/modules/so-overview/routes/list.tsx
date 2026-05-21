// SO Overview list (PL-2). Mirrors legacy renderSOOverview L9112 — one row
// per open SO with overall status badge, progress bar, stage counters, and
// alert flags. Row click navigates to PL-1's SO Status detail page.

import type {
  SoOverallStatus,
  SoOverviewResponse,
  SoOverviewRow,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Activity, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
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

function SoOverviewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status } = soOverviewListRoute.useSearch();
  const { data, isLoading, isError, error } = useSoOverview({
    search,
    status,
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📋 SO Overview</div>
        <div className="flex items-center gap-2">
          <input
            className="innovic-input"
            style={{ width: 220 }}
            placeholder="Search SO# / customer / PO…"
            value={search ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/so-overview',
                search: {
                  ...(status ? { status } : {}),
                  search: e.target.value || undefined,
                },
              })
            }
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
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load SO overview'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <SummaryStrip summary={data.summary} />
          <OverviewTable rows={data.rows} />
        </>
      ) : null}
    </div>
  );
}

function SummaryStrip({ summary }: { summary: SoOverviewResponse['summary'] }): React.JSX.Element {
  const tiles: Array<{ label: string; val: number; color?: string }> = [
    { label: 'Total', val: summary.soCount, color: 'var(--text)' },
    { label: 'Not Started', val: summary.notStartedCount, color: 'var(--text3)' },
    { label: 'In Progress', val: summary.inProgressCount, color: 'var(--cyan)' },
    { label: 'On Track', val: summary.onTrackCount, color: 'var(--green2)' },
    { label: 'Delayed', val: summary.delayedCount, color: 'var(--red2)' },
    { label: 'Completed', val: summary.completedCount, color: 'var(--green2)' },
    { label: 'Blocked', val: summary.blockedCount, color: 'var(--red2)' },
  ];
  return (
    <div
      className="panel"
      style={{ marginBottom: 12 }}
    >
      <div
        className="panel-body"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 10,
        }}
      >
        {tiles.map((t) => (
          <div
            key={t.label}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 10px',
              background: 'var(--bg2)',
            }}
          >
            <div
              className="text3"
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {t.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 18,
                fontWeight: 700,
                color: t.color,
                marginTop: 2,
              }}
            >
              {t.val}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewTable({ rows }: { rows: SoOverviewRow[] }): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            No sales orders match the filter.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>SO #</th>
              <th>Customer</th>
              <th>Type</th>
              <th className="td-ctr">Lines</th>
              <th>Status</th>
              <th style={{ minWidth: 140 }}>Progress</th>
              <th className="td-right">Required</th>
              <th className="td-right">Done</th>
              <th className="td-right">Balance</th>
              <th>Due</th>
              <th>Alerts</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row }: { row: SoOverviewRow }): React.JSX.Element {
  const badge = STATUS_BADGE[row.overallStatus];
  const today = new Date().toISOString().slice(0, 10);
  const overdue =
    row.earliestDueDate !== null &&
    row.earliestDueDate < today &&
    row.overallStatus !== 'completed';
  return (
    <tr>
      <td>
        <Link
          to="/sales-orders/$id"
          params={{ id: row.id }}
          className="td-code"
          style={{ color: 'var(--cyan)', fontWeight: 600 }}
        >
          {row.code}
        </Link>
        {row.clientPoNo ? (
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            PO {row.clientPoNo}
          </div>
        ) : null}
      </td>
      <td>{row.customerName ?? '—'}</td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {row.type === 'equipment'
            ? '🔧 Equipment'
            : row.type === 'with_material'
              ? '📦 With Material'
              : '📋 Component'}
        </span>
      </td>
      <td className="td-ctr">{row.lineCount}</td>
      <td>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </td>
      <td style={{ minWidth: 140 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--mono)',
            fontSize: 11,
          }}
        >
          <ProgBar pct={row.overallPct} />
          <span style={{ color: 'var(--text3)' }}>{row.overallPct}%</span>
        </div>
      </td>
      <td className="td-right">{row.totalRequiredQty}</td>
      <td className="td-right" style={{ color: 'var(--green2)' }}>
        {row.totalDoneQty}
      </td>
      <td
        className="td-right"
        style={{ color: row.totalBalanceQty > 0 ? 'var(--red2)' : 'var(--text3)' }}
      >
        {row.totalBalanceQty}
      </td>
      <td>
        <span style={{ color: overdue ? 'var(--red2)' : 'var(--text3)', fontSize: 12 }}>
          {row.earliestDueDate ?? '—'}
        </span>
      </td>
      <td>
        <AlertFlags row={row} />
      </td>
      <td>
        <Link
          to="/sales-orders/$id/status"
          params={{ id: row.id }}
          className="btn btn-ghost btn-sm"
          title="Open SO Status drill-down"
        >
          <Activity size={13} />
        </Link>
      </td>
    </tr>
  );
}

function AlertFlags({ row }: { row: SoOverviewRow }): React.JSX.Element {
  const flags: React.ReactNode[] = [];
  if (row.alerts.delayedLines > 0) {
    flags.push(
      <span key="delayed" className="badge b-red" title="Lines past due">
        ⚠️ {row.alerts.delayedLines}
      </span>,
    );
  }
  if (row.alerts.atVendorQty > 0) {
    flags.push(
      <span key="atvendor" className="badge b-blue" title="Qty at outsource vendor">
        🏭 {row.alerts.atVendorQty}
      </span>,
    );
  }
  if (row.alerts.qcPendingOps > 0) {
    flags.push(
      <span key="qcpend" className="badge b-amber" title="Ops awaiting QC">
        🔍 {row.alerts.qcPendingOps}
      </span>,
    );
  }
  if (row.stageCounts.hold > 0) {
    flags.push(
      <span key="hold" className="badge b-red" title="Lines on hold">
        🚫 {row.stageCounts.hold}
      </span>,
    );
  }
  if (flags.length === 0) {
    return (
      <span className="text3" style={{ fontSize: 12 }}>
        —
      </span>
    );
  }
  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{flags}</div>;
}

function ProgBar({ pct }: { pct: number }): React.JSX.Element {
  const color =
    pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--blue)' : pct > 0 ? 'var(--amber)' : 'var(--bg4)';
  return (
    <div className="prog-wrap" style={{ width: 70, height: 5 }}>
      <div className="prog-bar" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
    </div>
  );
}
