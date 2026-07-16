// Daily Work Log (Design slice E) — engineer timesheet feed.
// Mirrors legacy renderDesignWorkLog (HTML L7935) with 5 tabs.

import {
  type CreateDesignWorkLogInput,
  DESIGN_WORK_CATEGORIES,
  type DesignWorkCategory,
  type DesignWorkLogEntry,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDesignProjectDetail, useDesignProjectsList } from '../../design-projects/api';
import {
  useCreateDesignWorkLog,
  useDeleteDesignWorkLog,
  useDesignWorkLogList,
} from '../api';

type TabKey = 'entry' | 'daily' | 'weekly' | 'project' | 'alerts';

// Legacy _dpWlEntry catColors (HTML L7975). Categories outside this map
// ('Client Support', 'Testing/FEA', 'Other') fall back to --text3, as in legacy.
const CAT_COLORS: Record<string, string> = {
  Design: 'var(--blue)',
  Review: 'var(--purple)',
  Rework: 'var(--red)',
  'Issue Resolution': 'var(--orange)',
  Meeting: 'var(--amber)',
  Documentation: 'var(--green)',
};

function catColor(cat: string): string {
  return CAT_COLORS[cat] ?? 'var(--text3)';
}

export const designWorkLogListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-work-log',
  component: DesignWorkLogPage,
});

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayName(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
}

function DesignWorkLogPage(): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('entry');

  const tabs: Array<{ k: TabKey; label: string }> = [
    { k: 'entry', label: '📝 My Timesheet' },
    { k: 'daily', label: '📅 Daily View' },
    { k: 'weekly', label: '📊 Weekly View' },
    { k: 'project', label: '🏭 Project Hours' },
    { k: 'alerts', label: '🔔 Alerts' },
  ];

  return (
    <div>
      <div className="section-hdr">⏱ Daily Work Log</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.k}
            type="button"
            className="btn btn-sm"
            style={{
              fontWeight: 700,
              background: tab === t.k ? 'var(--blue)' : 'var(--bg4)',
              color: tab === t.k ? '#fff' : 'var(--text2)',
              border: `1px solid ${tab === t.k ? 'var(--blue)' : 'var(--border)'}`,
            }}
            onClick={() => setTab(t.k)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'entry' ? <EntryTab /> : null}
      {tab === 'daily' ? <DailyTab /> : null}
      {tab === 'weekly' ? <WeeklyTab /> : null}
      {tab === 'project' ? <ProjectTab /> : null}
      {tab === 'alerts' ? <AlertsTab /> : null}
    </div>
  );
}

// ─── Entry tab ────────────────────────────────────────────────────────────

