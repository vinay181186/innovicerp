// Production Schedule (Gantt chart) — mirrors legacy renderProductionSchedule
// (HTML L15588). 30-day grid, one row per machine, drag-drop reschedule.

import { type ProductionScheduleBar, type ProductionScheduleFilter } from '@innovic/shared';
import { fmtOpSrNo, opSrNo } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader } from '@/ui/layout';
import { useProductionSchedule, useRescheduleJcOp } from '../api';

const COL_WIDTH = 48; // px per day
const ROW_HEIGHT = 48;

const FILTER_BTNS = [
  ['all', 'All Ops'],
  ['active', 'Active Only'],
  ['history', 'History'],
  ['future', 'Future'],
] as const satisfies ReadonlyArray<readonly [ProductionScheduleFilter, string]>;

// Bar colours — legacy _psBarColor (HTML L15570) + legend (L15662-15666), with
// legacy's hardcoded hex mapped to the nearest design token (legacy was a dark
// theme; this port is light). Legend and bars read from this one source so the
// two can't drift apart.
const BAR_PALETTE: Record<
  ProductionScheduleBar['colorKind'],
  { bg: string; border: string; fg: string }
> = {
  ok: { bg: 'var(--sig-ok-bg)', border: 'var(--sig-ok)', fg: 'var(--green2)' },
  tight: { bg: 'var(--sig-warn-bg)', border: 'var(--sig-warn)', fg: 'var(--amber2)' },
  at_risk: { bg: 'var(--sig-critical-bg)', border: 'var(--sig-critical)', fg: 'var(--red2)' },
  // Running = green everywhere (R5 PR-N8). Solid fill so it still reads apart
  // from the pale-green "On schedule" bars.
  running: { bg: 'var(--sig-ok)', border: 'var(--green2)', fg: '#fff' },
  done: { bg: 'var(--sig-neutral)', border: 'var(--sig-neutral)', fg: '#fff' },
};

// ISSUE-065: today's date in IST (not UTC, which reads as yesterday between
// 00:00 and 05:30 IST).
function todayIso(): string {
  return todayIst();
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  return Math.floor((db - da) / 86400000);
}

const searchSchema = z.object({
  startDate: z.string().optional(),
  filter: z.enum(['all', 'active', 'history', 'future']).optional(),
});

export const productionScheduleRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-schedule',
  validateSearch: (search) => searchSchema.parse(search),
  component: ProductionSchedulePage,
});

