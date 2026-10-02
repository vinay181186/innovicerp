// Design Project — Task add/edit form + the read-only Task view with its
// discussion thread. Split out of detail.tsx (ADR-199); behaviour unchanged.

import {
  type CreateDesignTaskInput,
  DESIGN_PRIORITIES,
  DESIGN_TASK_STATUSES,
  type DesignIssue,
  type DesignTask,
} from '@innovic/shared';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { useAddDesignTaskComment, useCreateDesignTask, useUpdateDesignTask } from '../api';
import { Actions, Badge, ErrorBox, Field, Modal } from './detail-shared';

export function TaskFormModal({
  projectId,
  mode,
  task,
  onClose,
}: {
  projectId: string;
  mode: 'add' | 'edit';
  task?: DesignTask;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(task?.title ?? '');
  const [part, setPart] = useState(task?.partText ?? '');
  const [assignee, setAssignee] = useState(task?.assigneeText ?? '');
  const [priority, setPriority] = useState<DesignTask['priority']>(task?.priority ?? 'Medium');
  const [status, setStatus] = useState<DesignTask['status']>(task?.status ?? 'Not Started');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useCreateDesignTask();
  const updateMut = useUpdateDesignTask();

  const onSave = (): void => {
    setErr(null);
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    const input: CreateDesignTaskInput = {
      title: title.trim(),
      priority,
      status,
    };
    if (part.trim()) input.partText = part.trim();
    if (assignee.trim()) input.assigneeText = assignee.trim();
    if (dueDate) input.dueDate = dueDate;
    if (description.trim()) input.description = description.trim();

    if (mode === 'add') {
      createMut.mutate(
        { projectId, input },
        {
          onSuccess: () => onClose(),
          onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save. Try again.'),
        },
      );
    } else if (task) {
      updateMut.mutate(
        { id: task.id, input },
        {
          onSuccess: () => onClose(),
          onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save. Try again.'),
        },
      );
    }
  };

  return (
    <Modal onClose={onClose} title={mode === 'add' ? '📝 Add Task' : '✏ Edit Task'}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Title ★">
            <input
              className="innovic-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Item Name">
          <input className="innovic-input" value={part} onChange={(e) => setPart(e.target.value)} />
        </Field>
        <Field label="Assignee">
          <input
            className="innovic-input"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="Design engineer name"
          />
        </Field>
        <Field label="Priority">
          <select
            className="innovic-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as DesignTask['priority'])}
          >
            {DESIGN_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Task Status">
          <select
            className="innovic-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as DesignTask['status'])}
          >
            {DESIGN_TASK_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Due Date">
          <input
            type="date"
            className="innovic-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Description">
            <textarea
              className="innovic-input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>
      {err ? <ErrorBox message={err} /> : null}
      <Actions
        onClose={onClose}
        onSave={onSave}
        saving={createMut.isPending || updateMut.isPending}
        label={mode === 'add' ? 'Save Task' : 'Save Changes'}
      />
    </Modal>
  );
}

export function ViewTaskModal({
  task,
  issues,
  onClose,
}: {
  task: DesignTask;
  issues: DesignIssue[];
  onClose: () => void;
}): React.JSX.Element {
  const [comment, setComment] = useState('');
  const commentMut = useAddDesignTaskComment();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnproj_create');

  const onPost = (): void => {
    if (!comment.trim()) return;
    commentMut.mutate(
      { id: task.id, input: { text: comment.trim() } },
      {
        onSuccess: () => setComment(''),
      },
    );
  };

  return (
    <Modal onClose={onClose} title={`📝 ${task.title}`}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Assignee
          </div>
          <div style={{ fontWeight: 600 }}>{task.assigneeText ?? ''}</div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Item Name
          </div>
          <div>{task.partText ?? '—'}</div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Priority
          </div>
          <Badge value={task.priority} />
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Due Date
          </div>
          <div>{fmtDate(task.dueDate)}</div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Task Status
          </div>
          <Badge value={task.status} kind="status" />
        </div>
      </div>
      <div>
        <div className="text3" style={{ fontSize: 11 }}>
          Description
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
          {task.description ?? '—'}
        </div>
      </div>

      {issues.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red2)', marginBottom: 6 }}>
            ⚠ Issues ({issues.length})
          </div>
          {issues.map((i) => (
            <div
              key={i.id}
              style={{
                padding: '6px 10px',
                background: 'var(--bg3)',
                borderRadius: 4,
                marginBottom: 3,
                fontSize: 12,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{i.title}</span>
              <Badge value={i.status} kind="status" />
            </div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 14,
          borderTop: '1px solid var(--border)',
          paddingTop: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
          💬 Discussion ({task.discussions.length})
        </div>
        {task.discussions.map((d, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'var(--blue3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--blue)',
                flexShrink: 0,
              }}
            >
              {(d.author || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700 }}>
                {d.author} <span className="text3">{fmtDate(d.date)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{d.text}</div>
            </div>
          </div>
        ))}
        {perms.edit ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              className="innovic-input"
              placeholder="Add comment…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onPost}
              disabled={commentMut.isPending}
            >
              Post
            </button>
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
