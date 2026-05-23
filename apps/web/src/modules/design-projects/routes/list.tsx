// Design Projects (Design slice C) — list view.
// Mirrors legacy renderDesignProjects (HTML L7570).

import {
  type CreateDesignProjectInput,
  type DesignProjectListItem,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSalesOrdersList } from '../../sales-orders/api';
import { useCreateDesignProject, useDesignProjectsList } from '../api';

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

      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="section-hdr m-0">📋 Design Projects</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, fontSize: 12 }}
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
              <Plus size={14} /> New Project
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
      ) : data && data.items.length === 0 ? (
        <div className="empty-state" style={{ padding: 50 }}>
          📐 No design projects found.
        </div>
      ) : data ? (
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
      onClick={onClick}
      style={{
        padding: 14,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderTop: `3px solid ${color}`,
        borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
        textAlign: 'center',
      }}
    >
      <div
        className="text3"
        style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color }}>{value}</div>
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
        borderLeft: `3px solid ${borderColor}`,
        textDecoration: 'none',
        color: 'var(--text)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{project.projectName}</div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            {project.code} · {project.soCodeText ?? 'No SO'} · {project.clientText ?? ''}
          </div>
        </div>
        <StatusBadge status={project.status} />
      </div>
      {project.description ? (
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
          {project.description.length > 100
            ? project.description.slice(0, 100) + '…'
            : project.description}
        </div>
      ) : null}
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
      status: 'Design Active',
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
    <Modal onClose={onClose} title="📋 New Design Project">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Project Name ★">
          <input
            className="innovic-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Status">
          <input className="innovic-input" value="Design Active" readOnly />
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Sales Order (optional)">
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
          </Field>
        </div>
        <Field label="Client">
          <input
            className="innovic-input"
            value={client}
            onChange={(e) => setClient(e.target.value)}
          />
        </Field>
        <Field label="Design Lead">
          <input
            className="innovic-input"
            value={lead}
            onChange={(e) => setLead(e.target.value)}
            placeholder="Engineer name"
          />
        </Field>
        <Field label="Start Date">
          <input
            type="date"
            className="innovic-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Target Date ★">
          <input
            type="date"
            className="innovic-input"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Engineers (comma-separated names)">
            <input
              className="innovic-input"
              value={engineersStr}
              onChange={(e) => setEngineersStr(e.target.value)}
              placeholder="Alice, Bob, Charlie"
            />
          </Field>
        </div>
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
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Create Project" />
    </Modal>
  );
}

function Modal({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(720px, 95vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
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
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
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
    </div>
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
