// Task management popups (ADR-176): Reassign, Cancel and Edit — the
// creator's / admin's actions. Offered only when the server-computed
// `permissions` on the row allow them; every one invalidates the board.

import type { TaskPriority, TaskRow } from '@innovic/shared';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from '@innovic/shared';
import { useState } from 'react';
import { useCancelTask, useReassignTask, useTaskUserOptions, useUpdateTask } from '../api';
import { isoToLocalDateTime, localDateTimeToIso } from '../lib/format';
import { ActionFooter, TaskHead } from './task-action-common';
import { FormError, Overlay } from './task-overlay';
import { UserPicker } from './user-picker';

// ── Reassign (creator / admin) ──
export function ReassignModal({
  task,
  onClose,
}: {
  task: TaskRow;
  onClose: () => void;
}): React.JSX.Element {
  const reassign = useReassignTask(task.id);
  const { data: userOpts, isFetching } = useTaskUserOptions();
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    if (!assignedTo) return setErr('Assigned To is required.');
    try {
      await reassign.mutateAsync({ assignedTo, note: note.trim() || undefined });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reassign task. Try again.');
    }
  }

  return (
    <Overlay
      title="Reassign Task"
      size="sm"
      guard
      onClose={onClose}
      footer={
        <ActionFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={reassign.isPending}
          label="Reassign"
        />
      }
    >
      <TaskHead task={task} />
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
        Currently assigned to <b style={{ color: 'var(--text)' }}>{task.assignedToName ?? '—'}</b>
      </div>
      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label">
            Assigned To<span className="req">★</span>
          </label>
          <UserPicker
            users={userOpts?.options ?? []}
            loading={isFetching}
            value={assignedTo}
            onChange={setAssignedTo}
            excludeId={task.assignedTo}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="ra-note">
            Note
          </label>
          <input
            id="ra-note"
            className="innovic-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why it is moving…"
            maxLength={2000}
          />
        </div>
      </div>
      <FormError msg={err} />
    </Overlay>
  );
}

// ── Cancel (creator / admin) — confirm + reason ──
export function CancelModal({
  task,
  onClose,
}: {
  task: TaskRow;
  onClose: () => void;
}): React.JSX.Element {
  const cancel = useCancelTask(task.id);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    try {
      await cancel.mutateAsync({ reason: reason.trim() || undefined });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not cancel task. Try again.');
    }
  }

  return (
    <Overlay
      title="Cancel Task"
      size="sm"
      onClose={onClose}
      footer={
        <ActionFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={cancel.isPending}
          label="Cancel Task"
          danger
        />
      }
    >
      <TaskHead task={task} />
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text2)' }}>
        This closes the task as <b>Cancelled</b>. The assignee will see it in their board history;
        it cannot be reopened.
      </p>
      <div className="form-grp">
        <label className="form-label" htmlFor="cn-reason">
          Reason
        </label>
        <input
          id="cn-reason"
          className="innovic-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional"
          maxLength={2000}
        />
      </div>
      <FormError msg={err} />
    </Overlay>
  );
}

// ── Edit details (creator / admin) ──
export function EditTaskModal({
  task,
  onClose,
}: {
  task: TaskRow;
  onClose: () => void;
}): React.JSX.Element {
  const update = useUpdateTask(task.id);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [startDate, setStartDate] = useState(task.startDate ?? '');
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [reminder, setReminder] = useState(isoToLocalDateTime(task.reminderAt));
  const [err, setErr] = useState<string | null>(null);
  const personal = task.taskType === 'personal';

  async function submit(): Promise<void> {
    setErr(null);
    if (!title.trim()) return setErr('Title is required.');
    if (!personal && !dueDate) return setErr('Due Date is required.');
    if (startDate && dueDate && startDate > dueDate)
      return setErr('Start Date cannot be after Due Date.');
    try {
      await update.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        startDate: startDate || null,
        dueDate: dueDate || null,
        reminderAt: reminder ? (localDateTimeToIso(reminder) ?? null) : null,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save task. Try again.');
    }
  }

  return (
    <Overlay
      title={`Edit ${task.code}`}
      size="md"
      guard
      onClose={onClose}
      footer={
        <ActionFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={update.isPending}
          label="Save Changes"
        />
      }
    >
      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="ed-title">
            Title<span className="req">★</span>
          </label>
          <input
            id="ed-title"
            className="innovic-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="ed-desc">
            Description
          </label>
          <textarea
            id="ed-desc"
            className="innovic-textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ed-priority">
            Priority
          </label>
          <select
            id="ed-priority"
            className="innovic-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            style={{ maxWidth: 160 }}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ed-start">
            Start Date
          </label>
          <input
            id="ed-start"
            type="date"
            className="innovic-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ maxWidth: 160 }}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ed-due">
            Due Date{personal ? null : <span className="req">★</span>}
          </label>
          <input
            id="ed-due"
            type="date"
            className="innovic-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={{ maxWidth: 160 }}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ed-reminder">
            Reminder
          </label>
          <input
            id="ed-reminder"
            type="datetime-local"
            className="innovic-input"
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
            style={{ maxWidth: 220 }}
          />
        </div>
      </div>
      <FormError msg={err} />
    </Overlay>
  );
}
