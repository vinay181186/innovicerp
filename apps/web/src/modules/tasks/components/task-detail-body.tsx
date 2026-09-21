// Task Detail body (ADR-176): the header row (Task#, status pill, priority),
// the two-column facts, then Attachments (click → preview; "+ Add file" when
// allowed), Remarks (list + add box when allowed) and the Timeline from
// task_history, newest last.

import type { TaskDetail, TaskHistoryEntry } from '@innovic/shared';
import { TASK_HISTORY_ACTION_LABELS, TASK_PRIORITY_LABELS } from '@innovic/shared';
import { useMemo, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';
import { useAddTaskAttachment, useAddTaskComment } from '../api';
import {
  fmtTaskDate,
  fmtTaskDateTimeFull,
  oversizedFile,
  priorityColor,
  statusPill,
} from '../lib/format';
import { RelatedRefLink } from './related-ref-link';

function Fact({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}): React.JSX.Element {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <div className="form-label" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        margin: '16px 0 6px',
        paddingBottom: 4,
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {children}
    </div>
  );
}

function historyLine(h: TaskHistoryEntry): string {
  const parts: string[] = [TASK_HISTORY_ACTION_LABELS[h.action]];
  if (h.fromValue || h.toValue) parts.push(`${h.fromValue ?? '—'} → ${h.toValue ?? '—'}`);
  if (h.note) parts.push(h.note);
  return parts.join(' · ');
}

