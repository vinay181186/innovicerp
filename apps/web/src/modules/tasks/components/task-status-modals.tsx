// Task status popups (ADR-176): Update Status and Complete. Both are offered
// only when the server-computed `permissions` on the row allow them, and
// both invalidate the board on success.

import type { TaskAttachmentInput, TaskRow } from '@innovic/shared';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';
import { useCompleteTask, useUpdateTaskStatus } from '../api';
import { oversizedFile } from '../lib/format';
import { ActionFooter, TaskHead } from './task-action-common';
import { FormError, Overlay } from './task-overlay';

// ── Update Status (To Do / In Progress / Completed; Cancelled only via Cancel) ──
export function UpdateStatusModal({
  task,
  onClose,
}: {
  task: TaskRow;
  onClose: () => void;
}): React.JSX.Element {
  const update = useUpdateTaskStatus(task.id);
  const [status, setStatus] = useState<'todo' | 'in_progress' | 'completed'>(
    task.status === 'completed'
      ? 'completed'
      : task.status === 'in_progress'
        ? 'in_progress'
        : 'todo',
  );
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    try {
      await update.mutateAsync({ status, comment: comment.trim() || undefined });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update task. Try again.');
    }
  }

  return (
    <Overlay
      title="Update Status"
      size="sm"
      guard
      onClose={onClose}
      footer={
        <ActionFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={update.isPending}
          label="Save"
        />
      }
    >
      <TaskHead task={task} />
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" htmlFor="us-status">
            Task Status
          </label>
          <select
            id="us-status"
            className="innovic-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="us-comment">
            Remark
          </label>
          <input
            id="us-comment"
            className="innovic-input"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Progress note…"
            maxLength={2000}
          />
        </div>
      </div>
      <FormError msg={err} />
    </Overlay>
  );
}

// ── Complete (remark + optional files) ──
export function CompleteModal({
  task,
  onClose,
}: {
  task: TaskRow;
  onClose: () => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const complete = useCompleteTask(task.id);
  const [remark, setRemark] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    const big = oversizedFile(files);
    if (big) return setErr(`${big} is over 10 MB`);
    if (files.length > 10) return setErr('Up to 10 files per task');
    const companyId = me?.companyId ?? null;
    if (files.length > 0 && !companyId) return setErr('No company in session — cannot upload');
    setBusy(true);
    try {
      const attachments: TaskAttachmentInput[] = [];
      for (const f of files) {
        if (!companyId) break;
        const storagePath = await uploadFile(f, companyId, { folder: 'task-docs' });
        attachments.push({
          fileName: f.name,
          storagePath,
          fileSize: f.size,
          fileType: f.type || undefined,
        });
      }
      await complete.mutateAsync({
        remark: remark.trim() || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not complete the task');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay
      title="Complete Task"
      size="sm"
      guard
      onClose={onClose}
      footer={
        <ActionFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          label="Mark Completed"
        />
      }
    >
      <TaskHead task={task} />
      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="cp-remark">
            Completion Remark
          </label>
          <textarea
            id="cp-remark"
            className="innovic-textarea"
            rows={3}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="cp-files">
            Attachment
          </label>
          <input
            id="cp-files"
            type="file"
            multiple
            className="innovic-input"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <div className="form-help">Optional — up to 10 files, 10 MB each.</div>
        </div>
      </div>
      <FormError msg={err} />
    </Overlay>
  );
}
