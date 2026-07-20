// Design Projects (Design slice C) — list view.
// Mirrors legacy renderDesignProjects (HTML L7570).

import {
  type CreateDesignProjectInput,
  type DesignProjectListItem,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSalesOrdersList } from '../../sales-orders/api';
import {
  useCreateDesignProject,
  useDesignProjectsList,
  useNextDesignProjectCode,
} from '../api';

type FilterKey = 'all' | 'active' | 'released' | 'hold';

export const designProjectsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-projects',
  component: DesignProjectsListPage,
});

function DesignProjectsListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isError, error } = useDesignProjectsList({
    search: search.trim() || undefined,
    filter,
    limit: 100,
    offset: 0,
  });
  const summary = data?.summary ?? {
    total: 0,
    active: 0,
    released: 0,
    onHold: 0,
    totalTasks: 0,
    doneTasks: 0,
    openIssues: 0,
  };

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Tile label="Total" value={summary.total} color="var(--blue)" onClick={() => setFilter('all')} />
        <Tile
          label="Active"
          value={summary.active}
          color="var(--cyan)"
          onClick={() => setFilter('active')}
        />
        <Tile
          label="Released"
          value={summary.released}
          color="var(--green)"
          onClick={() => setFilter('released')}
        />
        <Tile label="Tasks Done" value={`${summary.doneTasks}/${summary.totalTasks}`} color="var(--purple)" />
        <Tile
          label="Open Issues"
          value={summary.openIssues}
          color={summary.openIssues > 0 ? 'var(--red)' : 'var(--green)'}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📋 Design Projects
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 160, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
            style={{ fontSize: 12 }}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="released">Released</option>
            <option value="hold">On Hold</option>
          </select>
          {canWrite ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAdd(true)}
            >
              + New Project
            </button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load projects'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: 14,
            }}
          >
            {data.items.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
          {data.items.length === 0 ? (
            <div className="empty-state" style={{ padding: 50 }}>
              📐 No design projects found.
            </div>
          ) : null}
        </>
      ) : null}

      {showAdd ? <AddProjectModal onClose={() => setShowAdd(false)} /> : null}
    </div>
  );
}

function Tile({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: number | string;
  color: string;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <div
      className="panel"
      onClick={onClick}
      style={{
        textAlign: 'center',
        padding: 14,
        ...(onClick ? { cursor: 'pointer' } : {}),
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ProjectCard({ project }: { project: DesignProjectListItem }): React.JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = project.targetDate < today && project.status !== 'Released';
  const borderColor =
    project.status === 'Released'
      ? 'var(--green)'
      : project.status === 'On Hold'
        ? 'var(--amber)'
        : 'var(--blue)';
  return (
    <Link
      to="/design-projects/$id"
      params={{ id: project.id }}
      className="panel"
      style={{
        padding: 16,
        cursor: 'pointer',
        transition: 'all .15s',
        borderLeft: `3px solid ${borderColor}`,
        textDecoration: 'none',
        color: 'var(--text)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{project.projectName}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {project.code} • {project.soCodeText ?? 'No SO'} • {project.clientText ?? ''}
          </div>
        </div>
        <StatusBadge status={project.status} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
        {(project.description ?? '').substring(0, 100)}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginTop: 8,
          fontSize: 11,
        }}
      >
        <span className="text3">👤 {project.leadText ?? ''}</span>
        <span style={{ color: isOverdue ? 'var(--red)' : 'var(--text3)' }}>
          📅 {project.targetDate}
          {isOverdue ? ' ⚠' : ''}
        </span>
        {project.openIssuesCount > 0 ? (
          <span style={{ color: 'var(--red)', fontWeight: 700 }}>
            ⚠ {project.openIssuesCount} open
          </span>
        ) : null}
      </div>
      <div style={{ marginTop: 10 }}>
        <div
          style={{
            height: 4,
            background: 'var(--bg4)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${project.taskProgressPct}%`,
              background:
                project.taskProgressPct === 100 ? 'var(--green)' : 'var(--blue)',
              borderRadius: 2,
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: 'var(--text3)',
            marginTop: 3,
          }}
        >
          <span>
            {project.taskDone}/{project.taskTotal} tasks
          </span>
          <span>{project.taskProgressPct}%</span>
        </div>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const v = status.toLowerCase().replace(/[\s/]/g, '');
  const colors: Record<string, string> = {
    designactive: 'var(--blue)',
    inreview: 'var(--purple)',
    released: 'var(--green)',
    onhold: 'var(--amber)',
  };
  const c = colors[v] ?? 'var(--text3)';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 9px',
        borderRadius: 12,
        fontSize: 10,
        fontWeight: 700,
        color: c,
        background: `${c}12`,
        border: `1px solid ${c}30`,
      }}
    >
      {status}
    </span>
  );
}

// ─── Add modal ────────────────────────────────────────────────────────────

function AddProjectModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [soSearch, setSoSearch] = useState('');
  const [soId, setSoId] = useState<string | null>(null);
  const [client, setClient] = useState('');
  const [lead, setLead] = useState('');
  const [status, setStatus] = useState<CreateDesignProjectInput['status']>('Design Active');
  const [engineersStr, setEngineersStr] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
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

  const onSave = (): void => {
    setErr(null);
    if (!name.trim()) {
      setErr('Enter project name');
      return;
    }
    if (!targetDate) {
      setErr('Set target date');
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
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
    });
  };

  return (
    <Modal
      onClose={onClose}
      title="📋 New Design Project"
      footer={<Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Save" />}
    >
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Project No.</label>
          <input
            className="innovic-input"
            value={next?.code ?? '(auto on save)'}
            readOnly
          />
        </div>
        <div className="form-grp">
          <label className="form-label">
            Project Name<span className="req">★</span>
          </label>
          <input
            className="innovic-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Sales Order</label>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Type SO code or customer…"
            value={
              selectedSo
                ? `${selectedSo.code} — ${selectedSo.customerName ?? ''}`
                : soSearch
            }
            onChange={(e) => {
              setSoId(null);
              setSoSearch(e.target.value);
              // Auto-fill client from SO when an SO is picked
            }}
          />
          {!soId && soSearch && soData ? (
            <Picklist
              items={soData.items.slice(0, 20).map((s) => ({
                id: s.id,
                label: `${s.code} — ${s.customerName ?? ''}`,
                sub: null,
              }))}
              onPick={(id) => {
                setSoId(id);
                setSoSearch('');
                const pickedSo = soData.items.find((x) => x.id === id);
                if (pickedSo?.customerName && !client) setClient(pickedSo.customerName);
              }}
            />
          ) : null}
        </div>
        <div className="form-grp">
          <label className="form-label">Client</label>
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
            placeholder="Engineer name"
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
            Target Date<span className="req">★</span>
          </label>
          <input
            type="date"
            className="innovic-input"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">Engineers</label>
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
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}

function Picklist({
  items,
  onPick,
}: {
  items: Array<{ id: string; label: string; sub: string | null }>;
  onPick: (id: string) => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: 'var(--bg2)',
        marginTop: 4,
        maxHeight: 180,
        overflowY: 'auto',
      }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          onClick={() => onPick(it.id)}
          style={{
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: 12,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{it.label}</span>
          {it.sub ? (
            <span style={{ color: 'var(--text3)', marginLeft: 6 }}>· {it.sub}</span>
          ) : null}
        </div>
      ))}
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
        background: 'rgba(239,68,68,0.08)',
        color: 'var(--red)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}
