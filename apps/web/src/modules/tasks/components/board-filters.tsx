// Task Board chrome above the table (ADR-176): the tab strip (Inbox / Outbox /
// My To-Do / All Tasks) and the filter selects (Status + Priority +
// Person + Due Date; All Tasks adds Assigned By + Department; search is the board ListHeader's). Presentational —
// the board route owns every value and hands the setters down. The Status and
// Due Date options carry the view's counts ("To Do (4)", "Overdue (2)") — they
// replaced the clickable KPI strip (owner decision 2026-09-26: a filter is a
// dropdown, not a row of capsules).

import type {
  TaskDueFilter,
  TaskPriority,
  TaskStatus,
  TaskStatusCounts,
  TaskUserOption,
  TaskView,
} from '@innovic/shared';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_VIEW_LABELS } from '@innovic/shared';
import { PERSON_LABEL } from './task-table';

const STATUS_OPTIONS: { value: TaskStatus | ''; label: string }[] = [
  { value: '', label: 'All Status' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const DUE_OPTIONS: { value: TaskDueFilter | ''; label: string }[] = [
  { value: '', label: 'Due Date: All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'overdue', label: 'Overdue' },
];

/** "To Do (4)" — the count only where the server sends one for that choice. */
function withCount(label: string, n: number | undefined): string {
  return n == null ? label : `${label} (${n})`;
}

export function TaskTabs({
  tabs,
  view,
  countOf,
  onChange,
}: {
  tabs: TaskView[];
  view: TaskView;
  countOf: (v: TaskView) => number | null;
  onChange: (v: TaskView) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      className="panel"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        marginBottom: 10,
        borderRadius: 'var(--radius2) var(--radius2) 0 0',
      }}
    >
      {tabs.map((v, i) => {
        const active = v === view;
        const n = countOf(v);
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v)}
            style={{
              background: active ? 'var(--blue3)' : 'transparent',
              border: 'none',
              borderRight: i < tabs.length - 1 ? '1px solid var(--border)' : 'none',
              borderBottom: `3px solid ${active ? 'var(--blue)' : 'transparent'}`,
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: active ? 700 : 600,
              color: active ? 'var(--blue)' : 'var(--text2)',
              font: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {TASK_VIEW_LABELS[v]}
            {n != null ? (
              <span className="badge b-blue" style={{ borderRadius: 10, padding: '1px 7px' }}>
                {n}
              </span>
            ) : null}
            {v === 'all' ? (
              <small className="text3" style={{ fontWeight: 400 }}>
                (Admin)
              </small>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface BoardFilterValues {
  searchInput: string;
  status: TaskStatus | '';
  priority: TaskPriority | '';
  person: string;
  assignedBy: string;
  dept: string;
  due: TaskDueFilter | '';
}

export function TaskFilters({
  view,
  users,
  departments,
  values,
  counts,
  onStatus,
  onPriority,
  onPerson,
  onAssignedBy,
  onDept,
  onDue,
}: {
  view: TaskView;
  users: TaskUserOption[];
  departments: string[];
  values: BoardFilterValues;
  /** Per-status counts over the selected view (before row filters). */
  counts?: TaskStatusCounts | undefined;
  onStatus: (v: TaskStatus | '') => void;
  onPriority: (v: TaskPriority | '') => void;
  onPerson: (v: string) => void;
  onAssignedBy: (v: string) => void;
  onDept: (v: string) => void;
  onDue: (v: TaskDueFilter | '') => void;
}): React.JSX.Element {
  const userOptions = users.map((u) => (
    <option key={u.id} value={u.id}>
      {u.name}
    </option>
  ));
  // The filter selects only — they sit in the board ListHeader's filter bar,
  // after the header's own search box (which owns the search term). The bar
  // sizes every select, so none carries a width of its own.
  const statusCount = (v: TaskStatus | ''): number | undefined =>
    v === 'todo' || v === 'in_progress' || v === 'completed' ? counts?.[v] : undefined;
  return (
    <>
      <select
        className="innovic-select"
        aria-label="Status"
        title="Status"
        value={values.status}
        onChange={(e) => onStatus(e.target.value as TaskStatus | '')}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {withCount(o.label, statusCount(o.value))}
          </option>
        ))}
      </select>
      <select
        className="innovic-select"
        aria-label="Priority"
        title="Priority"
        value={values.priority}
        onChange={(e) => onPriority(e.target.value as TaskPriority | '')}
      >
        <option value="">All Priority</option>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {TASK_PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      {view !== 'todo' ? (
        <select
          className="innovic-select"
          value={values.person}
          onChange={(e) => onPerson(e.target.value)}
        >
          <option value="">{PERSON_LABEL[view]}: All</option>
          {userOptions}
        </select>
      ) : null}
      {view === 'all' ? (
        <>
          <select
            className="innovic-select"
            value={values.assignedBy}
            onChange={(e) => onAssignedBy(e.target.value)}
          >
            <option value="">Assigned By: All</option>
            {userOptions}
          </select>
          <select
            className="innovic-select"
            value={values.dept}
            onChange={(e) => onDept(e.target.value)}
          >
            <option value="">Department: All</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <select
        className="innovic-select"
        aria-label="Due date"
        title="Due date"
        value={values.due}
        onChange={(e) => onDue(e.target.value as TaskDueFilter | '')}
      >
        {DUE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {withCount(o.label, o.value === 'overdue' ? counts?.overdue : undefined)}
          </option>
        ))}
      </select>
    </>
  );
}