function ProductionSchedulePage(): React.JSX.Element {
  // Tier-driven, per department (Production). Dragging a bar reschedules / re-routes
  // a saved jc_op → jc_create edit (L3 Editor and up).
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;
  const search = productionScheduleRoute.useSearch();
  const navigate = productionScheduleRoute.useNavigate();
  const startDate = search.startDate ?? todayIso();
  const filter: ProductionScheduleFilter = search.filter ?? 'all';

  const { data, isLoading, isError, error } = useProductionSchedule({ startDate, filter });
  const rescheduleMut = useRescheduleJcOp();

  const days = useMemo(() => {
    const out: Array<{
      iso: string;
      dom: number;
      day: string;
      isWeekend: boolean;
      isToday: boolean;
    }> = [];
    const today = todayIso();
    for (let i = 0; i < 30; i++) {
      const iso = addDays(startDate, i);
      const d = new Date(iso + 'T00:00:00Z');
      const dow = d.getUTCDay();
      out.push({
        iso,
        dom: d.getUTCDate(),
        day: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dow]!,
        isWeekend: dow === 0 || dow === 6,
        isToday: iso === today,
      });
    }
    return out;
  }, [startDate]);

  const setStartDate = (next: string): void => {
    void navigate({ search: (prev) => ({ ...prev, startDate: next || undefined }) });
  };
  const navDate = (delta: number): void => setStartDate(addDays(startDate, delta));
  const setFilter = (f: ProductionScheduleFilter): void => {
    void navigate({ search: (prev) => ({ ...prev, filter: f === 'all' ? undefined : f }) });
  };

  const stats = data?.stats ?? {
    total: 0,
    onSchedule: 0,
    tight: 0,
    atRisk: 0,
    running: 0,
    unscheduled: 0,
  };

  const onDrop = (e: React.DragEvent, machineId: string, iso: string): void => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/jc-op-id');
    if (!id) return;
    rescheduleMut.mutate({ jcOpId: id, input: { machineId, plannedStart: iso } });
  };

  return (
    <div>
      {/* The one header band: title · op count … the window's date controls,
          with the Show filter underneath it. */}
      <ListHeader
        title="Production Schedule (Gantt)"
        icon="📅"
        count={isLoading ? undefined : stats.total}
        noun="op"
        filterNote={filter === 'all' ? undefined : FILTER_BTNS.find(([f]) => f === filter)?.[1]}
        tools={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navDate(-7)}>
              ◀ -7d
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navDate(-1)}>
              ◀
            </button>
            <input
              type="date"
              className="innovic-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="Window start date"
              style={{ fontSize: 11, padding: '4px 8px' }}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navDate(1)}>
              ▶
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navDate(7)}>
              +7d ▶
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setStartDate(todayIso())}
            >
              Today
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 4 }}>Show:</span>
          {FILTER_BTNS.map(([f, label]) => (
            <button
              key={f}
              type="button"
              className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              style={{ fontSize: 11, padding: '4px 10px' }}
              onClick={() => setFilter(f)}
            >
              {label}
            </button>
          ))}
        </div>
      </ListHeader>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          marginBottom: 10,
          fontSize: 11,
          flexWrap: 'wrap',
          padding: '6px 10px',
          background: 'var(--bg3)',
          borderRadius: 6,
        }}
      >
        <LegendDot kind="ok" label="On schedule" />
        <LegendDot kind="tight" label="Tight (≤ 2-day buffer)" />
        <LegendDot kind="at_risk" label="Will miss due date" />
        <LegendDot kind="running" label="Running" />
        <LegendDot kind="done" label="Completed" />
      </div>

      {/* Stats — one StatStrip (plain totals, not filters). */}
      <div style={{ marginBottom: 12 }}>
        <StatStrip
          items={[
            { key: 'total', label: 'Total Ops', count: stats.total },
            { key: 'ok', label: 'On Schedule', count: stats.onSchedule, color: 'var(--sig-ok)' },
            { key: 'tight', label: 'Tight', count: stats.tight, color: 'var(--sig-warn)' },
            { key: 'risk', label: 'At Risk', count: stats.atRisk, color: 'var(--sig-critical)' },
            { key: 'running', label: 'Running', count: stats.running, color: 'var(--sig-ok)' },
            {
              key: 'unscheduled',
              label: 'Unscheduled',
              count: stats.unscheduled,
              color: 'var(--text3)',
            },
          ]}
        />
      </div>

      {/* Gantt grid */}
      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error
                ? error.message
                : 'Could not load production schedule. Try again.'}
            </div>
          </div>
        </div>
      ) : !data || data.machines.length === 0 ? (
        <div className="panel empty-state">
          <div style={{ fontWeight: 700 }}>No operations match.</div>
        </div>
      ) : (
        <>
          <div className="panel" style={{ padding: 0, overflow: 'auto', maxHeight: 600 }}>
            <table
              style={{
                borderCollapse: 'collapse',
                width: '100%',
                fontSize: 11,
                minWidth: 220 + 30 * COL_WIDTH,
              }}
            >
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg2)' }}>
                <tr>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 11,
                      background: 'var(--bg2)',
                      border: '1px solid var(--border)',
                      padding: '6px 8px',
                      fontSize: 11,
                      fontWeight: 700,
                      textAlign: 'left',
                      width: 200,
                      minWidth: 200,
                    }}
                  >
                    Machine
                  </th>
                  {days.map((d) => {
                    const bg = d.isToday
                      ? 'var(--sig-info-bg)'
                      : d.isWeekend
                        ? 'var(--bg3)'
                        : 'var(--bg2)';
                    const col = d.isToday
                      ? 'var(--sig-info)'
                      : d.isWeekend
                        ? 'var(--text3)'
                        : 'var(--text)';
                    return (
                      <th
                        key={d.iso}
                        style={{
                          border: '1px solid var(--border)',
                          padding: '4px 2px',
                          fontSize: 11,
                          fontWeight: 600,
                          background: bg,
                          color: col,
                          width: COL_WIDTH,
                          minWidth: COL_WIDTH,
                        }}
                      >
                        <div>{d.day}</div>
                        <div style={{ fontSize: 11, fontWeight: 700 }}>{d.dom}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.machines.map((m) => (
                  <tr key={m.machineId}>
                    <td
                      style={{
                        position: 'sticky',
                        left: 0,
                        zIndex: 5,
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        padding: '6px 8px',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      <div>
                        {m.machineName ? `${m.machineCode} — ${m.machineName}` : m.machineCode}
                      </div>
                      {m.machineType ? (
                        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>
                          {m.machineType}
                        </div>
                      ) : null}
                    </td>
                    {days.map((d, dayIdx) => {
                      const startingHere = m.bars.filter((b) => b.plannedStart === d.iso);
                      const bg = d.isToday
                        ? 'var(--sig-info-bg)'
                        : d.isWeekend
                          ? 'var(--bg3)'
                          : 'transparent';
                      return (
                        <td
                          key={d.iso}
                          onDragOver={(e) => canWrite && e.preventDefault()}
                          onDrop={(e) => canWrite && onDrop(e, m.machineId, d.iso)}
                          style={{
                            border: '1px solid var(--border)',
                            padding: 2,
                            height: ROW_HEIGHT,
                            verticalAlign: 'top',
                            background: bg,
                            position: 'relative',
                          }}
                        >
                          {startingHere.map((b) => (
                            <Bar key={b.jcOpId} bar={b} colIdx={dayIdx} canWrite={canWrite} />
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Bar({
  bar,
  colIdx,
  canWrite,
}: {
  bar: ProductionScheduleBar;
  colIdx: number;
  canWrite: boolean;
}): React.JSX.Element {
  const spanDays = Math.min(
    Math.max(1, daysBetween(bar.plannedStart, bar.plannedEnd) + 1),
    30 - colIdx,
  );
  const widthPx = spanDays * COL_WIDTH - 4;
  const c = BAR_PALETTE[bar.colorKind];
  // A JC number says WHICH JOB, not which part, so the item has to appear beside
  // it -- but it cannot go ON the bar. The bar is a fixed 48px-per-day box with
  // two 9-10px lines that are already ellipsised, and a third line does not fit
  // at any width the grid allows. The hover tooltip is the only surface here
  // that can grow, so the item code and name go there instead.
  //
  // The code now reads CODE/REV: the payload carries `itemRevision`, the
  // CUSTOMER's drawing revision off the SO line behind the card (never
  // items.revision, which describes the item master). A bar with no order line
  // behind it has none and keeps the bare code, with no trailing slash.
  //
  // POL — the line number printed on the CUSTOMER's own purchase order — leads
  // the line, as it does everywhere else. It is dropped when the card is
  // job-work sourced or hand-raised.
  const itemLabel = [
    bar.clientPoLineNo ? `POL ${bar.clientPoLineNo}` : '',
    itemCodeWithRev(bar.itemCode, bar.itemRevision, ''),
    bar.itemName ?? '',
  ]
    .filter((t) => t !== '')
    .join(' · ');
  return (
    <div
      draggable={canWrite}
      onDragStart={(e) => e.dataTransfer.setData('text/jc-op-id', bar.jcOpId)}
      title={
        `${bar.jcCode} Op ${fmtOpSrNo(bar.opSeq)} ${bar.operation}` +
        (bar.dueDate ? ` (Due ${fmtDate(bar.dueDate)})` : '') +
        (itemLabel ? `\n${itemLabel}` : '') +
        (canWrite ? '\nDrag a bar to reschedule.' : '')
      }
      style={{
        position: 'absolute',
        left: 2,
        top: 2,
        width: widthPx,
        height: ROW_HEIGHT - 6,
        background: c.bg,
        border: `1.5px solid ${c.border}`,
        borderRadius: 4,
        padding: '3px 6px',
        cursor: canWrite ? 'grab' : 'pointer',
        overflow: 'hidden',
        color: c.fg,
        fontSize: 11,
        lineHeight: 1.2,
        zIndex: 2 + colIdx,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 11,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {bar.jcCode} · Op {opSrNo(bar.opSeq)}
      </div>
      <div
        style={{
          fontSize: 11,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {bar.operation || '-'}
      </div>
    </div>
  );
}

function LegendDot({
  kind,
  label,
}: {
  kind: ProductionScheduleBar['colorKind'];
  label: string;
}): React.JSX.Element {
  const c = BAR_PALETTE[kind];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          display: 'inline-block',
          width: 14,
          height: 10,
          background: c.bg,
          border: `1.5px solid ${c.border}`,
          borderRadius: 3,
        }}
      />
      {label}
    </div>
  );
}
