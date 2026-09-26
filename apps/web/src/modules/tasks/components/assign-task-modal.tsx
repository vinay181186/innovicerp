// "+ Assign Task" — the approved board's 600px form (ADR-176). Any logged-in
// user may assign; Assigned By is the caller, set server-side.
//
// `linkedRef` + `suggestedTitle` let other record screens (SO, PO, NC, JC,
// GRN, CAPA, Design Issues…) open this form pre-filled through the contextual
// AssignTaskButton, so the assignee gets a direct link (ISSUE-014). With a
// `linkedRef` the Related To / Reference No. pair is shown read-only; without
// one the user picks a type, then types to search that type's documents.

import type {
  TaskAttachmentInput,
  TaskLinkedRef,
  TaskPriority,
  TaskRelatedType,
} from '@innovic/shared';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_RELATED_TYPES,
  TASK_RELATED_TYPE_LABELS,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';
import { useCreateTask, useNextTaskCode, useRelatedOptions, useTaskUserOptions } from '../api';
import { oversizedFile, relatedNavPage } from '../lib/format';
import { FormError, FormNote, Overlay } from './task-overlay';
import { UserPicker } from './user-picker';

// A contextual link's record type as the user reads it. The shared map covers
// the Related To picker's types; the contextual Assign buttons add a few more.
const EXTRA_LINKED_TYPE_LABELS: Record<string, string> = {
  purchase_request: 'Purchase Request',
  grn: 'GRN',
  capa: 'CAPA',
  design_issue: 'Design Issue',
};
function linkedTypeLabel(type: string): string {
  return (
    TASK_RELATED_TYPE_LABELS[type as TaskRelatedType] ??
    EXTRA_LINKED_TYPE_LABELS[type] ??
    type.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())
  );
}

export function AssignTaskModal({
  onClose,
  linkedRef,
  suggestedTitle,
}: {
  onClose: () => void;
  linkedRef?: TaskLinkedRef | null | undefined;
  suggestedTitle?: string | undefined;
}): React.JSX.Element {
  const { data: me } = useSession();
  const create = useCreateTask();
  const { data: next } = useNextTaskCode('assigned');
  const { data: userOpts, isFetching: usersLoading } = useTaskUserOptions();
  const users = userOpts?.options ?? [];

  const [title, setTitle] = useState(suggestedTitle ?? '');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  // Related To + Reference No. — dependent pair: changing the type clears the
  // picked document (never a stale reference from the previous type).
  const [relatedType, setRelatedType] = useState<TaskRelatedType | ''>('');
  const [relatedId, setRelatedId] = useState<string | null>(null);
  const [relatedCode, setRelatedCode] = useState('');
  const [relatedSearch, setRelatedSearch] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: relOpts, isFetching: relLoading } = useRelatedOptions(
    relatedType,
    relatedSearch,
    !linkedRef,
  );
  const relatedOptions = useMemo(
    () =>
      (relOpts?.options ?? []).map((o) =>
        o.hint ? { id: o.id, code: o.code, name: o.hint } : { id: o.id, name: o.code },
      ),
    [relOpts],
  );

  function changeRelatedType(v: string): void {
    setRelatedType(v as TaskRelatedType | '');
    setRelatedId(null);
    setRelatedCode('');
    setRelatedSearch('');
  }

  async function submit(): Promise<void> {
    setErr(null);
    if (!title.trim()) return setErr('Task Title is required');
    if (!assignedTo) return setErr('Select who the task is assigned to');
    if (!dueDate) return setErr('Due Date is required');
    if (startDate && startDate > dueDate) return setErr('Start Date cannot be after Due Date');
    if (relatedType && !relatedId) return setErr('Pick the Reference No. for the Related To type');
    const big = oversizedFile(files);
    if (big) return setErr(`${big} is over 10 MB`);
    if (files.length > 10) return setErr('Up to 10 files per task');
    const companyId = me?.companyId ?? null;
    if (files.length > 0 && !companyId) return setErr('No company in session — cannot upload');

    let ref: TaskLinkedRef | undefined;
    if (linkedRef) ref = linkedRef;
    else if (relatedType && relatedId) {
      ref = {
        type: relatedType,
        id: relatedId,
        display: relatedCode,
        navPage: relatedNavPage(relatedType, relatedId),
      };
    }

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
      await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        assignedTo,
        priority,
        startDate: startDate || undefined,
        dueDate,
        linkedRef: ref,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not assign task. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay
      title={
        <>
          Assign Task
          {next?.code ? (
            <span className="mono text3" style={{ fontSize: 12, marginLeft: 10, fontWeight: 600 }}>
              {next.code}
            </span>
          ) : null}
        </>
      }
      size="md"
      guard
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Saving…' : 'Assign Task'}
          </button>
        </>
      }
    >
      <FormNote>Assigned By is automatically the logged-in user.</FormNote>

      <div className="form-grid">
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="tk-title">
            Task Title<span className="req">*</span>
          </label>
          <input
            id="tk-title"
            className="innovic-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label" htmlFor="tk-desc">
            Description
          </label>
          <textarea
            id="tk-desc"
            className="innovic-textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </div>

        <div className="form-grp">
          <label className="form-label">
            Assigned To<span className="req">*</span>
          </label>
          <UserPicker
            users={users}
            loading={usersLoading}
            value={assignedTo}
            onChange={setAssignedTo}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="tk-priority">
            Priority
          </label>
          <select
            id="tk-priority"
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
          <label className="form-label" htmlFor="tk-start">
            Start Date
          </label>
          <input
            id="tk-start"
            type="date"
            className="innovic-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ maxWidth: 160 }}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="tk-due">
            Due Date<span className="req">*</span>
          </label>
          <input
            id="tk-due"
            type="date"
            className="innovic-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={{ maxWidth: 160 }}
          />
        </div>

        {linkedRef ? (
          <>
            <div className="form-grp">
              <label className="form-label">Related To</label>
              <input className="innovic-input" value={linkedTypeLabel(linkedRef.type)} readOnly />
            </div>
            <div className="form-grp">
              <label className="form-label">Reference No.</label>
              <input className="innovic-input mono fw-700" value={linkedRef.display} readOnly />
            </div>
          </>
        ) : (
          <>
            <div className="form-grp">
              <label className="form-label" htmlFor="tk-reltype">
                Related To
              </label>
              <select
                id="tk-reltype"
                className="innovic-select"
                value={relatedType}
                onChange={(e) => changeRelatedType(e.target.value)}
              >
                <option value="">None</option>
                {TASK_RELATED_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TASK_RELATED_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Reference No.</label>
              {/* Keyed on the type so a type change remounts the picker: the
                  typed text goes with the cleared value, never a stale ref. */}
              <SearchableSelect
                key={relatedType}
                value={relatedId}
                valueLabel={relatedCode || undefined}
                options={relatedOptions}
                onSearch={setRelatedSearch}
                loading={relLoading}
                disabled={relatedType === ''}
                placeholder={relatedType ? 'e.g. JC-26-00001' : 'Choose Related To first'}
                selectedLabel={(o) => o.code ?? o.name}
                onChange={(id) => {
                  setRelatedId(id);
                  const picked = relOpts?.options.find((o) => o.id === id);
                  setRelatedCode(picked?.code ?? '');
                }}
              />
            </div>
          </>
        )}

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="tk-files">
            Attachment
          </label>
          <input
            id="tk-files"
            type="file"
            multiple
            className="innovic-input"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <div className="form-help">Up to 10 files, 10 MB each.</div>
        </div>
      </div>

      <FormError msg={err} />
    </Overlay>
  );
}
