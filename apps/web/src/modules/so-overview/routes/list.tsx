// SO Overview list (PL-2 + PL-2b parity port). Mirrors legacy renderSOOverview
// L9112 — list mode shows one row per open SO with overall status badge +
// progress + alert flags; PL-2b adds status pill filter, Equipment column,
// and in-screen drill (legacy _soOvShowSODetail L9146) replacing the row
// with a per-item view that has its own Back button.

import type {
  SoOverallStatus,
  SoOverviewChildRow,
  SoOverviewDetailResponse,
  SoOverviewItemStage,
  SoOverviewResponse,
  SoOverviewRow,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Activity, ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoOverview, useSoOverviewDetail } from '../api';

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

const STAGE_BADGE: Record<SoOverviewItemStage, { cls: string; label: string; icon: string }> = {
  not_released: { cls: 'b-grey', label: 'Not Released', icon: '○' },
  in_production: { cls: 'b-cyan', label: 'In Production', icon: '⚙' },
  outsourced: { cls: 'b-blue', label: 'Outsourced', icon: '🏭' },
  quality_check: { cls: 'b-amber', label: 'Quality Check', icon: '🔬' },
  finished: { cls: 'b-green', label: 'Finished', icon: '✅' },
  hold: { cls: 'b-red', label: 'Hold / Blocked', icon: '🚫' },
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
  const [drillSoId, setDrillSoId] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useSoOverview({
    search,
    status,
  });

  if (drillSoId) {
    return (
      <SoOverviewDrill
        soId={drillSoId}
        onBack={() => setDrillSoId(null)}
      />
    );
  }

  const filteredRows =
    overallFilter === 'all'
      ? (data?.rows ?? [])
      : (data?.rows ?? []).filter((r) => r.overallStatus === overallFilter);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📋 SO Overview</div>
        <div className="flex items-center gap-2">
          <input
            className="innovic-input"
            style={{ width: 280 }}
            // Legacy placeholder promises "SO, client, equipment, item" search,
            // but our server (so-overview/service.ts L100-104) only ILIKEs
            // code / customerName / clientPoNo. Placeholder states what actually
            // works rather than repeating legacy's wider claim.
            placeholder="🔍 Search SO# / customer / PO…"
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
          <OverallStatusPills
            rows={data.rows}
            value={overallFilter}
            onChange={setOverallFilter}
          />
          <OverviewTable rows={filteredRows} onRowClick={setDrillSoId} />
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
      <span
        className="text3"
        style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em' }}
      >
        FILTER:
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
            className="btn btn-sm"
            style={{
              fontSize: 10,
              padding: '3px 10px',
              borderRadius: 12,
              background: active ? 'var(--cyan)' : 'var(--bg4)',
              color: active ? '#fff' : 'var(--text2)',
              border: `1px solid ${active ? 'var(--cyan)' : 'var(--border)'}`,
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

function SummaryStrip({ summary }: { summary: SoOverviewResponse['summary'] }): React.JSX.Element {
  // Legacy stat strip (L9139) uses .stat-grid / .stat-card <variant> /
  // .stat-label / .stat-val. Legacy shows 4 tiles (TOTAL SOs, COMPLETED,
  // DELAYED, IN PROGRESS); we keep all 7 server-provided counts — every one is
  // a real field on summary, so none is browser-derived. Tile order follows
  // legacy's own canonical status order (L9118) so it lines up with the filter
  // pills below. Only the four real variants (cyan/amber/green/red) are used.
  const tiles: Array<{ label: string; val: number; variant?: string; color?: string }> = [
    { label: 'TOTAL SOs', val: summary.soCount, variant: 'cyan' },
    { label: 'NOT STARTED', val: summary.notStartedCount, color: 'var(--text3)' },
    { label: 'IN PROGRESS', val: summary.inProgressCount, variant: 'amber', color: 'var(--amber)' },
    { label: 'ON TRACK', val: summary.onTrackCount, variant: 'green', color: 'var(--green)' },
    { label: 'DELAYED', val: summary.delayedCount, variant: 'red', color: 'var(--red)' },
    { label: 'COMPLETED', val: summary.completedCount, variant: 'green', color: 'var(--green)' },
    { label: 'BLOCKED', val: summary.blockedCount, variant: 'red', color: 'var(--red)' },
  ];
  return (
    <div className="stat-grid">
      {tiles.map((t) => (
        <div key={t.label} className={t.variant ? `stat-card ${t.variant}` : 'stat-card'}>
          <div className="stat-label">{t.label}</div>
          <div className="stat-val" style={t.color ? { color: t.color } : undefined}>
            {t.val}
          </div>
        </div>
      ))}
    </div>
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
          <table className="innovic-table">
            <thead>
              <tr>
                <th>SO No.</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Equipment</th>
                <th>Lines</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Required</th>
                <th style={{ color: 'var(--green)' }}>Done</th>
                <th style={{ color: 'var(--red)' }}>Balance</th>
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
      <div className="text3" style={{ fontSize: 11, marginTop: 6, padding: '0 4px' }}>
        💡 Click any SO row to see BOM item breakdown / SO line detail with Stage &amp; Status
        per item.
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
            PO {row.clientPoNo}
          </div>
        ) : null}
      </td>
      <td className="fw-700">{row.customerName ?? '—'}</td>
      <td style={{ fontSize: 11 }}>
        {row.type === 'equipment'
          ? '⚙ Equipment'
          : row.type === 'with_material'
            ? '📦 With Material'
            : '📋 Component'}
      </td>
      <td style={{ color: 'var(--purple)', fontSize: 12 }}>
        {row.equipmentItemName ?? '—'}
      </td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--purple)' }}>
        {row.lineCount}
      </td>
      <td>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </td>
      <td style={{ width: 130 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ProgBar pct={row.overallPct} status={row.overallStatus} />
          <span className="mono fw-700" style={{ fontSize: 11, color: barColor(row.overallStatus) }}>
            {row.overallPct}%
          </span>
        </div>
      </td>
      <td className="td-ctr mono fw-700">{row.totalRequiredQty}</td>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
        {row.totalDoneQty}
      </td>
      <td
        className="td-ctr mono fw-700"
        style={{ color: row.totalBalanceQty > 0 ? 'var(--red)' : 'var(--green)' }}
      >
        {row.totalBalanceQty}
      </td>
      <td style={{ fontSize: 11, fontWeight: 700, color: overdue ? 'var(--red)' : 'var(--text)' }}>
        {row.earliestDueDate ?? '—'}
      </td>
      <td className="td-ctr">
        <AlertFlags row={row} />
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {row.soDate}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
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
        style={{ color: 'var(--red)', fontWeight: 700, fontSize: 11 }}
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
      <span key="qcpend" style={{ color: 'var(--amber)', fontSize: 11 }} title="Ops awaiting QC">
        🔬{row.alerts.qcPendingOps}
      </span>,
    );
  }
  if (row.stageCounts.hold > 0) {
    flags.push(
      <span key="hold" style={{ color: 'var(--red)', fontSize: 11 }} title="Lines on hold">
        🚫{row.stageCounts.hold}
      </span>,
    );
  }
  if (flags.length === 0) {
    return (
      <span className="text3" style={{ fontSize: 10 }}>
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

function ProgBar({ pct, status }: { pct: number; status: SoOverallStatus }): React.JSX.Element {
  return (
    <div className="prog-wrap" style={{ flex: 1 }}>
      <div className="prog-bar" style={{ width: `${pct}%`, background: barColor(status) }} />
    </div>
  );
}

// ─── PL-2b drill view (legacy _soOvShowSODetail L9146) ────────────────────

function SoOverviewDrill({
  soId,
  onBack,
}: {
  soId: string;
  onBack: () => void;
}): React.JSX.Element {
  const { data, isLoading, isError, error } = useSoOverviewDetail(soId);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} /> Back to SO Overview
        </button>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <Loader2 className="inline animate-spin" size={14} /> Loading SO detail…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load SO detail'}
            </div>
          </div>
        </div>
      ) : (
        <DrillBody data={data} />
      )}
    </div>
  );
}