function EntryTab(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const engineer = me?.email ?? '';

  const [logDate, setLogDate] = useState(todayStr());
  const [projectId, setProjectId] = useState<string>('');
  const [task, setTask] = useState('');
  const [category, setCategory] = useState<DesignWorkCategory>('Design');
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Legacy L7954 offers every project that is not Released — that is
  // Design Active + In Review + On Hold. The `active` server filter is
  // status = 'Design Active' only, so filter client-side instead.
  const { data: projData } = useDesignProjectsList({
    filter: 'all',
    limit: 200,
    offset: 0,
  });
  const projects = (projData?.items ?? []).filter((p) => p.status !== 'Released');

  // Legacy _dpWlProjChange (L7989) repopulates the Task select from the
  // selected project's tasks.
  const { data: projDetail } = useDesignProjectDetail(projectId || undefined);
  const projTasks = projDetail?.tasks ?? [];

  const { data } = useDesignWorkLogList({
    engineer: engineer || undefined,
    limit: 100,
    offset: 0,
  });
  const myLogs = data?.items ?? [];
  const todayLogs = myLogs.filter((l) => l.logDate === todayStr());
  const todayHrs = todayLogs.reduce((s, l) => s + l.hours, 0);
  const totalHrs = myLogs.reduce((s, l) => s + l.hours, 0);

  const createMut = useCreateDesignWorkLog();
  const deleteMut = useDeleteDesignWorkLog();

  const onSave = (): void => {
    setErr(null);
    if (!projectId) {
      setErr('Select project');
      return;
    }
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) {
      setErr('Enter hours');
      return;
    }
    const input: CreateDesignWorkLogInput = {
      logDate,
      designProjectId: projectId,
      category,
      hours: h,
    };
    if (task.trim()) input.taskText = task.trim();
    if (description.trim()) input.description = description.trim();
    createMut.mutate(input, {
      onSuccess: () => {
        setHours('');
        setTask('');
        setDescription('');
      },
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
    });
  };

  // Group most recent 30 days
  const grouped: Record<string, DesignWorkLogEntry[]> = {};
  myLogs.slice(0, 50).forEach((l) => {
    if (!grouped[l.logDate]) grouped[l.logDate] = [];
    grouped[l.logDate]!.push(l);
  });
  const dates = Object.keys(grouped)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 10);

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Tile label="Today" value={`${todayHrs.toFixed(1)}h`} color="var(--blue)" />
        <Tile label="Entries Today" value={todayLogs.length} color="var(--green)" />
        <Tile label="Total Hours" value={`${totalHrs.toFixed(0)}h`} color="var(--cyan)" />
      </div>

      {canWrite ? (
        <div
          className="panel"
          style={{ padding: 16, marginBottom: 16, borderLeft: '3px solid var(--blue)' }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📝 Log Work Entry</div>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">Date</label>
              <input
                type="date"
                className="innovic-input"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Project ★</label>
              <select
                className="innovic-select"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setTask('');
                }}
              >
                <option value="">— Select —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.projectName}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Task</label>
              <select
                className="innovic-select"
                value={task}
                onChange={(e) => setTask(e.target.value)}
              >
                <option value="">— General —</option>
                {projTasks.map((t) => (
                  <option key={t.id} value={t.title}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Category</label>
              <select
                className="innovic-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as DesignWorkCategory)}
              >
                {DESIGN_WORK_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Hours ★</label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                max={12}
                className="innovic-input"
                style={{ width: 80 }}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">What did you do?</label>
              <input
                className="innovic-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description..."
              />
            </div>
          </div>
          {err ? (
            <div
              style={{
                marginTop: 12,
                padding: 8,
                background: 'rgba(239,68,68,0.08)',
                color: 'var(--red)',
                fontSize: 12,
                borderRadius: 4,
              }}
            >
              {err}
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 6 }}
            disabled={createMut.isPending}
            onClick={onSave}
          >
            {createMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save Entry'
            )}
          </button>
        </div>
      ) : null}

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Recent Work Log</div>
      {dates.length === 0 ? (
        <div className="empty-state" style={{ padding: 30 }}>
          No work logged yet.
        </div>
      ) : null}
      {dates.map((date) => {
        const dayLogs = grouped[date]!;
        const dayHrs = dayLogs.reduce((s, l) => s + l.hours, 0);
        return (
          <div key={date} style={{ marginBottom: 14 }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}
            >
              <span
                style={{
                  background: 'rgba(37,99,235,0.08)',
                  border: '1px solid rgba(37,99,235,0.3)',
                  color: 'var(--blue)',
                  padding: '3px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: 'var(--mono)',
                }}
              >
                {date}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontWeight: 700,
                  fontFamily: 'var(--mono)',
                  color:
                    dayHrs >= 6
                      ? 'var(--green)'
                      : dayHrs >= 3
                        ? 'var(--amber)'
                        : 'var(--red)',
                }}
              >
                {dayHrs.toFixed(1)}h
              </span>
            </div>
            {dayLogs.map((l) => {
              const cc = catColor(l.category);
              return (
                <div
                  key={l.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '8px 12px',
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    marginBottom: 4,
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{ width: 3, height: 28, borderRadius: 2, background: cc, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {l.taskText ?? 'General'}{' '}
                      <span
                        style={{
                          fontSize: 9,
                          padding: '1px 6px',
                          borderRadius: 10,
                          color: cc,
                        }}
                      >
                        {l.category}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {l.projectName ?? ''}
                    </div>
                    {l.description ? (
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>{l.description}</div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      fontFamily: 'var(--mono)',
                      color: cc,
                    }}
                  >
                    {l.hours}h
                  </div>
                  {canWrite ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 10 }}
                      disabled={deleteMut.isPending}
                      onClick={() => {
                        if (window.confirm('Delete entry?')) deleteMut.mutate(l.id);
                      }}
                    >
                      🗑
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Daily tab ────────────────────────────────────────────────────────────

function DailyTab(): React.JSX.Element {
  const [viewDate, setViewDate] = useState(todayStr());
  const [viewEng, setViewEng] = useState<string>('All');
  const { data } = useDesignWorkLogList({
    fromDate: viewDate,
    toDate: viewDate,
    limit: 500,
    offset: 0,
  });
  const allDayLogs = data?.items ?? [];

  // Legacy L7994-7997: the engineer cards always show that engineer's full day,
  // while the entry list and the Total tile follow the selected engineer.
  const logs = viewEng === 'All' ? allDayLogs : allDayLogs.filter((l) => l.engineerText === viewEng);
  const totalHrs = logs.reduce((s, l) => s + l.hours, 0);

  const engineers = useMemo(() => {
    const s = new Set<string>();
    allDayLogs.forEach((l) => s.add(l.engineerText));
    return Array.from(s).sort();
  }, [allDayLogs]);

  // Group by engineer
  const byEng: Record<string, DesignWorkLogEntry[]> = {};
  logs.forEach((l) => {
    if (!byEng[l.engineerText]) byEng[l.engineerText] = [];
    byEng[l.engineerText]!.push(l);
  });

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setViewDate(addDays(viewDate, -1))}
        >
          ←
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, minWidth: 160, textAlign: 'center' }}>
          {viewDate} ({dayName(viewDate)})
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setViewDate(addDays(viewDate, 1))}
        >
          →
        </button>
        <div style={{ flex: 1 }} />
        <input
          type="date"
          className="innovic-input"
          value={viewDate}
          onChange={(e) => setViewDate(e.target.value)}
        />
        <select
          style={{
            padding: '6px 10px',
            fontSize: 12,
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
          }}
          value={viewEng}
          onChange={(e) => setViewEng(e.target.value)}
        >
          <option value="All">All Engineers</option>
          {engineers.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        {engineers.map((eng) => {
          const hrs = allDayLogs
            .filter((l) => l.engineerText === eng)
            .reduce((s, l) => s + l.hours, 0);
          return (
            <div
              key={eng}
              className="panel"
              style={{
                textAlign: 'center',
                padding: 10,
                cursor: 'pointer',
                border: `1px solid ${viewEng === eng ? 'var(--blue)' : 'var(--border)'}`,
              }}
              onClick={() => setViewEng(viewEng === eng ? 'All' : eng)}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  fontFamily: 'var(--mono)',
                  color: hrs >= 6 ? 'var(--green)' : hrs > 0 ? 'var(--amber)' : 'var(--red)',
                }}
              >
                {hrs.toFixed(1)}h
              </div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{eng}</div>
            </div>
          );
        })}
        <div className="panel" style={{ textAlign: 'center', padding: 10 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              fontFamily: 'var(--mono)',
              color: 'var(--blue)',
            }}
          >
            {totalHrs.toFixed(1)}h
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>Total</div>
        </div>
      </div>

      {Object.keys(byEng).length === 0 ? (
        <div className="empty-state" style={{ padding: 30 }}>
          📭 No entries
        </div>
      ) : (
        Object.entries(byEng).map(([eng, entries]) => {
          const et = entries.reduce((s, l) => s + l.hours, 0);
          return (
            <div key={eng} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>👤 {eng}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontWeight: 700,
                    fontFamily: 'var(--mono)',
                    color: et >= 6 ? 'var(--green)' : 'var(--amber)',
                  }}
                >
                  {et.toFixed(1)}h
                </span>
              </div>
              {entries.map((l) => (
                <div
                  key={l.id}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    marginBottom: 3,
                    fontSize: 12,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <b>{l.taskText ?? 'General'}</b>{' '}
                    <span style={{ fontSize: 10, color: 'var(--text3)' }}>{l.category}</span>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {l.projectName ?? ''}
                      {l.description ? ` — ${l.description}` : ''}
                    </div>
                  </div>
                  <span className="mono fw-700">{l.hours}h</span>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Weekly tab ───────────────────────────────────────────────────────────

function WeeklyTab(): React.JSX.Element {
  const [refDate, setRefDate] = useState(todayStr());
  const weekDates = useMemo(() => {
    const d = new Date(refDate + 'T00:00:00');
    const day = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(mon);
      dd.setDate(mon.getDate() + i);
      out.push(dd.toISOString().slice(0, 10));
    }
    return out;
  }, [refDate]);

  const { data } = useDesignWorkLogList({
    fromDate: weekDates[0],
    toDate: weekDates[6],
    limit: 2000,
    offset: 0,
  });
  const logs = data?.items ?? [];

  const engineers = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => s.add(l.engineerText));
    return Array.from(s).sort();
  }, [logs]);

  function getHrs(eng: string, date: string): number {
    return logs
      .filter((l) => l.engineerText === eng && l.logDate === date)
      .reduce((s, l) => s + l.hours, 0);
  }

  let gt = 0;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRefDate(addDays(refDate, -7))}
        >
          ←
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, minWidth: 200, textAlign: 'center' }}>
          {weekDates[0]} — {weekDates[6]}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRefDate(addDays(refDate, 7))}
        >
          →
        </button>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Engineer</th>
                {weekDates.map((dt) => (
                  <th key={dt} style={{ textAlign: 'center', fontSize: 10 }}>
                    {dayName(dt)}
                    <br />
                    {dt.slice(5)}
                  </th>
                ))}
                <th style={{ textAlign: 'center' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {engineers.map((eng) => {
                let wt = 0;
                return (
                  <tr key={eng}>
                    <td className="fw-700" style={{ fontSize: 12 }}>
                      {eng}
                    </td>
                    {weekDates.map((dt) => {
                      const hrs = getHrs(eng, dt);
                      wt += hrs;
                      return (
                        <td
                          key={dt}
                          className="td-ctr mono"
                          style={{
                            fontWeight: 700,
                            color:
                              hrs >= 7
                                ? 'var(--green)'
                                : hrs > 0
                                  ? undefined
                                  : 'var(--text3)',
                          }}
                        >
                          {hrs > 0 ? hrs.toFixed(1) : '0'}
                        </td>
                      );
                    })}
                    <td
                      className="td-ctr mono fw-700"
                      style={{
                        color:
                          wt >= 30 ? 'var(--green)' : wt >= 20 ? 'var(--amber)' : 'var(--red)',
                      }}
                    >
                      {(() => {
                        gt += wt;
                        return `${wt.toFixed(1)}h`;
                      })()}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--bg4)' }}>
                <td className="fw-700" style={{ color: 'var(--blue)' }}>
                  TOTAL
                </td>
                {weekDates.map((dt) => {
                  const ct = engineers.reduce((s, eng) => s + getHrs(eng, dt), 0);
                  return (
                    <td key={dt} className="td-ctr mono fw-700">
                      {ct.toFixed(1)}
                    </td>
                  );
                })}
                <td className="td-ctr mono fw-700" style={{ color: 'var(--blue)' }}>
                  {gt.toFixed(1)}h
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Project tab ──────────────────────────────────────────────────────────

function ProjectTab(): React.JSX.Element {
  const { data } = useDesignWorkLogList({ limit: 2000, offset: 0 });
  const logs = data?.items ?? [];
  const { data: projData } = useDesignProjectsList({ filter: 'all', limit: 200, offset: 0 });
  const projects = projData?.items ?? [];

  const projectData = useMemo(() => {
    const out = projects.map((p) => {
      const pLogs = logs.filter((l) => l.designProjectId === p.id);
      const totalHrs = pLogs.reduce((s, l) => s + l.hours, 0);
      const byEng: Record<string, number> = {};
      pLogs.forEach((l) => {
        byEng[l.engineerText] = (byEng[l.engineerText] ?? 0) + l.hours;
      });
      const byCat: Record<string, number> = {};
      pLogs.forEach((l) => {
        byCat[l.category] = (byCat[l.category] ?? 0) + l.hours;
      });
      return { id: p.id, name: p.projectName, code: p.code, totalHrs, byEng, byCat };
    });
    return out.sort((a, b) => b.totalHrs - a.totalHrs);
  }, [logs, projects]);

  const gt = projectData.reduce((s, p) => s + p.totalHrs, 0);

  return (
    <div>
      <div
        className="panel"
        style={{ textAlign: 'center', padding: 14, marginBottom: 16 }}
      >
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>Grand Total</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--blue)' }}>
          {gt.toFixed(0)}h
        </div>
      </div>
      {projectData.map((p) => (
        <div key={p.id} className="panel" style={{ padding: 14, marginBottom: 10 }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}
          >
            <span className="fw-700">
              {p.code} — {p.name}
            </span>
            <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
              {p.totalHrs.toFixed(1)}h
            </span>
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}
          >
            <div>
              <div
                className="text3"
                style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}
              >
                BY ENGINEER
              </div>
              {Object.entries(p.byEng)
                .sort((a, b) => b[1] - a[1])
                .map(([eng, hrs]) => (
                  <div
                    key={eng}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '3px 0',
                      fontSize: 12,
                    }}
                  >
                    <span>{eng}</span>
                    <span className="mono fw-700">{hrs.toFixed(1)}h</span>
                  </div>
                ))}
            </div>
            <div>
              <div
                className="text3"
                style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}
              >
                BY CATEGORY
              </div>
              {Object.entries(p.byCat)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, hrs]) => (
                  <div
                    key={cat}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '3px 0',
                      fontSize: 12,
                    }}
                  >
                    <span>{cat}</span>
                    <span className="mono fw-700">{hrs.toFixed(1)}h</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ))}
      {projectData.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>
          No work logged.
        </div>
      ) : null}
    </div>
  );
}

