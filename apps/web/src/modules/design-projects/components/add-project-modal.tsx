// Design Projects — the "New Design Project" modal (ADR-199 split out of
// routes/list.tsx so the list file stays under the 400-line ceiling). Behaviour
// is unchanged: one Design Project per SO (ADR-188) with the look-up guard,
// Fetch-from SO fills Customer while blank, the auto Project No., and the same
// required fields and server-error surfacing.

import { type CreateDesignProjectInput } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayIst } from '@/lib/date';
import { Banner } from '@/ui/feedback';
import { useSalesOrdersList } from '../../sales-orders/api';
import { useCreateDesignProject, useDesignProjectsList, useNextDesignProjectCode } from '../api';

export function AddProjectModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [soSearch, setSoSearch] = useState('');
  const [soId, setSoId] = useState<string | null>(null);
  const [client, setClient] = useState('');
  const [lead, setLead] = useState('');
  const [status, setStatus] = useState<CreateDesignProjectInput['status']>('Design Active');
  const [engineersStr, setEngineersStr] = useState('');
  const [startDate, setStartDate] = useState(todayIst());
  const [targetDate, setTargetDate] = useState('');
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const { data: soData } = useSalesOrdersList({
    search: soSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const selectedSo = useMemo(
    () => soData?.items.find((s) => s.id === soId) ?? null,
    [soData, soId],
  );
  const mut = useCreateDesignProject();
  const { data: next } = useNextDesignProjectCode();

  // One Design Project per SO (ADR-188): look up a project already on the
  // picked SO so the user is sent to it before typing the rest. The server
  // refuses a second one either way.
  const { data: soProjects } = useDesignProjectsList({
    search: selectedSo?.code,
    filter: 'all',
    limit: 20,
    offset: 0,
  });
  const existingForSo = soId
    ? ((soProjects?.items ?? []).find((p) => p.salesOrderId === soId) ?? null)
    : null;

  const onSave = (): void => {
    setErr(null);
    if (existingForSo) {
      setErr(
        `${existingForSo.soCodeText ?? 'This SO'} already has Design Project ${existingForSo.code}. Open it instead.`,
      );
      return;
    }
    if (!name.trim()) {
      setErr('Project Name is required.');
      return;
    }
    if (!targetDate) {
      setErr('Due Date is required.');
      return;
    }
    const input: CreateDesignProjectInput = {
      projectName: name.trim(),
      engineers: engineersStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      status,
      startDate,
      targetDate,
    };
    if (soId) input.salesOrderId = soId;
    if (client.trim()) input.clientText = client.trim();
    if (lead.trim()) input.leadText = lead.trim();
    if (description.trim()) input.description = description.trim();
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) =>
        setErr(e instanceof Error ? e.message : 'Could not save Design Project. Try again.'),
    });
  };

  return (
    <Modal
      onClose={onClose}
      title="New Design Project"
      footer={
        <Actions
          onClose={onClose}
          onSave={onSave}
          saving={mut.isPending}
          label="Save Design Project"
        />
      }
    >
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Project No.</label>
          <input className="innovic-input" value={next?.code ?? '(auto on save)'} readOnly />
        </div>
        <div className="form-grp">
          <label className="form-label">
            Project Name<span className="req">★</span>
          </label>
          <input className="innovic-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-grp">
          <label className="form-label">SO No.</label>
          <SearchableSelect
            value={soId}
            valueLabel={
              selectedSo ? `${selectedSo.code} — ${selectedSo.customerName ?? ''}` : undefined
            }
            options={(soData?.items ?? []).map((so) => ({
              id: so.id,
              code: so.code,
              name: so.customerName ?? '',
            }))}
            onSearch={setSoSearch}
            placeholder="Type SO No. or customer…"
            onChange={(id) => {
              setSoId(id);
              // Fetch-from: the picked SO fills Customer when it is still blank.
              const pickedSo = soData?.items.find((x) => x.id === id);
              if (pickedSo?.customerName && !client) setClient(pickedSo.customerName);
            }}
          />
        </div>
        {existingForSo ? (
          <div className="form-grp form-full">
            <Banner
              tone="warn"
              flush
              title={`${existingForSo.soCodeText ?? 'This SO'} already has a Design Project`}
            >
              <Link to="/design-projects/$id" params={{ id: existingForSo.id }} className="fw-700">
                Open {existingForSo.code} — {existingForSo.projectName}
              </Link>{' '}
              ({existingForSo.status}). An SO has one Design Project; add tasks and log hours there.
            </Banner>
          </div>
        ) : null}
        <div className="form-grp">
          <label className="form-label">Customer</label>
          <input
            className="innovic-input"
            value={client}
            onChange={(e) => setClient(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Design Lead</label>
          <input
            className="innovic-input"
            value={lead}
            onChange={(e) => setLead(e.target.value)}
            placeholder="Design engineer name"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Status</label>
          <select
            className="innovic-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as CreateDesignProjectInput['status'])}
          >
            <option value="Design Active">Design Active</option>
            <option value="On Hold">On Hold</option>
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label">Start Date</label>
          <input
            type="date"
            className="innovic-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">
            Due Date<span className="req">★</span>
          </label>
          <input
            type="date"
            className="innovic-input"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Design Engineers</label>
          <input
            className="innovic-input"
            value={engineersStr}
            onChange={(e) => setEngineersStr(e.target.value)}
            placeholder="Alice, Bob, Charlie"
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Description</label>
          <textarea
            className="innovic-textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
      {err ? <ErrorBox message={err} /> : null}
    </Modal>
  );
}

function Modal({
  onClose,
  title,
  children,
  footer,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">{title}</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

function Actions({
  onClose,
  onSave,
  saving,
  label,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
        {saving ? (
          <>
            <Loader2 size={14} className="inline animate-spin" /> Saving…
          </>
        ) : (
          label
        )}
      </button>
    </>
  );
}

function ErrorBox({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: 'var(--red3)',
        color: 'var(--red2)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}