function DrillBody({ data }: { data: SoOverviewDetailResponse }): React.JSX.Element {
  const { so, isEquipmentDrill, bomNo, bomRev, childRows } = data;
  const today = new Date().toISOString().slice(0, 10);
  const overdue =
    so.earliestDueDate !== null &&
    so.earliestDueDate < today &&
    so.overallStatus !== 'completed';

  // Stage + status chip counts.
  const stageCounts: Record<SoOverviewItemStage, number> = {
    not_released: 0,
    in_production: 0,
    outsourced: 0,
    quality_check: 0,
    finished: 0,
    hold: 0,
  };
  const statusCounts: Record<SoOverallStatus, number> = {
    not_started: 0,
    in_progress: 0,
    on_track: 0,
    delayed: 0,
    completed: 0,
    blocked: 0,
  };
  for (const r of childRows) {
    stageCounts[r.stage] += 1;
    statusCounts[r.status] += 1;
  }

  return (
    <>
      {/* Header card */}
      <div
        style={{
          display: 'flex',
          gap: 18,
          flexWrap: 'wrap',
          marginBottom: 16,
          padding: 14,
          background: 'var(--bg3)',
          borderRadius: 8,
          border: '1px solid var(--border)',
        }}
      >
        <div>
          <span className="text3" style={{ fontSize: 10 }}>
            SO NUMBER
          </span>
          <br />
          <b style={{ color: 'var(--cyan)', fontSize: 18 }}>{so.code}</b>
        </div>
        <div>
          <span className="text3" style={{ fontSize: 10 }}>
            CUSTOMER
          </span>
          <br />
          <b style={{ fontSize: 14 }}>{so.customerName ?? '—'}</b>
          {so.clientPoNo ? (
            <div className="text3" style={{ fontSize: 11 }}>
              PO: {so.clientPoNo}
            </div>
          ) : null}
        </div>
        <div>
          <span className="text3" style={{ fontSize: 10 }}>
            TYPE
          </span>
          <br />
          <b>
            {so.type === 'equipment'
              ? '⚙ Equipment'
              : so.type === 'with_material'
                ? '📦 With Material'
                : '📋 Component'}
          </b>
        </div>
        {so.type === 'equipment' && so.equipmentItemName ? (
          <div>
            <span className="text3" style={{ fontSize: 10 }}>
              EQUIPMENT
            </span>
            <br />
            <b style={{ color: 'var(--purple)' }}>{so.equipmentItemName}</b>
          </div>
        ) : null}
        {bomNo ? (
          <div>
            <span className="text3" style={{ fontSize: 10 }}>
              BOM
            </span>
            <br />
            <b style={{ color: 'var(--green)' }}>
              {bomNo}
              {bomRev !== null ? ` Rev ${bomRev}` : ''}
            </b>
          </div>
        ) : null}
        <div>
          <span className="text3" style={{ fontSize: 10 }}>
            DUE DATE
          </span>
          <br />
          <b style={{ color: overdue ? 'var(--red)' : 'var(--text)' }}>
            {so.earliestDueDate ?? '—'}
          </b>
        </div>
        <div>
          <span className="text3" style={{ fontSize: 10 }}>
            STATUS
          </span>
          <br />
          <span className={`badge ${STATUS_BADGE[so.overallStatus].cls}`}>
            {STATUS_BADGE[so.overallStatus].label}
          </span>
        </div>
      </div>

      {/* Overall progress */}
      <div
        style={{
          marginBottom: 16,
          padding: '10px 14px',
          background: 'var(--bg)',
          borderRadius: 8,
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="text3" style={{ fontSize: 11 }}>
            Overall Progress
          </span>
          <span className="mono fw-700" style={{ color: barColor(so.overallStatus) }}>
            {so.overallPct}%
          </span>
        </div>
        <div
          style={{
            height: 10,
            background: 'var(--bg5)',
            borderRadius: 5,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${so.overallPct}%`,
              height: '100%',
              background: barColor(so.overallStatus),
              borderRadius: 5,
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 12 }}>
          <span>
            Required: <b>{so.totalRequiredQty}</b>
          </span>
          <span>
            Completed:{' '}
            <b style={{ color: 'var(--green)' }}>{so.totalDoneQty}</b>
          </span>
          <span>
            Balance:{' '}
            <b style={{ color: so.totalBalanceQty > 0 ? 'var(--red)' : 'var(--green)' }}>
              {so.totalBalanceQty}
            </b>
          </span>
          <span>
            Items: <b style={{ color: 'var(--purple)' }}>{childRows.length}</b>
          </span>
          {so.alerts.delayedLines > 0 ? (
            <span style={{ color: 'var(--red)' }}>
              ⚠ {so.alerts.delayedLines} delayed
            </span>
          ) : null}
        </div>
      </div>

      {/* Stage + Status chip strip */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 10,
          alignItems: 'center',
          padding: '8px 12px',
          background: 'var(--bg4)',
          borderRadius: 8,
          border: '1px solid var(--border)',
        }}
      >
        <span className="text3" style={{ fontSize: 10, fontWeight: 700 }}>
          STAGE:
        </span>
        {(Object.keys(stageCounts) as SoOverviewItemStage[]).map((k) => {
          const c = stageCounts[k];
          if (c === 0) return null;
          const meta = STAGE_BADGE[k];
          return (
            <span key={k} style={{ fontSize: 11 }}>
              <span className={`badge ${meta.cls}`}>
                {meta.icon} {meta.label}
              </span>{' '}
              <b>{c}</b>
            </span>
          );
        })}
        <span
          className="text3"
          style={{ fontSize: 10, fontWeight: 700, marginLeft: 6 }}
        >
          STATUS:
        </span>
        {(Object.keys(statusCounts) as SoOverallStatus[]).map((k) => {
          const c = statusCounts[k];
          if (c === 0) return null;
          const meta = STATUS_BADGE[k];
          return (
            <span key={k} style={{ fontSize: 11, marginRight: 4 }}>
              <span className={`badge ${meta.cls}`}>{meta.label}</span> <b>{c}</b>
            </span>
          );
        })}
      </div>

      {/* Items table */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--cyan)',
            fontFamily: 'var(--mono)',
            letterSpacing: '.04em',
          }}
        >
          {isEquipmentDrill
            ? `📦 BOM Items — ${bomNo ?? ''}`
            : '📋 SO Line Items'}{' '}
          ({childRows.length})
        </div>
      </div>
      <DrillItemsTable isEquipment={isEquipmentDrill} rows={childRows} />
    </>
  );
}

function DrillItemsTable({
  isEquipment,
  rows,
}: {
  isEquipment: boolean;
  rows: SoOverviewChildRow[];
}): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state">No items to display.</div>
        </div>
      </div>
    );
  }
  return (
    <div
      className="tbl-wrap"
      style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}
    >
      <table className="innovic-table">
        <thead>
          <tr>
            {!isEquipment ? <th>Ln</th> : null}
            {!isEquipment ? <th style={{ color: 'var(--purple)' }}>CPO Ln</th> : null}
            <th>Item Code</th>
            <th>Item Name</th>
            <th>Stage</th>
            <th>Status</th>
            <th>Required</th>
            <th style={{ color: 'var(--amber)' }}>Issued</th>
            <th style={{ color: 'var(--cyan)' }}>In Prod</th>
            <th style={{ color: 'var(--amber)' }}>QC Pend</th>
            <th style={{ color: 'var(--purple)' }}>At Vendor</th>
            <th style={{ color: 'var(--green)' }}>Done</th>
            <th style={{ color: 'var(--red)' }}>Balance</th>
            <th>Current Op</th>
            <th>Machine / Vendor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rowBg =
              r.status === 'delayed'
                ? 'rgba(239,68,68,0.04)'
                : r.status === 'completed'
                  ? 'rgba(34,197,94,0.04)'
                  : undefined;
            const stage = STAGE_BADGE[r.stage];
            const status = STATUS_BADGE[r.status];
            return (
              <tr key={r.rowId} style={{ background: rowBg }}>
                {!isEquipment ? (
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                    {r.lineNo ?? '—'}
                  </td>
                ) : null}
                {!isEquipment ? (
                  <td
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}
                  >
                    {r.clientPoLineNo ?? '—'}
                  </td>
                ) : null}
                <td className="td-code" style={{ color: 'var(--purple)' }}>
                  {r.itemCode}
                </td>
                <td style={{ fontSize: 12 }}>{r.itemName}</td>
                <td>
                  <span className={`badge ${stage.cls}`}>
                    {stage.icon} {stage.label}
                  </span>
                </td>
                <td>
                  <span className={`badge ${status.cls}`}>{status.label}</span>
                </td>
                <td className="td-ctr mono fw-700">{r.requiredQty}</td>
                <td className="td-ctr mono" style={{ color: 'var(--amber)' }}>
                  {r.issuedQty}
                </td>
                <td className="td-ctr mono" style={{ color: 'var(--cyan)' }}>
                  {r.inProductionQty}
                </td>
                <td className="td-ctr mono" style={{ color: 'var(--amber)' }}>
                  {r.qcPendingQty}
                </td>
                <td className="td-ctr mono" style={{ color: 'var(--purple)' }}>
                  {r.atVendorQty}
                </td>
                <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                  {r.completedQty}
                </td>
                <td
                  className="td-ctr mono fw-700"
                  style={{ color: r.balanceQty > 0 ? 'var(--red)' : 'var(--green)' }}
                >
                  {r.balanceQty}
                </td>
                <td style={{ fontSize: 11, color: 'var(--cyan)' }}>
                  {r.currentOpName ?? '—'}
                </td>
                <td
                  style={{
                    fontSize: 11,
                    maxWidth: 120,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.vendorName && (r.atVendorQty > 0 || r.stage === 'outsourced') ? (
                    <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                      🏭 {r.vendorName}
                    </span>
                  ) : r.currentLocation === 'QC' ? (
                    <span style={{ color: 'var(--green)', fontWeight: 700 }}>🔬 QC</span>
                  ) : r.machineName ? (
                    <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>
                      ⚙ {r.machineName}
                    </span>
                  ) : r.vendorName ? (
                    <span style={{ color: 'var(--purple)' }}>🏭 {r.vendorName}</span>
                  ) : (
                    <span className="text3">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
