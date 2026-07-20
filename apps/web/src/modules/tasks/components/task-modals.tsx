// Task Board modals — Assign (admin/manager), View (read-only), Update Status
// (assignee or manager). Mirror of legacy _addTask / _viewTask /
// _updateTaskStatus.

import type { TaskDetail, TaskLinkedRef, TaskRow, TaskUserOption } from '@innovic/shared';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@innovic/shared';
import { useState } from 'react';
import { useCreateTask, useNextTaskCode, useTaskDetail, useUpdateTaskStatus } from '../api';

export function Overlay(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={props.onClose}
    >
      <div className="panel app-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="panel-hdr">
          <span className="panel-title">{props.title}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">{props.children}</div>
      </div>
    </div>
  );
}

// ── Assign Task (admin/manager) ──
// `linkedRef` + `suggestedTitle` let other record screens open this modal
// pre-filled so the assignee gets a direct link in My Work (ISSUE-014).
export function AssignTaskModal({
  users,
  onClose,
  linkedRef,
  suggestedTitle,
}: {
  users: TaskUserOption[];
  onClose: () => void;
  linkedRef?: TaskLinkedRef | null | undefined;
  suggestedTitle?: string | undefined;
}): React.JSX.Element {
  const create = useCreateTask();
  const { data: next } = useNextTaskCode();
  const [assignedTo, setAssignedTo] = useState(users[0]?.id ?? '');
  const [title, setTitle] = useState(suggestedTitle ?? '');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<(typeof TASK_PRIORITIES)[number]>('medium');
  const [dueDate, setDueDate] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    if (!title.trim()) return setErr('Title required');
    if (!assignedTo) return setErr('Select an assignee');
    if (!dueDate) return setErr('Due date required');
    try {
      await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        assignedTo,
        priority,
        dueDate,
        linkedRef: linkedRef ?? undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to assign task');
    }
  }

  return (
    <Overlay title="📋 Assign Task" onClose={onClose}>
      {linkedRef ? (
        <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--text2)' }}>
          🔗 Linked to: <b>{linkedRef.display}</b>
        </div>
      ) : null}
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Task No.</label>
          <input className="innovic-input" value={next?.code ?? '(auto on save)'} readOnly />
        </div>
        <div className="form-grp">
          <label className="form-label">Assign To ★</label>
          <select className="innovic-select" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">— Select user —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.role ? ` (${u.role})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">Priority</label>
          <select
            className="innovic-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Title ★</label>
          <input className="innovic-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Description</label>
          <input className="innovic-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detailed description" />
        </div>
        <div className="form-grp">
          <label className="form-label">Due Date ★</label>
          <input type="date" className="innovic-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      {err ? <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => void submit()}>
          {create.isPending ? 'Saving…' : 'Assign Task'}
        </button>
      </div>
    </Overlay>
  );
}

function statusColor(status: string, isOverdue: boolean): string {
  if (status === 'completed') return 'var(--green)';
  if (status === 'in_progress') return 'var(--cyan)';
  if (isOverdue) return 'var(--red)';
  return 'var(--amber)';
}

// ── View Task (read-only) ──
export function ViewTaskModal({ taskId, onClose }: { taskId: string; onClose: () => void }): React.JSX.Element {
  const { data: t, isLoading } = useTaskDetail(taskId);
  return (
    <Overlay title="📋 Task Detail" onClose={onClose} wide>
      {isLoading || !t ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <TaskView t={t} />
      )}
    </Overlay>
  );
}

function TaskView({ t }: { t: TaskDetail }): React.JSX.Element {
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: 12, background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 14 }}>
        <Fact label="TASK#" value={t.code} mono />
        <Fact label="ASSIGNED TO" value={t.assignedToName ?? '—'} />
        <Fact label="ASSIGNED BY" value={t.assignedByName ?? '—'} />
        <Fact label="PRIORITY" value={TASK_PRIORITY_LABELS[t.priority]} color={t.priority === 'high' ? 'var(--red)' : 'var(--amber)'} />
        <Fact label="DUE DATE" value={`${t.dueDate}${t.isOverdue ? ' ⚠' : ''}`} color={t.isOverdue ? 'var(--red)' : undefined} />
        <Fact label="STATUS" value={t.isOverdue ? 'Overdue' : TASK_STATUS_LABELS[t.status]} color={statusColor(t.status, t.isOverdue)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <b>{t.title}</b>
        {t.description ? <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{t.description}</div> : null}
      </div>
      <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--text3)' }}>
        Created: {t.createdDate}
        {t.startedDate ? ` → Started: ${t.startedDate}` : ''}
        {t.completedDate ? ` → Completed: ${t.completedDate}` : ''}
      </div>
      {t.linkedRef?.display ? (
        <div style={{ marginBottom: 10, fontSize: 11 }}>
          🔗 Linked to: <b>{t.linkedRef.display}</b>
        </div>
      ) : null}
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Comments</div>
      {t.comments.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 11 }}>No comments</div>
      ) : (
        t.comments.map((c) => (
          <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
            <b>{c.by}</b> <span style={{ color: 'var(--text3)' }}>{c.date}</span>
            <br />
            {c.text}
          </div>
        ))
      )}
    </div>
  );
}

function Fact({ label, value, color, mono }: { label: string; value: string; color?: string | undefined; mono?: boolean | undefined }): React.JSX.Element {
  return (
    <div>
      <span style={{ fontSize: 10, color: 'var(--text3)' }}>{label}</span>
      <br />
      <b className={mono ? 'mono' : undefined} style={color ? { color } : undefined}>
        {value}
      </b>
    </div>
  );
}

// ── Update Status (assignee or manager) ──
export function UpdateStatusModal({ task, onClose }: { task: TaskRow; onClose: () => void }): React.JSX.Element {
  const update = useUpdateTaskStatus(task.id);
  const [status, setStatus] = useState<'todo' | 'in_progress' | 'completed'>(
    task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'in_progress' : 'todo',
  );
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    try {
      await update.mutateAsync({ status, comment: comment.trim() || undefined });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed');
    }
  }

  return (
    <Overlay title={`✏ Update Task — ${task.code}`} onClose={onClose}>
      <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg3)', borderRadius: 6 }}>
        <b>{task.title}</b>
        {task.description ? (
          <>
            <br />
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{task.description}</span>
          </>
        ) : null}
      </div>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Status</label>
          <select className="innovic-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">Add Comment</label>
          <input className="innovic-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Progress note…" />
        </div>
      </div>
      {err ? <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={update.isPending} onClick={() => void submit()}>
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Overlay>
  );
}
