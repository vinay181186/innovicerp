// "+ My To-Do" — the approved board's 500px personal to-do form (ADR-176).
// Created By and Assigned To are both the caller, set server-side.

import type { TaskPriority } from '@innovic/shared';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from '@innovic/shared';
import { useState } from 'react';
import { useCreatePersonalTodo, useNextTaskCode } from '../api';
import { localDateTimeToIso } from '../lib/format';
import { FormError, FormNote, Overlay } from './task-overlay';

export function TodoModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const create = useCreatePersonalTodo();
  const { data: next } = useNextTaskCode('personal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [reminder, setReminder] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    if (!title.trim()) return setErr('To-Do Title is required');
    try {
      await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueDate: dueDate || undefined,
        reminderAt: localDateTimeToIso(reminder),
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save to-do. Try again.');
    }
  }

  return (
    <Overlay
      title={
        <>
          Create My To-Do
          {next?.code ? (
            <span className="mono text3" style={{ fontSize: 12, marginLeft: 10, fontWeight: 600 }}>
              {next.code}
            </span>
          ) : null}
        </>
      }
      size="sm"
      guard
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending}
            onClick={() => void submit()}
          >
            {create.isPending ? 'Saving…' : 'Create To-Do'}
          </button>
        </>
      }
    >
      <FormNote>Created By and Assigned To are automatically set to the logged-in user.</FormNote>

      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="td-title">
            To-Do Title<span className="req">*</span>
          </label>
          <input
            id="td-title"
            className="innovic-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="td-desc">
            Description
          </label>
          <textarea
            id="td-desc"
            className="innovic-textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="td-priority">
            Priority
          </label>
          <select
            id="td-priority"
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
          <label className="form-label" htmlFor="td-due">
            Due Date
          </label>
          <input
            id="td-due"
            type="date"
            className="innovic-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={{ maxWidth: 160 }}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="td-reminder">
            Reminder
          </label>
          <input
            id="td-reminder"
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
