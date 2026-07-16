// Task Board — mirror of legacy renderTaskBoard (HTML L14255). Status count
// cards (To Do / In Progress / Completed / Overdue), user + priority filters,
// assign (admin/manager), view, update-status (assignee or manager). Unread
// dot + count for the current user's freshly-assigned tasks.

import type { TaskRow } from '@innovic/shared';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@innovic/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMarkTasksViewed, useTaskList, useTaskUserOptions } from '../api';
import { AssignTaskModal, UpdateStatusModal, ViewTaskModal } from '../components/task-modals';

export const taskBoardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'task-board',
  component: TaskBoardPage,
});

type StatusFilter = '' | 'todo' | 'in_progress' | 'completed' | 'overdue';
type ModalState =
  | { kind: 'none' }
  | { kind: 'assign' }
  | { kind: 'view'; id: string }
  | { kind: 'update'; task: TaskRow };

const CARDS: { key: Exclude<StatusFilter, ''>; label: string; color: string }[] = [
  { key: 'todo', label: 'To Do', color: 'var(--amber)' },
  { key: 'in_progress', label: 'In Progress', color: 'var(--cyan)' },
  { key: 'completed', label: 'Completed', color: 'var(--green)' },
  { key: 'overdue', label: 'Overdue', color: 'var(--red)' },
];

function TaskBoardPage(): React.JSX.Element {
  const { data: me } = useSession();
  const isWriter = me?.role === 'admin' || me?.role === 'manager';

  const [userFilter, setUserFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  // 'overdue' is a client-side filter (no stored status) — don't send it to the
  // server; the other three map to real status columns.
  const serverStatus = statusFilter === 'overdue' ? '' : statusFilter;
  const { data, isLoading, isError, error } = useTaskList({
    assignedTo: userFilter || undefined,
    status: serverStatus || undefined,
    priority: priorityFilter || undefined,
  });
  const { data: userOpts } = useTaskUserOptions();
  const markViewed = useMarkTasksViewed();

  // Stamp the current user's freshly-assigned tasks as viewed, once on mount.
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    markViewed.mutate();
  }, [markViewed]);

  const rows = useMemo(() => {
    const all = data?.tasks ?? [];
    return statusFilter === 'overdue' ? all.filter((t) => t.isOverdue) : all;
  }, [data, statusFilter]);

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  const counts = data.counts;
  const toggleStatus = (k: Exclude<StatusFilter, ''>): void =>
    setStatusFilter((cur) => (cur === k ? '' : k));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📋 Task Board
          {data.unreadCount > 0 ? (
            <span className="badge b-red" style={{ marginLeft: 8 }}>
              🔔 {data.unreadCount} new
            </span>
          ) : null}
        </div>
        {isWriter ? (
          <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'assign' })}>
            + Assign Task
          </button>
        ) : null}
      </div>

      {/* Status count cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        {CARDS.map((c) => (
          <button
            type="button"
            key={c.key}
            className="panel"
            onClick={() => toggleStatus(c.key)}
            style={{
              minWidth: 120,
              padding: 12,
              textAlign: 'center',
              cursor: 'pointer',
              border: `2px solid ${statusFilter === c.key ? c.color : 'transparent'}`,
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' }}>{c.label}</div>
            <div className="mono fw-700" style={{ fontSize: 24, color: c.color }}>
              {counts[c.key]}
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="innovic-select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">All Users</option>
          {(userOpts?.options ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select className="innovic-select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">All Priority</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TASK_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="tbl-wrap tbl-frozen">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Task#</th>
                <th>Title</th>
                <th>Assigned To</th>
                <th>Assigned By</th>
                <th>Priority</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Timeline</th>
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
                rows.map((t) => <TaskRowView key={t.id} t={t} meId={me?.id} isWriter={isWriter} onView={(id) => setModal({ kind: 'view', id })} onUpdate={(task) => setModal({ kind: 'update', task })} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal.kind === 'assign' ? <AssignTaskModal users={userOpts?.options ?? []} onClose={() => setModal({ kind: 'none' })} /> : null}
      {modal.kind === 'view' ? <ViewTaskModal taskId={modal.id} onClose={() => setModal({ kind: 'none' })} /> : null}
      {modal.kind === 'update' ? <UpdateStatusModal task={modal.task} onClose={() => setModal({ kind: 'none' })} /> : null}
    </div>
  );
}

function priorityColor(p: string): string {
  return p === 'high' ? 'var(--red)' : p === 'medium' ? 'var(--amber)' : 'var(--text3)';
}
function statusColor(t: TaskRow): string {
  if (t.status === 'completed') return 'var(--green)';
  if (t.status === 'in_progress') return 'var(--cyan)';
  if (t.isOverdue) return 'var(--red)';
  return 'var(--amber)';
}

function TaskRowView({
  t,
  meId,
  isWriter,
  onView,
  onUpdate,
}: {
  t: TaskRow;
  meId: string | undefined;
  isWriter: boolean;
  onView: (id: string) => void;
  onUpdate: (task: TaskRow) => void;
}): React.JSX.Element {
  const canEdit = isWriter || t.assignedTo === meId;
  return (
    <tr>
      <td className="td-code mono fw-700" style={{ color: 'var(--cyan)', fontSize: 11 }}>
        {t.isUnread ? <span className="task-unread" title="Unread — new task" /> : null}
        {t.code}
      </td>
      <td style={{ fontWeight: 600 }}>
        {t.title}
        {t.linkedRef?.display ? (
          <span className="task-linked-ref" title={`Linked to ${t.linkedRef.display}`}>
            🔗 {t.linkedRef.display}
          </span>
        ) : null}
      </td>
      <td style={{ fontSize: 11 }}>{t.assignedToName ?? '—'}</td>
      <td style={{ fontSize: 11, color: 'var(--text3)' }}>{t.assignedByName ?? '—'}</td>
      <td>
        <span style={{ fontWeight: 700, color: priorityColor(t.priority) }}>{TASK_PRIORITY_LABELS[t.priority]}</span>
      </td>
      <td style={{ fontSize: 11, fontWeight: 700, color: t.isOverdue ? 'var(--red)' : 'var(--text)' }}>
        {t.dueDate}
        {t.isOverdue ? ' ⚠' : ''}
      </td>
      <td>
        <span style={{ fontWeight: 700, color: statusColor(t) }}>{t.isOverdue ? 'Overdue' : TASK_STATUS_LABELS[t.status]}</span>
      </td>
      <td style={{ fontSize: 10, color: 'var(--text3)' }}>
        {t.createdDate}
        {t.startedDate ? <><br />▶{t.startedDate}</> : null}
        {t.completedDate ? <><br />✅{t.completedDate}</> : null}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 3 }}>
          {t.linkedRef?.navPage ? (
            <Link to={t.linkedRef.navPage} className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} title={`Open linked ${t.linkedRef.display}`}>
              🔗
            </Link>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => onView(t.id)} title="View">
            👁
          </button>
          {canEdit ? (
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => onUpdate(t)} title="Update status">
              ✏
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
