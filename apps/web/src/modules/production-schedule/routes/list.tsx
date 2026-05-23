// Production Schedule (Gantt) — mirrors legacy renderProductionSchedule
// (HTML L15588). 30-day grid, one row per machine, drag-drop reschedule.

import {
  type ProductionScheduleBar,
  type ProductionScheduleFilter,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useProductionSchedule, useRescheduleJcOp } from '../api';

const COL_WIDTH = 48; // px per day
const ROW_HEIGHT = 48;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
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

  const onDrop = (
    e: React.DragEvent,
    machineId: string,
    iso: string,
  ): void => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/jc-op-id');
    if (!id) return;
    rescheduleMut.mutate({ jcOpId: id, input: { machineId, plannedStart: iso } });
  };

  return (
    <div>
      {/* Top toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div className="section-hdr m-0">📅 Production Schedule (Gantt)</div>
      </div>

      {/* Filter + nav */}
      <div
        className="panel"
        style={{
          padding: '10px 14px',
          marginBottom: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 4 }}>Show:</span>
          {(['all', 'active', 'history', 'future'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="btn btn-sm"
              style={{
                fontSize: 11,
                background: filter === f ? 'var(--blue)' : 'var(--bg4)',
                color: filter === f ? '#fff' : 'var(--text2)',
                border: `1px solid ${filter === f ? 'var(--blue)' : 'var(--border)'}`,
              }}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All Ops' : f === 'active' ? 'Active Only' : f === 'history' ? 'History' : 'Future'}
            </button>
          ))}
        </div>
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
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          marginBottom: 10,
          fontSize: 10,
          flexWrap: 'wrap',
          padding: '6px 10px',
          background: 'var(--bg3)',
          borderRadius: 6,
        }}
      >
        <LegendDot bg="#dcfce7" border="#16a34a" label="On schedule" />
        <LegendDot bg="#fef3c7" border="#d97706" label="Tight (≤ 2-day buffer)" />
        <LegendDot bg="#fee2e2" border="#dc2626" label="Will miss due date" />
        <LegendDot bg="#dbeafe" border="#1d4ed8" label="Currently running" />
        <LegendDot bg="#e2e8f0" border="#64748b" label="Completed" />
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <StatCard label="Total Ops" value={stats.total} color="var(--text)" />
        <StatCard label="On Schedule" value={stats.onSchedule} color="var(--green)" />
        <StatCard label="Tight" value={stats.tight} color="var(--amber)" />
        <StatCard label="At Risk" value={stats.atRisk} color="var(--red)" />
        <StatCard label="Running Now" value={stats.running} color="var(--blue)" />
        <StatCard label="Unscheduled" value={stats.unscheduled} color="var(--text3)" />
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
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load'}
            </div>
          </div>
        </div>
      ) : !data || data.machines.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>No operations to display</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            No Job Card operations match the current filter or window. Try "All Ops" or move the
            window date.
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflow: 'auto', maxHeight: 600 }}>
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              fontSize: 10,
              minWidth: 200 + 30 * COL_WIDTH,
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
                    ? 'rgba(59,130,246,0.15)'
                    : d.isWeekend
                      ? 'var(--bg3)'
                      : 'var(--bg2)';
                  const col = d.isToday ? '#3b82f6' : d.isWeekend ? 'var(--text3)' : 'var(--text)';
                  return (
                    <th
                      key={d.iso}
                      style={{
                        border: '1px solid var(--border)',
                        padding: '4px 2px',
                        fontSize: 9,
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
                    <div>{m.machineCode}</div>
                    {m.machineName ? (
                      <div
                        style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 400 }}
                      >
                        {m.machineName}
                      </div>
                    ) : null}
                  </td>
                  {days.map((d, dayIdx) => {
                    const startingHere = m.bars.filter((b) => b.plannedStart === d.iso);
                    const bg = d.isToday
                      ? 'rgba(59,130,246,0.05)'
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
                          <Bar
                            key={b.jcOpId}
                            bar={b}
                            colIdx={dayIdx}
                            canWrite={canWrite}
                          />
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const palette: Record<
    string,
    { bg: string; border: string; fg: string }
  > = {
    ok: { bg: '#dcfce7', border: '#16a34a', fg: '#166534' },
    tight: { bg: '#fef3c7', border: '#d97706', fg: '#92400e' },
    at_risk: { bg: '#fee2e2', border: '#dc2626', fg: '#7f1d1d' },
    running: { bg: '#dbeafe', border: '#1d4ed8', fg: '#1e3a8a' },
    done: { bg: '#e2e8f0', border: '#64748b', fg: '#334155' },
  };
  const c = palette[bar.colorKind] ?? palette.ok!;
  return (
    <div
      draggable={canWrite}
      onDragStart={(e) => e.dataTransfer.setData('text/jc-op-id', bar.jcOpId)}
      title={`${bar.jcCode} Op${bar.opSeq} — ${bar.operation}${bar.dueDate ? ` (Due ${bar.dueDate})` : ''}`}
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
        fontSize: 9,
        lineHeight: 1.2,
        zIndex: 2 + colIdx,
      }}
    >
      <div style={{ fontWeight: 700 }}>
        {bar.jcCode} Op{bar.opSeq}
      </div>
      <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
        {bar.operation}
      </div>
    </div>
  );
}

function LegendDot({
  bg,
  border,
  label,
}: {
  bg: string;
  border: string;
  label: string;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          background: bg,
          border: `1.5px solid ${border}`,
          display: 'inline-block',
        }}
      />
      <span style={{ color: 'var(--text2)' }}>{label}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}): React.JSX.Element {
  return (
    <div
      className="panel"
      style={{ textAlign: 'center', padding: 10 }}
    >
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}
