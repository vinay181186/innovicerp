// Design Work Log — My Log tab's "Log Work Entry" form (chrome above the Recent
// Work Log table). Moved out of routes/list.tsx unchanged (ADR-203 split): same
// fields, same checks, same day-total warning, same project / task lists.

import {
  type CreateDesignWorkLogInput,
  DESIGN_DAY_HOURS_WARN,
  DESIGN_HOURS_MAX_PER_ENTRY,
  DESIGN_WORK_CATEGORIES,
  type DesignWorkCategory,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { Banner } from '@/ui/feedback';
import { useDesignProjectDetail, useDesignProjectsList } from '../../design-projects/api';
import { useCreateDesignWorkLog } from '../api';
import { todayStr } from './work-log-shared';

export function EntryForm(): React.JSX.Element {
  const [logDate, setLogDate] = useState(todayStr());
  const [projectId, setProjectId] = useState<string>('');
  const [task, setTask] = useState('');
  const [category, setCategory] = useState<DesignWorkCategory>('Design');
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Set after a save that took the day's total above the warning line.
  const [dayWarn, setDayWarn] = useState<string | null>(null);

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

  const createMut = useCreateDesignWorkLog();

  const onSave = (): void => {
    setErr(null);
    setDayWarn(null);
    if (!projectId) {
      setErr('Project is required.');
      return;
    }
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) {
      setErr('Hours is required.');
      return;
    }
    if (h > DESIGN_HOURS_MAX_PER_ENTRY) {
      setErr(`Hours cannot be more than ${DESIGN_HOURS_MAX_PER_ENTRY} in one entry.`);
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
      onSuccess: (saved) => {
        setHours('');
        setTask('');
        setDescription('');
        const day = saved.dayTotalHours ?? 0;
        if (day > DESIGN_DAY_HOURS_WARN) {
          setDayWarn(
            `Saved. You now have ${day}h booked on ${fmtDate(saved.logDate)} — more than ${DESIGN_DAY_HOURS_WARN}h in one day. Check the hours are right.`,
          );
        }
      },
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save Entry. Try again.'),
    });
  };

  return (
    <div
      className="panel"
      style={{ padding: 16, marginBottom: 'var(--panel-gap)', borderLeft: '3px solid var(--blue)' }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Log Work Entry</div>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Log Date</label>
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
          <select className="innovic-select" value={task} onChange={(e) => setTask(e.target.value)}>
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
            max={DESIGN_HOURS_MAX_PER_ENTRY}
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
      {dayWarn ? (
        <div style={{ marginTop: 12 }}>
          <Banner tone="warn" flush onDismiss={() => setDayWarn(null)}>
            {dayWarn}
          </Banner>
        </div>
      ) : null}
      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: 'var(--red3)',
            color: 'var(--red2)',
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
  );
}
