// Design Projects (Design slice C) — list view.
// Mirrors legacy renderDesignProjects (HTML L7570).

import { type CreateDesignProjectInput, type DesignProjectListItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, todayIst } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useSalesOrdersList } from '../../sales-orders/api';
import { useCreateDesignProject, useDesignProjectsList, useNextDesignProjectCode } from '../api';

type FilterKey = 'all' | 'active' | 'released' | 'hold';

const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'All',
  active: 'Active',
  released: 'Released',
  hold: 'On Hold',
};

export const designProjectsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-projects',
  component: DesignProjectsListPage,
});

function DesignProjectsListPage(): React.JSX.Element {
  // Tier-driven per Access Control (dsnproj_create, Design dept). Replaces the
  // old admin/manager flag.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnproj_create');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isFetching, isError, error } = useDesignProjectsList({
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

  const filterCount: Record<FilterKey, number> = {
    all: summary.total,
    active: summary.active,
    released: summary.released,
    hold: summary.onHold,
  };

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Design Projects. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <ListHeader
        title="Design Projects"
        icon="📋"
        count={data?.total}
        noun="project"
        filterNote={filter === 'all' ? undefined : FILTER_LABEL[filter]}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search project no., name, SO no., customer…"
        updating={isFetching && !isLoading}
        filters={
          <Select
            aria-label="Project filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
            // Counts in the labels — they were the clickable Total / Active /
            // Released / On Hold tiles (owner's filter-bar decision 2026-09-26).
            options={(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => ({
              value: k,
              label: `${FILTER_LABEL[k]} (${filterCount[k]})`,
            }))}
          />
        }
        onClearFilters={() => {
          setSearch('');
          setFilter('all');
        }}
        filtersActive={search.trim() !== '' || filter !== 'all'}
        primary={
          perms.entry ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              + New Project
            </button>
          ) : null
        }
      >
        {/* Read-only totals the Project filter dropdown does not carry. The
            Total / Active / Released / On Hold counts moved into its labels. */}
        <StatStrip
          items={[
            {
              key: 'tasks',
              label: 'Tasks Completed',
              count: `${summary.doneTasks}/${summary.totalTasks}`,
              color: 'var(--purple)',
            },
            {
              key: 'issues',
              label: 'Open Issues',
              count: summary.openIssues,
              color: summary.openIssues > 0 ? 'var(--red2)' : 'var(--green2)',
            },
          ]}
        />
      </ListHeader>

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
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error
                ? error.message
                : 'Could not load design projects. Try again.'}
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
              {search.trim() || filter !== 'all'
                ? 'No Design Projects match.'
                : 'No Design Projects yet.'}
            </div>
          ) : null}
          <ListFooter total={data.total} noun="project" limit={100} />
        </>
      ) : null}

      {showAdd ? <AddProjectModal onClose={() => setShowAdd(false)} /> : null}
    </div>
  );
}

function ProjectCard({ project }: { project: DesignProjectListItem }): React.JSX.Element {
  const today = todayIst();
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
          📅 {fmtDate(project.targetDate)}
          {isOverdue ? ' ⚠' : ''}
        </span>
        {project.openIssuesCount > 0 ? (
          <span style={{ color: 'var(--red2)', fontWeight: 700 }}>
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
              background: project.taskProgressPct === 100 ? 'var(--green)' : 'var(--blue)',
              borderRadius: 2,
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
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

/** Design Active / In Review = under way (amber); Released = done (green);
 *  On Hold = waiting (grey). Badge classes only — no hand-mixed colours. */
function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const cls: Record<string, string> = {
    'Design Active': 'b-amber',
    'In Review': 'b-amber',
    Released: 'b-green',
    'On Hold': 'b-grey',
  };
  return <span className={`badge ${cls[status] ?? 'b-grey'}`}>{status}</span>;
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

  const onSave = (): void => {
    setErr(null);
    if (!name.trim()) {
      setErr('Project Name is required.');
      return;
    }
    if (!targetDate) {
      setErr('Target Date is required.');
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