// ─── Alerts tab ───────────────────────────────────────────────────────────

function AlertsTab(): React.JSX.Element {
  // Last 10 working days (skip Sat/Sun) starting from today, going back
  const checkDays = useMemo(() => {
    const out: string[] = [];
    const d = new Date(todayStr() + 'T00:00:00');
    while (out.length < 10) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() - 1);
    }
    return out;
  }, []);

  const oldest = checkDays[checkDays.length - 1] ?? todayStr();
  const newest = checkDays[0] ?? todayStr();
  const { data } = useDesignWorkLogList({
    fromDate: oldest,
    toDate: newest,
    limit: 2000,
    offset: 0,
  });
  const logs = data?.items ?? [];

  const engineers = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => s.add(l.engineerText));
    return Array.from(s).sort();
  }, [logs]);

  const unlogged: Array<{ date: string; engineer: string }> = [];
  const lowHours: Array<{ date: string; engineer: string; hours: number }> = [];
  checkDays.forEach((date) => {
    engineers.forEach((eng) => {
      const hrs = logs
        .filter((l) => l.logDate === date && l.engineerText === eng)
        .reduce((s, l) => s + l.hours, 0);
      if (hrs === 0) unlogged.push({ date, engineer: eng });
      else if (hrs < 4) lowHours.push({ date, engineer: eng, hours: hrs });
    });
  });

  // Utilization
  const utilisation = engineers.map((eng) => {
    const dl = checkDays.filter((dt) =>
      logs.some((l) => l.logDate === dt && l.engineerText === eng),
    ).length;
    const th = checkDays.reduce(
      (s, dt) =>
        s +
        logs
          .filter((l) => l.logDate === dt && l.engineerText === eng)
          .reduce((s2, l) => s2 + l.hours, 0),
      0,
    );
    const up = Math.round((th / (10 * 8)) * 100);
    return { engineer: eng, days: dl, missing: 10 - dl, hours: th, util: up };
  });

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Tile label="Unlogged Days" value={unlogged.length} color="var(--red)" />
        <Tile label="Low Hours" value={lowHours.length} color="var(--amber)" />
      </div>

      {unlogged.length > 0 ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(239,68,68,0.06)',
              fontWeight: 700,
              fontSize: 12,
              color: 'var(--red)',
            }}
          >
            🔴 Unlogged Working Days
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Engineer</th>
                </tr>
              </thead>
              <tbody>
                {unlogged.slice(0, 30).map((u, idx) => (
                  <tr key={idx}>
                    <td className="mono">{u.date}</td>
                    <td>{dayName(u.date)}</td>
                    <td className="fw-700">{u.engineer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {lowHours.length > 0 ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(196,122,0,0.06)',
              fontWeight: 700,
              fontSize: 12,
              color: 'var(--amber)',
            }}
          >
            ⚠ Low Hours (&lt;4h)
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Engineer</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {lowHours.map((u, idx) => (
                  <tr key={idx}>
                    <td className="mono">{u.date}</td>
                    <td>{dayName(u.date)}</td>
                    <td className="fw-700">{u.engineer}</td>
                    <td className="mono fw-700" style={{ color: 'var(--amber)' }}>
                      {u.hours.toFixed(1)}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg4)',
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          📊 Utilization (Last 10 Working Days)
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Engineer</th>
                <th>Logged</th>
                <th>Missing</th>
                <th>Hours</th>
                <th>Avg</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {utilisation.map((u) => (
                <tr key={u.engineer}>
                  <td className="fw-700">{u.engineer}</td>
                  <td className="mono">{u.days}/10</td>
                  <td
                    className="mono"
                    style={{ color: u.missing > 2 ? 'var(--red)' : undefined }}
                  >
                    {u.missing}
                  </td>
                  <td className="mono fw-700">{u.hours.toFixed(1)}h</td>
                  <td className="mono">{u.days ? (u.hours / u.days).toFixed(1) : '0'}h</td>
                  <td
                    className="mono fw-700"
                    style={{
                      color:
                        u.util >= 75
                          ? 'var(--green)'
                          : u.util >= 50
                            ? 'var(--amber)'
                            : 'var(--red)',
                    }}
                  >
                    {u.util}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ textAlign: 'center', padding: 14 }}>
      <div className="text3" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
