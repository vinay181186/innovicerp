// Planning Dashboard (PL-3 + PL-3b). Mirrors legacy renderPlanDashboard L9994.
// PL-3b parity additions (see docs/PARITY/plandash.md §1–4):
//   - Tile-as-filter loop: clicking a KPI tile filters the table, click again
//     to clear. Active tile highlighted with a coloured outline.
//   - Per-table search box (Plan #, SO, item code/name).
//   - Start / End date columns.
//   - Action column: status-driven Edit / ⚡ Execute / View per row.
//
// Still deferred (separate BLOCKER, needs new endpoint):
//   - "Needs Planning" mode + table (legacy L10024–10041). Awaiting
//     GET /planning-dashboard/unplanned wiring.

import type { Plan, PlanStatus, PlanType, UnplannedOrderRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Pencil, Zap, Eye } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useExecutePlan, usePlanningDashboard, useUnplannedOrders } from '../api';

export const planningDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'planning-dashboard',
  component: PlanningDashboardPage,
});

type FilterKey =
  | 'all'
  | 'needsPlanning'
  | 'inPlanning'
  | 'planned'
  | 'jcCreated'
  | 'prCreated'
  | 'inProduction'
  | 'complete';

const STATUS_BADGE: Record<PlanStatus, { cls: string; label: string }> = {
  in_planning: { cls: 'b-amber', label: 'In Planning' },
  planned: { cls: 'b-blue', label: 'Planned' },
  jc_created: { cls: 'b-cyan', label: 'JC Created' },
  pr_created: { cls: 'b-cyan', label: 'PR Created' },
  in_production: { cls: 'b-cyan', label: 'In Production' },
  complete: { cls: 'b-green', label: 'Complete' },
  cancelled: { cls: 'b-grey', label: 'Cancelled' },
};

// Legacy renderPlanDashboard L10049–10051 shows three short tags: 🛒 Buy /
// 🛠 Asm / 🏭 Mfg. Legacy only branches on direct_purchase + assembly; every
// other type (incl. full_outsource) falls through to the 🏭 Mfg tag.
const TYPE_LABEL: Record<PlanType, { icon: string; label: string }> = {
  manufacture: { icon: '🏭', label: 'Mfg' },
  direct_purchase: { icon: '🛒', label: 'Buy' },
  full_outsource: { icon: '🏭', label: 'Mfg' },
  assembly: { icon: '🛠', label: 'Asm' },
};

// Tile order matches legacy L10014–10020. Filter key matches the KPI shape.
const TILES: Array<{ key: FilterKey; label: string; color: string; kpiKey?: string }> = [
  { key: 'needsPlanning', label: 'Needs Planning', color: 'var(--red)', kpiKey: 'needsPlanning' },
  { key: 'inPlanning', label: 'In Planning', color: 'var(--amber)', kpiKey: 'inPlanning' },
  { key: 'planned', label: 'Planned (Ready)', color: 'var(--blue)', kpiKey: 'planned' },
  { key: 'jcCreated', label: 'JC Created', color: 'var(--cyan)', kpiKey: 'jcCreated' },
  { key: 'prCreated', label: 'PR Created (Buy)', color: '#8b5cf6', kpiKey: 'prCreated' },
  { key: 'inProduction', label: 'In Production', color: 'var(--cyan)', kpiKey: 'inProduction' },
  { key: 'complete', label: 'Complete', color: 'var(--green)', kpiKey: 'complete' },
];

// Filter key → PlanStatus enum match. 'all' returns every plan.
// 'needsPlanning' is a separate mode that switches the body to the
// unplanned-SO-line table (NeedsPlanningTable below) — no plan-status filter.
const FILTER_TO_STATUS: Record<FilterKey, PlanStatus | null> = {
  all: null,
  needsPlanning: null,
  inPlanning: 'in_planning',
  planned: 'planned',
  jcCreated: 'jc_created',
  prCreated: 'pr_created',
  inProduction: 'in_production',
  complete: 'complete',
};

function PlanningDashboardPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = usePlanningDashboard();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState<string>('');

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📊 Planning Dashboard</div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading dashboard…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load planning dashboard'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <KpiStrip kpi={data.kpi} filter={filter} setFilter={setFilter} />
          {filter === 'needsPlanning' ? (
            <NeedsPlanningTable search={search} setSearch={setSearch} />
          ) : (
            <RecentPlansTable
              rows={data.recentPlans}
              filter={filter}
              search={search}
              setSearch={setSearch}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

// PL-3b — Needs Planning body. Shown only when the Needs Planning tile is
// active. Mirrors legacy renderPlanDashboard L10024–10041.
function NeedsPlanningTable({
  search,
  setSearch,
}: {
  search: string;
  setSearch: (v: string) => void;
}): React.JSX.Element {
  const { data, isLoading, isError, error } = useUnplannedOrders(true);

  const filtered = useMemo(() => {
    if (!data) return [] as UnplannedOrderRow[];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) =>
      `${r.soCode} ${r.itemCode ?? ''} ${r.partName ?? ''} ${r.customerName ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [data, search]);

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title" style={{ color: 'var(--red)' }}>
          ⚠ Needs Planning ({filtered.length}
          {data && filtered.length !== data.rows.length ? <> of {data.rows.length}</> : null}{' '}
          SO lines)
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search SO, item, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220, fontSize: 12 }}
          />
        </div>
      </div>
      {isLoading ? (
        <div className="panel-body">
          <div className="text3" style={{ fontSize: 12 }}>
            <Loader2 size={14} className="inline animate-spin" /> Loading unplanned orders…
          </div>
        </div>
      ) : isError ? (
        <div className="panel-body">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load unplanned orders'}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            {data && data.rows.length === 0
              ? 'All SO lines are fully planned!'
              : 'No SO lines match your search.'}
          </div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>SO/JW</th>
                <th className="td-ctr">Line</th>
                <th>Item</th>
                <th>Part Name</th>
                <th className="td-ctr">SO Qty</th>
                <th className="td-ctr">Planned</th>
                <th className="td-ctr" style={{ color: 'var(--red)' }}>
                  Remaining
                </th>
                <th>Due Date</th>
                <th>Customer</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.soLineId}>
                  <td>
                    <Link
                      to="/sales-orders/$id"
                      params={{ id: r.soId }}
                      className="td-code"
                      style={{ color: 'var(--cyan)', fontWeight: 600 }}
                    >
                      {r.soCode}
                    </Link>
                  </td>
                  <td className="td-ctr">{r.lineNo}</td>
                  <td>
                    <span style={{ color: 'var(--purple)', fontWeight: 600 }}>
                      {r.itemCode ?? '—'}
                    </span>
                  </td>
                  <td>{r.partName ?? '—'}</td>
                  <td className="td-ctr" style={{ fontWeight: 700 }}>
                    {r.orderQty}
                  </td>
                  <td className="td-ctr" style={{ color: 'var(--cyan)' }}>
                    {r.plannedQty > 0 ? r.plannedQty : '—'}
                  </td>
                  <td className="td-ctr" style={{ color: 'var(--red)', fontWeight: 700 }}>
                    {r.remainingQty}
                  </td>
                  <td style={{ fontSize: 12 }}>{r.dueDate ?? '—'}</td>
                  <td>{r.customerName ?? '—'}</td>
                  <td>
                    <Link
                      to="/planning"
                      className="btn btn-sm"
                      style={{
                        background: 'var(--cyan)',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 11,
                      }}
                    >
                      📋 Plan {r.remainingQty} pcs
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KpiStrip({
  kpi,
  filter,
  setFilter,
}: {
  kpi: { [k: string]: number };
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10,
        marginBottom: 16,
      }}
    >
      {TILES.map((t) => {
        const val = t.kpiKey ? kpi[t.kpiKey] ?? 0 : 0;
        const active = filter === t.key;
        return (
          <div
            key={t.key}
            onClick={() => setFilter(filter === t.key ? 'all' : t.key)}
            style={{
              cursor: 'pointer',
              border: '1px solid var(--border)',
              borderTop: `3px solid ${t.color}`,
              borderRadius: 6,
              padding: '8px 10px',
              background: 'var(--bg2)',
              boxShadow: active ? `0 0 0 2px ${t.color}` : undefined,
              transition: 'box-shadow .15s',
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
                fontSize: 22,
                fontWeight: 700,
                color: t.color,
                marginTop: 2,
              }}
            >
              {val}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface RecentPlanRow extends Plan {
  itemCode: string | null;
  itemName: string | null;
  opsCount: number;
}

function RecentPlansTable({
  rows,
  filter,
  search,
  setSearch,
}: {
  rows: RecentPlanRow[];
  filter: FilterKey;
  search: string;
  setSearch: (v: string) => void;
}): React.JSX.Element {
  const filtered = useMemo(() => {
    const statusFilter = FILTER_TO_STATUS[filter];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.planStatus !== statusFilter) return false;
      if (q) {
        const hay = `${r.code} ${r.soCodeText ?? ''} ${r.itemCode ?? r.itemCodeText ?? ''} ${r.itemName ?? r.itemNameText ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">
          Recent plans ({filtered.length}
          {filtered.length !== rows.length ? <> of {rows.length}</> : null})
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="Search plans..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220, fontSize: 12 }}
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            {rows.length === 0
              ? 'No plans yet. Plans are created from the SO/JW Planning workflow (PL-4).'
              : 'No plans match your filter.'}
          </div>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Plan No.</th>
                <th>Date</th>
                <th>Type</th>
                <th>SO/JW</th>
                <th className="td-ctr">Line</th>
                <th>Item</th>
                <th className="td-ctr">Qty</th>
                <th className="td-ctr">Ops</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <PlanRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlanRow({ row }: { row: RecentPlanRow }): React.JSX.Element {
  const status = STATUS_BADGE[row.planStatus];
  const typeMeta = TYPE_LABEL[row.planType];
  return (
    <tr>
      <td>
        <Link
          to="/plans/$id"
          params={{ id: row.id }}
          className="td-code"
          style={{ color: 'var(--cyan)', fontWeight: 600 }}
        >
          {row.code}
        </Link>
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {row.planDate}
        </span>
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {typeMeta.icon} {typeMeta.label}
        </span>
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {row.soCodeText ?? '—'}
        </span>
      </td>
      <td className="td-ctr">{row.lineNo ?? '—'}</td>
      <td>
        <div>{row.itemCode ?? row.itemCodeText ?? '—'}</div>
        {row.itemName ?? row.itemNameText ? (
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            {row.itemName ?? row.itemNameText}
          </div>
        ) : null}
      </td>
      <td className="td-ctr fw-700">
        {row.planQty}
        <span className="text3"> /{row.orderQty}</span>
      </td>
      <td className="td-ctr">{row.opsCount}</td>
      <td>
        <span className="text3" style={{ fontSize: 11 }}>
          {row.plannedStartDate ?? '—'}
        </span>
      </td>
      <td>
        <span className="text3" style={{ fontSize: 11 }}>
          {row.plannedEndDate ?? '—'}
        </span>
      </td>
      <td>
        <span className={`badge ${status.cls}`}>{status.label}</span>
      </td>
      <td>
        <PlanActions row={row} />
      </td>
    </tr>
  );
}

function PlanActions({ row }: { row: RecentPlanRow }): React.JSX.Element {
  const executeMut = useExecutePlan();
  const [actionError, setActionError] = useState<string | null>(null);

  // Status-driven action choice mirrors legacy L10055–10057:
  //   In Planning → Edit pencil (navigate to edit)
  //   Planned     → ⚡ Execute (inline mutation)
  //   else        → View ghost (navigate to detail)
  if (row.planStatus === 'in_planning') {
    return (
      <Link
        to="/plans/$id/edit"
        params={{ id: row.id }}
        className="btn btn-sm btn-ghost"
        title="Edit plan"
      >
        <Pencil size={12} />
      </Link>
    );
  }
  if (row.planStatus === 'planned') {
    const onExecute = (): void => {
      setActionError(null);
      executeMut.mutate(row.id, {
        onError: (err) =>
          setActionError(err instanceof Error ? err.message : 'Failed to execute plan'),
      });
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onExecute}
          disabled={executeMut.isPending}
          style={{
            background: 'var(--green)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
          }}
          title="Execute plan"
        >
          {executeMut.isPending ? (
            <>
              <Loader2 size={12} className="inline animate-spin" /> Executing…
            </>
          ) : (
            <>
              <Zap size={12} /> Execute
            </>
          )}
        </button>
        {actionError ? (
          <span style={{ color: 'var(--red)', fontSize: 10 }}>{actionError}</span>
        ) : null}
      </div>
    );
  }
  return (
    <Link
      to="/plans/$id"
      params={{ id: row.id }}
      className="btn btn-sm btn-ghost"
      title="View plan"
    >
      <Eye size={12} /> View
    </Link>
  );
}