export function TaskBody({
  t,
  onPreview,
}: {
  t: TaskDetail;
  onPreview: (a: TaskDetail['attachments'][number]) => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const pill = statusPill(t);
  const addComment = useAddTaskComment(t.id);
  const addAttachment = useAddTaskAttachment(t.id);
  const [remark, setRemark] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Timeline newest LAST — read top to bottom like a log.
  const history = useMemo(
    () => [...t.history].sort((a, b) => a.at.localeCompare(b.at)),
    [t.history],
  );

  async function sendRemark(): Promise<void> {
    setMsg(null);
    if (!remark.trim()) return;
    try {
      await addComment.mutateAsync({ text: remark.trim() });
      setRemark('');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not add the remark');
    }
  }

  async function addFiles(list: FileList | null): Promise<void> {
    setMsg(null);
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const big = oversizedFile(files);
    if (big) return setMsg(`${big} is over 10 MB`);
    const companyId = me?.companyId ?? null;
    if (!companyId) return setMsg('No company in session — cannot upload');
    setUploading(true);
    try {
      for (const f of files) {
        const storagePath = await uploadFile(f, companyId, { folder: 'task-docs' });
        await addAttachment.mutateAsync({
          fileName: f.name,
          storagePath,
          fileSize: f.size,
          fileType: f.type || undefined,
        });
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div>
      {/* Header row: Task#, status pill, priority */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <span className="mono fw-700" style={{ fontSize: 15, color: 'var(--blue)' }}>
          {t.code}
        </span>
        <span className={pill.cls}>{pill.label}</span>
        <span style={{ fontWeight: 700, fontSize: 12, color: priorityColor(t.priority) }}>
          {TASK_PRIORITY_LABELS[t.priority]}
        </span>
        {t.taskType === 'personal' ? <span className="badge b-grey">My To-Do</span> : null}
        <span className="text3" style={{ fontSize: 11, marginLeft: 'auto' }}>
          Last update {fmtTaskDateTimeFull(t.updatedAt)}
        </span>
      </div>

      {/* Facts */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px 16px',
          padding: 12,
          background: 'var(--bg3)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius2)',
        }}
      >
        <Fact label="Title" full>
          <b>{t.title}</b>
        </Fact>
        <Fact label="Description" full>
          {t.description ? (
            <span style={{ whiteSpace: 'pre-wrap', color: 'var(--text2)' }}>{t.description}</span>
          ) : (
            <span className="text3">—</span>
          )}
        </Fact>
        <Fact label="Created By">{t.createdByName ?? '—'}</Fact>
        <Fact label="Assigned To">{t.assignedToName ?? '—'}</Fact>
        <Fact label="Assigned By">{t.assignedByName ?? '—'}</Fact>
        <Fact label="Created">{fmtTaskDateTimeFull(t.createdAt)}</Fact>
        <Fact label="Start Date">{fmtTaskDate(t.startDate)}</Fact>
        <Fact label="Due Date">
          <span style={{ fontWeight: 700, color: t.isOverdue ? 'var(--red)' : 'var(--text)' }}>
            {fmtTaskDate(t.dueDate)}
            {t.isOverdue ? ' ⚠' : ''}
          </span>
        </Fact>
        <Fact label="Reminder">{fmtTaskDateTimeFull(t.reminderAt)}</Fact>
        <Fact label="Related To">
          <RelatedRefLink linkedRef={t.linkedRef} />
        </Fact>
        {t.status === 'completed' ? (
          <Fact label="Completion" full>
            <span style={{ color: 'var(--green2)', fontWeight: 700 }}>
              {fmtTaskDateTimeFull(t.completedAt)} by {t.completedByName ?? '—'}
            </span>
            {t.completionRemark ? (
              <div style={{ color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>
                {t.completionRemark}
              </div>
            ) : null}
          </Fact>
        ) : null}
      </div>

      {/* Attachments */}
      <SectionTitle>
        <span>📎 Attachments ({t.attachments.length})</span>
        {t.permissions.canAttach ? (
          <span>
            <input
              ref={fileRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void addFiles(e.target.files)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Uploading…' : '+ Add file'}
            </button>
          </span>
        ) : null}
      </SectionTitle>
      {t.attachments.length === 0 ? (
        <div className="text3" style={{ fontSize: 11 }}>
          No attachments
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {t.attachments.map((a) => (
            <button
              key={a.id}
              type="button"
              className="btn btn-ghost btn-sm"
              title={`${a.fileName} · added by ${a.uploadedBy} ${fmtTaskDateTimeFull(a.createdAt)}`}
              onClick={() => onPreview(a)}
            >
              📄 {a.fileName}
            </button>
          ))}
        </div>
      )}

      {/* Remarks */}
      <SectionTitle>
        <span>💬 Remarks ({t.comments.length})</span>
      </SectionTitle>
      {t.comments.length === 0 ? (
        <div className="text3" style={{ fontSize: 11 }}>
          No remarks
        </div>
      ) : (
        t.comments.map((c) => (
          <div
            key={c.id}
            style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}
          >
            <b>{c.by}</b>{' '}
            <span className="text3" style={{ fontSize: 11 }}>
              {fmtTaskDateTimeFull(c.createdAt)}
            </span>
            <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
          </div>
        ))
      )}
      {t.permissions.canComment ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            className="innovic-input"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Add a remark…"
            maxLength={2000}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendRemark();
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={addComment.isPending || !remark.trim()}
            onClick={() => void sendRemark()}
          >
            Add
          </button>
        </div>
      ) : null}

      {/* Timeline */}
      <SectionTitle>
        <span>🕒 Timeline ({history.length})</span>
      </SectionTitle>
      {history.length === 0 ? (
        <div className="text3" style={{ fontSize: 11 }}>
          No history
        </div>
      ) : (
        <div style={{ fontSize: 12 }}>
          {history.map((h) => (
            <div
              key={h.id}
              style={{
                display: 'flex',
                gap: 10,
                padding: '4px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span
                className="mono text3"
                style={{ fontSize: 11, whiteSpace: 'nowrap', minWidth: 130 }}
              >
                {fmtTaskDateTimeFull(h.at)}
              </span>
              <span style={{ flex: 1 }}>{historyLine(h)}</span>
              <span className="text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                by {h.by}
              </span>
            </div>
          ))}
        </div>
      )}

      {msg ? (
        <div role="alert" className="form-error" style={{ marginTop: 8 }}>
          {msg}
        </div>
      ) : null}
    </div>
  );
}
