// Design Project — DCR and DCN add/edit forms. Split out of detail.tsx
// (ADR-199); behaviour unchanged.

import {
  type CreateDesignDcnInput,
  type CreateDesignDcrInput,
  DESIGN_DCN_STATUSES,
  DESIGN_DCR_CHANGE_TYPES,
  DESIGN_DCR_PRIORITIES,
  DESIGN_DCR_STATUSES,
  type DesignDcn,
  type DesignDcr,
} from '@innovic/shared';
import { useState } from 'react';
import { todayIst } from '@/lib/date';
import {
  useCreateDesignDcn,
  useCreateDesignDcr,
  useUpdateDesignDcn,
  useUpdateDesignDcr,
} from '../api';
import { Actions, ErrorBox, Field, Modal } from './detail-shared';

export function DcrFormModal({
  projectId,
  mode,
  dcr,
  onClose,
}: {
  projectId: string;
  mode: 'add' | 'edit';
  dcr?: DesignDcr;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(dcr?.title ?? '');
  const [changeType, setChangeType] = useState(dcr?.changeType ?? 'Other');
  const [partAffected, setPartAffected] = useState(dcr?.partAffected ?? '');
  const [priority, setPriority] = useState(dcr?.priority ?? 'Normal');
  const [status, setStatus] = useState(dcr?.status ?? 'Submitted');
  const [requestedBy, setRequestedBy] = useState(dcr?.requestedByText ?? '');
  const [requestDate, setRequestDate] = useState(dcr?.requestDate ?? todayIst());
  const [description, setDescription] = useState(dcr?.description ?? '');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useCreateDesignDcr();
  const updateMut = useUpdateDesignDcr();

  const onSave = (): void => {
    setErr(null);
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    if (mode === 'add') {
      const input: CreateDesignDcrInput = {
        title: title.trim(),
        changeType,
        priority,
        requestDate,
      };
      if (partAffected.trim()) input.partAffected = partAffected.trim();
      if (requestedBy.trim()) input.requestedByText = requestedBy.trim();
      if (description.trim()) input.description = description.trim();
      createMut.mutate(
        { projectId, input },
        {
          onSuccess: () => onClose(),
          onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save. Try again.'),
        },
      );
    } else if (dcr) {
      updateMut.mutate(
        {
          id: dcr.id,
          input: {
            title: title.trim(),
            changeType,
            partAffected,
            priority,
            status,
            requestDate,
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
    <Modal
      onClose={onClose}
      title={mode === 'add' ? '📋 New DCR' : `✏ Edit DCR ${dcr?.code ?? ''}`}
    >
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
        <Field label="Change Type">
          <select
            className="innovic-select"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value as DesignDcr['changeType'])}
          >
            {DESIGN_DCR_CHANGE_TYPES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Item Name">
          <input
            className="innovic-input"
            value={partAffected}
            onChange={(e) => setPartAffected(e.target.value)}
          />
        </Field>
        <Field label="Priority">
          <select
            className="innovic-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as DesignDcr['priority'])}
          >
            {DESIGN_DCR_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        {mode === 'edit' ? (
          <Field label="DCR Status">
            <select
              className="innovic-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as DesignDcr['status'])}
            >
              {DESIGN_DCR_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Requested By">
          <input
            className="innovic-input"
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
          />
        </Field>
        <Field label="Request Date">
          <input
            type="date"
            className="innovic-input"
            value={requestDate}
            onChange={(e) => setRequestDate(e.target.value)}
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
        label={mode === 'add' ? 'Save DCR' : 'Save Changes'}
      />
    </Modal>
  );
}

export function DcnFormModal({
  projectId,
  dcrs,
  mode,
  dcn,
  onClose,
}: {
  projectId: string;
  dcrs: DesignDcr[];
  mode: 'add' | 'edit';
  dcn?: DesignDcn;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(dcn?.title ?? '');
  const [linkedDcrId, setLinkedDcrId] = useState(dcn?.linkedDcrId ?? '');
  const [status, setStatus] = useState(dcn?.status ?? 'Draft');
  const [description, setDescription] = useState(dcn?.description ?? '');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useCreateDesignDcn();
  const updateMut = useUpdateDesignDcn();

  const onSave = (): void => {
    setErr(null);
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    if (mode === 'add') {
      const input: CreateDesignDcnInput = {
        title: title.trim(),
      };
      if (linkedDcrId) input.linkedDcrId = linkedDcrId;
      if (description.trim()) input.description = description.trim();
      createMut.mutate(
        { projectId, input },
        {
          onSuccess: () => onClose(),
          onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save. Try again.'),
        },
      );
    } else if (dcn) {
      updateMut.mutate(
        {
          id: dcn.id,
          input: {
            title: title.trim(),
            status,
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
    <Modal
      onClose={onClose}
      title={mode === 'add' ? '📝 New DCN' : `✏ Edit DCN ${dcn?.code ?? ''}`}
    >
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
        <Field label="Linked DCR">
          <select
            className="innovic-select"
            value={linkedDcrId}
            onChange={(e) => setLinkedDcrId(e.target.value)}
          >
            <option value="">— None —</option>
            {dcrs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.title}
              </option>
            ))}
          </select>
        </Field>
        {mode === 'edit' ? (
          <Field label="DCN Status">
            <select
              className="innovic-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as DesignDcn['status'])}
            >
              {DESIGN_DCN_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        ) : null}
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
        label={mode === 'add' ? 'Save DCN' : 'Save Changes'}
      />
    </Modal>
  );
}
