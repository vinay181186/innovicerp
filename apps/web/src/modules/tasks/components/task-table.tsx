// The Task Board table (ADR-176, approved board). Columns: Task# | Title |
// <Person> | Related To | Priority | Due Date | Status | Last Update | Actions.
// The person column is the OTHER party of the current view — who assigned it
// (Inbox), who it went to (Outbox / All), "Me" on My To-Do. Rows open the
// detail; the small action buttons appear only when the server says the
// caller may take that action on that row.

import type { TaskRow, TaskView } from '@innovic/shared';
import { TASK_PRIORITY_LABELS } from '@innovic/shared';
import { fmtTaskDate, fmtTaskDateTime, isOpenTask, priorityColor, statusPill } from '../lib/format';
import { RelatedRefLink } from './related-ref-link';

export const PERSON_LABEL: Record<TaskView, string> = {
  inbox: 'Assigned By',
  outbox: 'Assigned To',
  todo: 'Owner',
  all: 'Assigned To',
};

export const VIEW_HINT: Record<TaskView, string> = {
  inbox: 'Inbox: tasks assigned to the logged-in user by other users.',
  outbox: 'Outbox: tasks created by the logged-in user and assigned to other users.',
  todo: 'My To-Do: personal tasks created by and assigned to the logged-in user.',
  all: 'All Tasks: Admin-only view. Backend permission must enforce this.',
};

export type RowAction = 'view' | 'status' | 'complete' | 'reassign' | 'cancel';

export function personName(t: TaskRow, view: TaskView): string {
  if (view === 'inbox') return t.assignedByName ?? t.createdByName ?? '—';
  if (view === 'todo') return 'Me';
  return t.assignedToName ?? '—';
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      style={{ fontSize: 11, padding: '3px 6px' }}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function TaskTableRow({
  t,
  view,
  onAction,
}: {
  t: TaskRow;
  view: TaskView;
  onAction: (action: RowAction, task: TaskRow) => void;
}): React.JSX.Element {
  const pill = statusPill(t);
  const open = isOpenTask(t);
  const p = t.permissions;
  return (
    <tr onClick={() => onAction('view', t)} style={{ cursor: 'pointer' }}>
      <td className="td-code mono fw-700" style={{ color: 'var(--blue)' }}>
        {t.isUnread ? <span className="task-unread" title="Unread — new task" /> : null}
        {t.code}
      </td>
      <td>
        <span
          style={{
            fontWeight: 700,
            display: 'inline-block',
            maxWidth: 320,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            verticalAlign: 'bottom',
          }}
          title={t.title}
        >
          {t.title}
        </span>
        {t.attachmentCount > 0 ? (
          <span
            className="text3"
            style={{ fontSize: 10, marginLeft: 6 }}
            title={`${t.attachmentCount} attachment(s)`}
          >
            📎{t.attachmentCount}
          </span>
        ) : null}
        {t.commentCount > 0 ? (
          <span
            className="text3"
            style={{ fontSize: 10, marginLeft: 4 }}
            title={`${t.commentCount} remark(s)`}
          >
            💬{t.commentCount}
          </span>
        ) : null}
      </td>
      <td style={{ fontSize: 12 }}>{personName(t, view)}</td>
      <td>
        <RelatedRefLink linkedRef={t.linkedRef} stopRowClick />
      </td>
      <td>
        <span
          style={{
            fontWeight: t.priority === 'urgent' || t.priority === 'high' ? 700 : 600,
            color: priorityColor(t.priority),
          }}
        >
          {TASK_PRIORITY_LABELS[t.priority]}
        </span>
      </td>
      <td
        className="mono"
        style={{ fontSize: 12, fontWeight: 700, color: t.isOverdue ? 'var(--red)' : 'var(--text)' }}
      >
        {fmtTaskDate(t.dueDate)}
        {t.isOverdue ? ' ⚠' : ''}
      </td>
      <td>
        <span className={pill.cls}>{pill.label}</span>
      </td>
      <td className="mono text3" style={{ fontSize: 11 }}>
        {fmtTaskDateTime(t.updatedAt)}
      </td>
      <td>
        <div
          style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onAction('view', t)}
          >
            View
          </button>
          {p.canUpdateStatus && open ? (
            <IconBtn title="Update status" onClick={() => onAction('status', t)}>
              ✏
            </IconBtn>
          ) : null}
          {p.canComplete && open ? (
            <IconBtn title="Mark completed" onClick={() => onAction('complete', t)}>
              ✅
            </IconBtn>
          ) : null}
          {p.canReassign && open ? (
            <IconBtn title="Reassign" onClick={() => onAction('reassign', t)}>
              👤
            </IconBtn>
          ) : null}
          {p.canCancel && open ? (
            <IconBtn title="Cancel task" onClick={() => onAction('cancel', t)}>
              ✖
            </IconBtn>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function TaskTable({
  rows,
  view,
  onAction,
}: {
  rows: TaskRow[];
  view: TaskView;
  onAction: (action: RowAction, task: TaskRow) => void;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginBottom: 0 }}>
      <div className="tbl-wrap tbl-frozen">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Task No.</th>
              <th>Title</th>
              <th>{PERSON_LABEL[view]}</th>
              <th>Related To</th>
              <th>Priority</th>
              <th>Due Date</th>
              <th>Task Status</th>
              <th>Last Update</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state">
                  No tasks found
                </td>
              </tr>
            ) : (
              rows.map((t) => <TaskTableRow key={t.id} t={t} view={view} onAction={onAction} />)
            )}
          </tbody>
        </table>
      </div>
      <div
        style={{
          padding: '8px 12px',
          fontSize: 11,
          color: 'var(--text3)',
          borderTop: '1px solid var(--border)',
        }}
      >
        {VIEW_HINT[view]} 💡 Click a row to open it.
      </div>
    </div>
  );
}
