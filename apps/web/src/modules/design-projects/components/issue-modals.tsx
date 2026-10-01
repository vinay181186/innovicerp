// Design Project — Issue add/edit form + the read-only Issue view with its
// discussion thread. Split out of detail.tsx (ADR-199); behaviour unchanged.

import {
  type CreateDesignIssueInput,
  DESIGN_ISSUE_SEVERITIES,
  DESIGN_ISSUE_STATUSES,
  type DesignIssue,
  type DesignIssueStatus,
  type DesignTask,
} from '@innovic/shared';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { useAddDesignIssueComment, useCreateDesignIssue, useUpdateDesignIssue } from '../api';
import { Actions, Badge, ErrorBox, Field, Modal } from './detail-shared';

export function IssueFormModal({
  projectId,
  tasks,
  mode,
  issue,
  onClose,
}: {
  projectId: string;
  tasks: DesignTask[];
  mode: 'add' | 'edit';
  issue?: DesignIssue;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(issue?.title ?? '');
  const [taskId, setTaskId] = useState(issue?.designTaskId ?? '');
  const [part, setPart] = useState(issue?.partText ?? '');
  const [severity, setSeverity] = useState<DesignIssue['severity']>(issue?.severity ?? 'Major');
  const [status, setStatus] = useState<DesignIssue['status']>(issue?.status ?? 'Open');
  const [raisedBy, setRaisedBy] = useState(issue?.raisedByText ?? '');
  const [assignedTo, setAssignedTo] = useState(issue?.assignedToText ?? '');
  const [description, setDescription] = useState(issue?.description ?? '');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useCreateDesignIssue();
  const updateMut = useUpdateDesignIssue();

  const onSave = (): void => {
    setErr(null);
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    if (mode === 'add') {
      const input: CreateDesignIssueInput = {
        title: title.trim(),
        severity,
        status,
      };
      if (taskId) input.designTaskId = taskId;
      if (part.trim()) input.partText = part.trim();
      if (raisedBy.trim()) input.raisedByText = raisedBy.trim();
      if (assignedTo.trim()) input.assignedToText = assignedTo.trim();
      if (description.trim()) input.description = description.trim();
      createMut.mutate(
        { projectId, input },
        {
          onSuccess: () => onClose(),
          onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save. Try again.'),
        },
      );
    } else if (issue) {
      updateMut.mutate(
        {
          id: issue.id,
          input: {
            title: title.trim(),
            severity,
            status: status as DesignIssueStatus,
            partText: part,
            designTaskId: taskId || null,
            assignedToText: assignedTo,
            description,
          },
        },
        {
          onSuccess: () => onClose(),
          onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save. Try again.'),
        },
      );
    }
  };

  return (
    <Modal onClose={onClose} title={mode === 'add' ? 'Raise Issue' : 'Edit Issue'}>
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
        <Field label="Linked Task">
          <select
            className="innovic-select"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">— None —</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Item Name">
          <input className="innovic-input" value={part} onChange={(e) => setPart(e.target.value)} />
        </Field>
        <Field label="Severity">
          <select
            className="innovic-select"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as DesignIssue['severity'])}
          >
            {DESIGN_ISSUE_SEVERITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        {mode === 'edit' ? (
          <Field label="Issue Status">
            <select
              className="innovic-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as DesignIssue['status'])}
            >
              {DESIGN_ISSUE_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Raised By">
          <input
            className="innovic-input"
            value={raisedBy}
            onChange={(e) => setRaisedBy(e.target.value)}
          />
        </Field>
        <Field label="Assigned To">
          <input
            className="innovic-input"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
          />
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Description">
            <textarea
              className="innovic-input"
              rows={3}
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
        label={mode === 'add' ? 'Save Issue' : 'Save Changes'}
      />
    </Modal>
  );
}

export function ViewIssueModal({
  issue,
  onClose,
}: {
  issue: DesignIssue;
  onClose: () => void;
}): React.JSX.Element {
  const [comment, setComment] = useState('');
  const commentMut = useAddDesignIssueComment();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnissue_create');

  const onPost = (): void => {
    if (!comment.trim()) return;
    commentMut.mutate(
      { id: issue.id, input: { text: comment.trim() } },
      {
        onSuccess: () => setComment(''),
      },
    );
  };

  const ageMs = Date.now() - new Date(issue.raisedDate).getTime();
  const ageDays = Math.max(0, Math.round(ageMs / 86400000));

  return (
    <Modal onClose={onClose} title={issue.title}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Severity
          </div>
          <Badge value={issue.severity} />
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Issue Status
          </div>
          <Badge value={issue.status} kind="status" />
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Assigned To
          </div>
          <div style={{ fontWeight: 600 }}>{issue.assignedToText ?? ''}</div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Raised Date
          </div>
          <div>
            {fmtDate(issue.raisedDate)} ({ageDays}d)
          </div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11 }}>
            Resolved Date
          </div>
          <div>{fmtDate(issue.resolvedDate)}</div>
        </div>
      </div>
      <div>
        <div className="text3" style={{ fontSize: 11 }}>
          Description
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
          {issue.description ?? '—'}
        </div>
      </div>

      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
          💬 Discussion ({issue.discussions.length})
        </div>
        {issue.discussions.map((d, idx) => (
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
