// Task Board chrome above the table (ADR-176): the tab strip (Inbox / Outbox /
// My To-Do / All Tasks) and the filter selects (Status + Priority +
// Person + Due Date; All Tasks adds Assigned By + Department; search is the board ListHeader's). Presentational —
// the board route owns every value and hands the setters down.

import type {
  TaskDueFilter,
  TaskPriority,
  TaskStatus,
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

const selectStyle: React.CSSProperties = { fontSize: 12, width: 'auto' };

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
  // The filter selects only — they sit in the board's ListHeader tools, after
  // the header's own search box (which owns the search term).
  return (
    <>
      <select
        className="innovic-select"
        value={values.status}
        onChange={(e) => onStatus(e.target.value as TaskStatus | '')}
        style={selectStyle}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        className="innovic-select"
        value={values.priority}
        onChange={(e) => onPriority(e.target.value as TaskPriority | '')}
        style={selectStyle}
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
          style={selectStyle}
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
            style={selectStyle}
          >
            <option value="">Assigned By: All</option>
            {userOptions}
          </select>
          <select
            className="innovic-select"
            value={values.dept}
            onChange={(e) => onDept(e.target.value)}
            style={selectStyle}
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
        value={values.due}
        onChange={(e) => onDue(e.target.value as TaskDueFilter | '')}
        style={selectStyle}
      >
        {DUE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
