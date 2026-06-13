// Design Project detail (Design slice C) — header + 4 tabs.
// Mirrors legacy _dpRenderDetail (HTML L7623) + sub-renderers.

import {
  type CreateDesignDcnInput,
  type CreateDesignDcrInput,
  type CreateDesignIssueInput,
  type CreateDesignTaskInput,
  DESIGN_DCN_STATUSES,
  DESIGN_DCR_CHANGE_TYPES,
  DESIGN_DCR_PRIORITIES,
  DESIGN_DCR_STATUSES,
  DESIGN_ISSUE_SEVERITIES,
  DESIGN_ISSUE_STATUSES,
  DESIGN_PRIORITIES,
  DESIGN_TASK_STATUSES,
  type DesignDcn,
  type DesignDcr,
  type DesignIssue,
  type DesignIssueStatus,
  type DesignProjectDetail,
  type DesignTask,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useAddDesignIssueComment,
  useAddDesignTaskComment,
  useCreateDesignDcn,
  useCreateDesignDcr,
  useCreateDesignIssue,
  useCreateDesignTask,
  useDesignProjectDetail,
  useReleaseDesignProject,
  useToggleDesignChecklist,
  useUpdateDesignDcn,
  useUpdateDesignDcr,
  useUpdateDesignIssue,
  useUpdateDesignTask,
} from '../api';

const CHECKLIST: Array<{ key: string; label: string; cat: string }> = [
  { key: 'allTasksDone', label: 'All design tasks completed', cat: 'Completeness' },
  { key: 'allIssuesClosed', label: 'All design issues resolved/closed', cat: 'Completeness' },
  { key: 'bomGenerated', label: 'BOM generated and verified', cat: 'Completeness' },
  { key: 'drawingsNumbered', label: 'All drawings properly numbered and titled', cat: 'Documentation' },
  { key: 'dimensionsChecked', label: 'Critical dimensions verified', cat: 'Quality' },
  { key: 'tolerancesReviewed', label: 'Tolerances and GD&T reviewed', cat: 'Quality' },
  { key: 'interferenceCheck', label: 'Interference / clash check done', cat: 'Quality' },
  { key: 'materialSpecified', label: 'Materials and surface finish specified', cat: 'Quality' },
  { key: 'standardsCompliance', label: 'Relevant standards compliance verified', cat: 'Standards' },
  { key: 'safetyReviewed', label: 'Safety requirements addressed', cat: 'Standards' },
  { key: 'clientApproval', label: 'Client approval obtained (if required)', cat: 'Approval' },
  { key: 'leadApproval', label: 'Design lead sign-off', cat: 'Approval' },
];

type TabKey = 'tasks' | 'issues' | 'checklist' | 'dcr';

export const designProjectDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-projects/$id',
  component: DesignProjectDetailPage,
});

function DesignProjectDetailPage(): React.JSX.Element {
  const { id } = designProjectDetailRoute.useParams();
  const { data, isLoading, isError, error } = useDesignProjectDetail(id);
  const [tab, setTab] = useState<TabKey>('tasks');

  if (isLoading || !data) {
    return (
      <div>
        <Link to="/design-projects" className="btn btn-ghost btn-sm">
          ← Back
        </Link>
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-body">
            {isError ? (
              <div className="empty-state" style={{ color: 'var(--red)' }}>
                {error instanceof Error ? error.message : 'Failed to load'}
              </div>
            ) : (
              <div className="text3" style={{ fontSize: 12 }}>
                <Loader2 size={14} className="inline animate-spin" /> Loading…
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const p = data.project;
  const checkDone = CHECKLIST.filter((c) => p.checklist[c.key]).length;
  const tabs: Array<{ k: TabKey; label: string; badge: string }> = [
    { k: 'tasks', label: 'Tasks', badge: String(p.taskTotal) },
    { k: 'issues', label: '⚠ Issues', badge: String(data.issues.length) },
    { k: 'checklist', label: '✅ Checklist', badge: `${checkDone}/${CHECKLIST.length}` },
    { k: 'dcr', label: '🔄 DCR/DCN', badge: `${data.dcrs.length}/${data.dcns.length}` },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <Link to="/design-projects" className="btn btn-ghost btn-sm">
          ← Back
        </Link>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{p.projectName}</div>
          <div className="text3" style={{ fontSize: 11 }}>
            {p.code} · {p.soCodeText ?? ''} · {p.clientText ?? ''} · Lead: {p.leadText ?? ''}
          </div>
        </div>
        <StatusBadge status={p.status} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Tile label="Tasks" value={p.taskTotal} color="var(--blue)" />
        <Tile label="Done" value={p.taskDone} color="var(--green)" />
        <Tile
          label="Open Issues"
          value={p.openIssuesCount}
          color={p.openIssuesCount > 0 ? 'var(--red)' : 'var(--green)'}
        />
        <Tile label="Checklist" value={`${checkDone}/${CHECKLIST.length}`} color="var(--purple)" />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.k}
            type="button"
            className="btn btn-sm"
            style={{
              fontWeight: 700,
              background: tab === t.k ? 'var(--blue)' : 'var(--bg4)',
              color: tab === t.k ? '#fff' : 'var(--text2)',
              border: `1px solid ${tab === t.k ? 'var(--blue)' : 'var(--border)'}`,
            }}
            onClick={() => setTab(t.k)}
          >
            {t.label} ({t.badge})
          </button>
        ))}
      </div>

      {tab === 'tasks' ? <TasksTab detail={data} /> : null}
      {tab === 'issues' ? <IssuesTab detail={data} /> : null}
      {tab === 'checklist' ? <ChecklistTab detail={data} checkDone={checkDone} /> : null}
      {tab === 'dcr' ? <DcrDcnTab detail={data} /> : null}
    </div>
  );
}

function Tile({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}): React.JSX.Element {
  return (
    <div
      className="panel"
      style={{ textAlign: 'center', padding: 12 }}
    >
      <div className="text3" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const v = status.toLowerCase().replace(/[\s/]/g, '');
  const c: Record<string, string> = {
    designactive: 'var(--blue)',
    inreview: 'var(--purple)',
    released: 'var(--green)',
    onhold: 'var(--amber)',
  };
  const color = c[v] ?? 'var(--text3)';
  return (
    <span
      style={{
        padding: '2px 9px',
        borderRadius: 12,
        fontSize: 10,
        fontWeight: 700,
        color,
        background: `${color}12`,
        border: `1px solid ${color}30`,
      }}
    >
      {status}
    </span>
  );
}

function Badge({ value, kind }: { value: string; kind?: 'status' }): React.JSX.Element {
  const v = value.toLowerCase().replace(/[\s/]/g, '');
  const colors: Record<string, string> = {
    critical: 'var(--red)',
    high: 'var(--amber)',
    major: 'var(--amber)',
    medium: 'var(--amber)',
    low: 'var(--green)',
    minor: 'var(--green)',
    open: 'var(--red)',
    inprogress: 'var(--blue)',
    inreview: 'var(--purple)',
    resolved: 'var(--green)',
    completed: 'var(--green)',
    released: 'var(--green)',
    closed: 'var(--text3)',
    notstarted: 'var(--text3)',
    designactive: 'var(--blue)',
    onhold: 'var(--amber)',
    submitted: 'var(--amber)',
    underreview: 'var(--purple)',
    accepted: 'var(--green)',
    rejected: 'var(--red)',
    draft: 'var(--text3)',
    approved: 'var(--green)',
    urgent: 'var(--red)',
    normal: 'var(--blue)',
  };
  const c = colors[v] ?? 'var(--text3)';
  return (
    <span
      style={{
        padding: '2px 9px',
        borderRadius: kind === 'status' ? 4 : 12,
        fontSize: 10,
        fontWeight: 700,
        color: c,
        background: `${c}12`,
        border: `1px solid ${c}30`,
      }}
    >
      {value}
    </span>
  );
}

// ─── Tasks tab ────────────────────────────────────────────────────────────

function TasksTab({ detail }: { detail: DesignProjectDetail }): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [showAdd, setShowAdd] = useState(false);
  const [editTask, setEditTask] = useState<DesignTask | null>(null);
  const [viewTask, setViewTask] = useState<DesignTask | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-hdr m-0">📝 Task Board</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={view === 'table' ? { background: 'var(--blue)', color: '#fff' } : undefined}
            onClick={() => setView('table')}
          >
            Table
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={view === 'kanban' ? { background: 'var(--blue)', color: '#fff' } : undefined}
            onClick={() => setView('kanban')}
          >
            Kanban
          </button>
          {canWrite ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowAdd(true)}
            >
              <Plus size={12} /> Add Task
            </button>
          ) : null}
        </div>
      </div>

      {view === 'table' ? (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Part</th>
                  <th>Assignee</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th className="td-ctr">Issues</th>
                  {canWrite ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {detail.tasks.length === 0 ? (
                  <tr>
                    <td colSpan={canWrite ? 8 : 7} className="empty-state">
                      No tasks yet
                    </td>
                  </tr>
                ) : (
                  detail.tasks.map((t) => {
                    const today = new Date().toISOString().slice(0, 10);
                    const isOverdue =
                      t.dueDate != null && t.dueDate < today && t.status !== 'Completed';
                    const linkedIssues = detail.issues.filter(
                      (i) =>
                        i.designTaskId === t.id &&
                        (i.status === 'Open' || i.status === 'In Progress'),
                    ).length;
                    return (
                      <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setViewTask(t)}>
                        <td className="fw-700">{t.title}</td>
                        <td style={{ fontSize: 11, color: 'var(--text2)' }}>{t.partText ?? '—'}</td>
                        <td>{t.assigneeText ?? ''}</td>
                        <td>
                          <Badge value={t.priority} />
                        </td>
                        <td>
                          <Badge value={t.status} kind="status" />
                        </td>
                        <td
                          style={{
                            color: isOverdue ? 'var(--red)' : undefined,
                            fontSize: 11,
                          }}
                        >
                          {t.dueDate ?? '—'}
                          {isOverdue ? ' ⚠' : ''}
                        </td>
                        <td className="td-ctr">
                          {linkedIssues > 0 ? (
                            <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                              ⚠ {linkedIssues}
                            </span>
                          ) : (
                            '✔'
                          )}
                        </td>
                        {canWrite ? (
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ fontSize: 10 }}
                              onClick={() => setEditTask(t)}
                            >
                              ✏
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 10,
          }}
        >
          {DESIGN_TASK_STATUSES.map((status) => {
            const ts = detail.tasks.filter((t) => t.status === status);
            const colColor =
              status === 'Not Started'
                ? 'var(--text3)'
                : status === 'In Progress'
                  ? 'var(--blue)'
                  : status === 'In Review'
                    ? 'var(--purple)'
                    : 'var(--green)';
            return (
              <div
                key={status}
                style={{
                  background: 'var(--bg3)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  minHeight: 120,
                }}
              >
                <div
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: colColor,
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  {status}
                  <span
                    style={{
                      background: 'var(--bg4)',
                      padding: '1px 7px',
                      borderRadius: 10,
                      fontSize: 10,
                      color: 'var(--text3)',
                    }}
                  >
                    {ts.length}
                  </span>
                </div>
                <div style={{ padding: 6 }}>
                  {ts.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        background: 'var(--bg2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: 10,
                        marginBottom: 6,
                        cursor: 'pointer',
                      }}
                      onClick={() => setViewTask(t)}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                        {t.title}
                      </div>
                      <div
                        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 10 }}
                      >
                        <Badge value={t.priority} />
                        <span className="text3">👤 {t.assigneeText ?? ''}</span>
                        {t.dueDate ? <span className="text3">📅 {t.dueDate}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd ? (
        <TaskFormModal
          projectId={detail.project.id}
          mode="add"
          onClose={() => setShowAdd(false)}
        />
      ) : null}
      {editTask ? (
        <TaskFormModal
          projectId={detail.project.id}
          mode="edit"
          task={editTask}
          onClose={() => setEditTask(null)}
        />
      ) : null}
      {viewTask ? (
        <ViewTaskModal
          task={viewTask}
          issues={detail.issues.filter((i) => i.designTaskId === viewTask.id)}
          onClose={() => setViewTask(null)}
        />
      ) : null}
    </div>
  );
}

function TaskFormModal({
  projectId,
  mode,
  task,
  onClose,
}: {
  projectId: string;
  mode: 'add' | 'edit';
  task?: DesignTask;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(task?.title ?? '');
  const [part, setPart] = useState(task?.partText ?? '');
  const [assignee, setAssignee] = useState(task?.assigneeText ?? '');
  const [priority, setPriority] = useState<DesignTask['priority']>(task?.priority ?? 'Medium');
  const [status, setStatus] = useState<DesignTask['status']>(task?.status ?? 'Not Started');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useCreateDesignTask();
  const updateMut = useUpdateDesignTask();

  const onSave = (): void => {
    setErr(null);
    if (!title.trim()) {
      setErr('Enter title');
      return;
    }
    const input: CreateDesignTaskInput = {
      title: title.trim(),
      priority,
      status,
    };
    if (part.trim()) input.partText = part.trim();
    if (assignee.trim()) input.assigneeText = assignee.trim();
    if (dueDate) input.dueDate = dueDate;
    if (description.trim()) input.description = description.trim();

    if (mode === 'add') {
      createMut.mutate(
        { projectId, input },
        {
          onSuccess: () => onClose(),
          onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
        },
      );
    } else if (task) {
      updateMut.mutate(
        { id: task.id, input },
        {
          onSuccess: () => onClose(),
          onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
        },
      );
    }
  };

  return (
    <Modal onClose={onClose} title={mode === 'add' ? '📝 Add Task' : '✏ Edit Task'}>
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
        <Field label="Part / Assembly">
          <input
            className="innovic-input"
            value={part}
            onChange={(e) => setPart(e.target.value)}
          />
        </Field>
        <Field label="Assignee">
          <input
            className="innovic-input"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="Engineer name"
          />
        </Field>
        <Field label="Priority">
          <select
            className="innovic-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as DesignTask['priority'])}
          >
            {DESIGN_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="innovic-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as DesignTask['status'])}
          >
            {DESIGN_TASK_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Due Date">
          <input
            type="date"
            className="innovic-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Description">
            <textarea
              className="innovic-input"
              rows={2}
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
        label="Save"
      />
    </Modal>
  );
}

function ViewTaskModal({
  task,
  issues,
  onClose,
}: {
  task: DesignTask;
  issues: DesignIssue[];
  onClose: () => void;
}): React.JSX.Element {
  const [comment, setComment] = useState('');
  const commentMut = useAddDesignTaskComment();

  const onPost = (): void => {
    if (!comment.trim()) return;
    commentMut.mutate(
      { id: task.id, input: { text: comment.trim() } },
      {
        onSuccess: () => setComment(''),
      },
    );
  };

  return (
    <Modal onClose={onClose} title={`📝 ${task.title}`}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Assignee
          </div>
          <div style={{ fontWeight: 600 }}>{task.assigneeText ?? ''}</div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Part
          </div>
          <div>{task.partText ?? '—'}</div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Priority
          </div>
          <Badge value={task.priority} />
        </div>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Due
          </div>
          <div>{task.dueDate ?? '—'}</div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Status
          </div>
          <Badge value={task.status} kind="status" />
        </div>
      </div>
      <div>
        <div className="text3" style={{ fontSize: 10 }}>
          Description
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
          {task.description ?? '—'}
        </div>
      </div>

      {issues.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>
            ⚠ Issues ({issues.length})
          </div>
          {issues.map((i) => (
            <div
              key={i.id}
              style={{
                padding: '6px 10px',
                background: 'var(--bg3)',
                borderRadius: 4,
                marginBottom: 3,
                fontSize: 12,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{i.title}</span>
              <Badge value={i.status} kind="status" />
            </div>
          ))}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 14,
          borderTop: '1px solid var(--border)',
          paddingTop: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
          💬 Discussion ({task.discussions.length})
        </div>
        {task.discussions.map((d, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(37,99,235,0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--blue)',
                flexShrink: 0,
              }}
            >
              {(d.author || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700 }}>
                {d.author}{' '}
                <span className="text3">{d.date}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{d.text}</div>
            </div>
          </div>
        ))}
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
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ─── Issues tab ───────────────────────────────────────────────────────────

function IssuesTab({ detail }: { detail: DesignProjectDetail }): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [showAdd, setShowAdd] = useState(false);
  const [editIssue, setEditIssue] = useState<DesignIssue | null>(null);
  const [viewIssue, setViewIssue] = useState<DesignIssue | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-hdr m-0">⚠ Design Issues</div>
        {canWrite ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
            <Plus size={12} /> Raise Issue
          </button>
        ) : null}
      </div>
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Part</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Raised By</th>
                <th>Assigned To</th>
                <th>Date</th>
                <th>Age</th>
                {canWrite ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {detail.issues.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 9 : 8} className="empty-state">
                    No issues 🎉
                  </td>
                </tr>
              ) : (
                detail.issues.map((i) => {
                  const ageMs = Date.now() - new Date(i.raisedDate).getTime();
                  const ageDays = Math.max(0, Math.round(ageMs / 86400000));
                  const stale =
                    ageDays > 5 && i.status !== 'Resolved' && i.status !== 'Closed';
                  return (
                    <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setViewIssue(i)}>
                      <td className="fw-700">{i.title}</td>
                      <td style={{ fontSize: 11, color: 'var(--text2)' }}>{i.partText ?? '—'}</td>
                      <td>
                        <Badge value={i.severity} />
                      </td>
                      <td>
                        <Badge value={i.status} kind="status" />
                      </td>
                      <td style={{ fontSize: 11 }}>{i.raisedByText ?? ''}</td>
                      <td style={{ fontSize: 11, fontWeight: 600 }}>{i.assignedToText ?? ''}</td>
                      <td style={{ fontSize: 11 }}>{i.raisedDate}</td>
                      <td
                        className="mono fw-700"
                        style={{ color: stale ? 'var(--red)' : 'var(--text3)' }}
                      >
                        {ageDays}d
                      </td>
                      {canWrite ? (
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 10 }}
                            onClick={() => setEditIssue(i)}
                          >
                            ✏
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd ? (
        <IssueFormModal
          projectId={detail.project.id}
          tasks={detail.tasks}
          mode="add"
          onClose={() => setShowAdd(false)}
        />
      ) : null}
      {editIssue ? (
        <IssueFormModal
          projectId={detail.project.id}
          tasks={detail.tasks}
          mode="edit"
          issue={editIssue}
          onClose={() => setEditIssue(null)}
        />
      ) : null}
      {viewIssue ? (
        <ViewIssueModal issue={viewIssue} onClose={() => setViewIssue(null)} />
      ) : null}
    </div>
  );
}

function IssueFormModal({
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
      setErr('Enter title');
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
          onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
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
          onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
        },
      );
    }
  };

  return (
    <Modal onClose={onClose} title={mode === 'add' ? '⚠ Raise Issue' : '✏ Edit Issue'}>
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
        <Field label="Part">
          <input
            className="innovic-input"
            value={part}
            onChange={(e) => setPart(e.target.value)}
          />
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
          <Field label="Status">
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
        label="Save"
      />
    </Modal>
  );
}

function ViewIssueModal({
  issue,
  onClose,
}: {
  issue: DesignIssue;
  onClose: () => void;
}): React.JSX.Element {
  const [comment, setComment] = useState('');
  const commentMut = useAddDesignIssueComment();

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
    <Modal onClose={onClose} title={`⚠ ${issue.title}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Severity
          </div>
          <Badge value={issue.severity} />
        </div>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Status
          </div>
          <Badge value={issue.status} kind="status" />
        </div>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Assigned To
          </div>
          <div style={{ fontWeight: 600 }}>{issue.assignedToText ?? ''}</div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Raised
          </div>
          <div>
            {issue.raisedDate} ({ageDays}d)
          </div>
        </div>
        <div>
          <div className="text3" style={{ fontSize: 10 }}>
            Resolved
          </div>
          <div>{issue.resolvedDate ?? '—'}</div>
        </div>
      </div>
      <div>
        <div className="text3" style={{ fontSize: 10 }}>
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
                background: 'rgba(37,99,235,0.10)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--blue)',
                flexShrink: 0,
              }}
            >
              {(d.author || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700 }}>
                {d.author} <span className="text3">{d.date}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{d.text}</div>
            </div>
          </div>
        ))}
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
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

// ─── Checklist tab ────────────────────────────────────────────────────────

function ChecklistTab({
  detail,
  checkDone,
}: {
  detail: DesignProjectDetail;
  checkDone: number;
}): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const allTasksDone =
    detail.tasks.length > 0 && detail.tasks.every((t) => t.status === 'Completed');
  const allIssuesClosed = detail.issues.every(
    (i) => i.status === 'Resolved' || i.status === 'Closed',
  );
  const allChecked = checkDone === CHECKLIST.length;

  const cats: Record<string, typeof CHECKLIST> = {};
  CHECKLIST.forEach((c) => {
    if (!cats[c.cat]) cats[c.cat] = [];
    cats[c.cat]!.push(c);
  });

  const toggleMut = useToggleDesignChecklist();
  const releaseMut = useReleaseDesignProject();

  return (
    <div>
      <div className="section-hdr">✅ Design Release Checklist</div>
      {!allTasksDone ? (
        <div
          style={{
            background: 'rgba(196,122,0,0.08)',
            border: '1px solid rgba(196,122,0,0.3)',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--amber)',
          }}
        >
          ⚠ {detail.tasks.filter((t) => t.status !== 'Completed').length} task(s) incomplete
        </div>
      ) : null}
      {!allIssuesClosed && detail.issues.length > 0 ? (
        <div
          style={{
            background: 'rgba(220,38,38,0.06)',
            border: '1px solid rgba(220,38,38,0.3)',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--red)',
          }}
        >
          ⚠{' '}
          {
            detail.issues.filter((i) => i.status !== 'Resolved' && i.status !== 'Closed').length
          }{' '}
          issue(s) open
        </div>
      ) : null}

      <div className="panel" style={{ padding: 16 }}>
        {Object.entries(cats).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 14 }}>
            <div
              className="text3"
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 8,
                paddingBottom: 4,
                borderBottom: '1px solid var(--border)',
              }}
            >
              {cat}
            </div>
            {items.map((c) => {
              const checked = !!detail.project.checklist[c.key];
              return (
                <div
                  key={c.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 0',
                    cursor: canWrite ? 'pointer' : 'default',
                  }}
                  onClick={() =>
                    canWrite &&
                    toggleMut.mutate({
                      id: detail.project.id,
                      input: { key: c.key },
                    })
                  }
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      border: `2px solid ${checked ? 'var(--green)' : 'var(--border)'}`,
                      background: checked ? 'var(--green)' : 'var(--bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {checked ? <span style={{ color: '#fff', fontSize: 12 }}>✓</span> : null}
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      color: checked ? 'var(--text3)' : undefined,
                      textDecoration: checked ? 'line-through' : undefined,
                    }}
                  >
                    {c.label}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {allChecked && allTasksDone && allIssuesClosed ? (
        <div
          style={{
            background: 'rgba(22,163,74,0.08)',
            border: '1px solid rgba(22,163,74,0.3)',
            borderRadius: 8,
            padding: 20,
            marginTop: 14,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 4 }}>✅</div>
          <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: 15 }}>
            Ready for Release!
          </div>
          {canWrite && detail.project.status !== 'Released' ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              disabled={releaseMut.isPending}
              onClick={() => {
                if (window.confirm(`Release design for ${detail.project.projectName}?`)) {
                  releaseMut.mutate(detail.project.id);
                }
              }}
            >
              Release Design Package
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── DCR / DCN tab ────────────────────────────────────────────────────────

function DcrDcnTab({ detail }: { detail: DesignProjectDetail }): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [subTab, setSubTab] = useState<'dcr' | 'dcn'>('dcr');
  const [showAddDcr, setShowAddDcr] = useState(false);
  const [showAddDcn, setShowAddDcn] = useState(false);
  const [editDcr, setEditDcr] = useState<DesignDcr | null>(null);
  const [editDcn, setEditDcn] = useState<DesignDcn | null>(null);

  const dcrs = detail.dcrs;
  const dcns = detail.dcns;
  const pendingDcrs = dcrs.filter(
    (d) => d.status === 'Submitted' || d.status === 'Under Review',
  ).length;
  const acceptedDcrs = dcrs.filter((d) => d.status === 'Accepted').length;
  const activeDcns = dcns.filter((d) => d.status !== 'Released').length;

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
        <Tile label="Total DCRs" value={dcrs.length} color="var(--amber)" />
        <Tile label="Pending" value={pendingDcrs} color="var(--purple)" />
        <Tile label="Accepted" value={acceptedDcrs} color="var(--green)" />
        <Tile label="Active DCNs" value={activeDcns} color="var(--blue)" />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn btn-sm"
            style={{
              fontWeight: 700,
              background: subTab === 'dcr' ? 'var(--blue)' : 'var(--bg4)',
              color: subTab === 'dcr' ? '#fff' : 'var(--text2)',
              border: `1px solid ${subTab === 'dcr' ? 'var(--blue)' : 'var(--border)'}`,
            }}
            onClick={() => setSubTab('dcr')}
          >
            📋 DCR Register ({dcrs.length})
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{
              fontWeight: 700,
              background: subTab === 'dcn' ? 'var(--blue)' : 'var(--bg4)',
              color: subTab === 'dcn' ? '#fff' : 'var(--text2)',
              border: `1px solid ${subTab === 'dcn' ? 'var(--blue)' : 'var(--border)'}`,
            }}
            onClick={() => setSubTab('dcn')}
          >
            📝 DCN Register ({dcns.length})
          </button>
        </div>
        {canWrite ? (
          subTab === 'dcr' ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddDcr(true)}
            >
              <Plus size={12} /> New DCR
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddDcn(true)}
            >
              <Plus size={12} /> New DCN
            </button>
          )
        ) : null}
      </div>

      {subTab === 'dcr' ? (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>DCR No.</th>
                  <th>Title</th>
                  <th>Change Type</th>
                  <th>Part</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Requested By</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {dcrs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No DCRs yet
                    </td>
                  </tr>
                ) : (
                  dcrs.map((d) => (
                    <tr
                      key={d.id}
                      style={{ cursor: canWrite ? 'pointer' : 'default' }}
                      onClick={() => canWrite && setEditDcr(d)}
                    >
                      <td className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 11 }}>
                        {d.code}
                      </td>
                      <td className="fw-700">{d.title}</td>
                      <td>
                        <Badge value={d.changeType} />
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text2)' }}>
                        {d.partAffected ?? '—'}
                      </td>
                      <td>
                        <Badge value={d.priority} />
                      </td>
                      <td>
                        <Badge value={d.status} kind="status" />
                      </td>
                      <td style={{ fontSize: 11 }}>{d.requestedByText ?? ''}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {d.requestDate}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>DCN No.</th>
                  <th>Title</th>
                  <th>Linked DCR</th>
                  <th>Status</th>
                  <th>Released</th>
                </tr>
              </thead>
              <tbody>
                {dcns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      No DCNs yet
                    </td>
                  </tr>
                ) : (
                  dcns.map((d) => {
                    const linked = dcrs.find((x) => x.id === d.linkedDcrId);
                    return (
                      <tr
                        key={d.id}
                        style={{ cursor: canWrite ? 'pointer' : 'default' }}
                        onClick={() => canWrite && setEditDcn(d)}
                      >
                        <td className="mono fw-700" style={{ color: 'var(--green)', fontSize: 11 }}>
                          {d.code}
                        </td>
                        <td className="fw-700">{d.title}</td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
                          {linked?.code ?? '—'}
                        </td>
                        <td>
                          <Badge value={d.status} kind="status" />
                        </td>
                        <td style={{ fontSize: 11 }}>{d.releasedDate ?? '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAddDcr ? (
        <DcrFormModal
          projectId={detail.project.id}
          mode="add"
          onClose={() => setShowAddDcr(false)}
        />
      ) : null}
      {editDcr ? (
        <DcrFormModal
          projectId={detail.project.id}
          mode="edit"
          dcr={editDcr}
          onClose={() => setEditDcr(null)}
        />
      ) : null}
      {showAddDcn ? (
        <DcnFormModal
          projectId={detail.project.id}
          dcrs={dcrs}
          mode="add"
          onClose={() => setShowAddDcn(false)}
        />
      ) : null}
      {editDcn ? (
        <DcnFormModal
          projectId={detail.project.id}
          dcrs={dcrs}
          mode="edit"
          dcn={editDcn}
          onClose={() => setEditDcn(null)}
        />
      ) : null}
    </div>
  );
}

function DcrFormModal({
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
  const [requestDate, setRequestDate] = useState(
    dcr?.requestDate ?? new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState(dcr?.description ?? '');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useCreateDesignDcr();
  const updateMut = useUpdateDesignDcr();

  const onSave = (): void => {
    setErr(null);
    if (!title.trim()) {
      setErr('Enter title');
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
          onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
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
          onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
        },
      );
    }
  };

  return (
    <Modal onClose={onClose} title={mode === 'add' ? '📋 New DCR' : `✏ Edit DCR ${dcr?.code ?? ''}`}>
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
        <Field label="Part Affected">
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
          <Field label="Status">
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
        label="Save"
      />
    </Modal>
  );
}

function DcnFormModal({
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
      setErr('Enter title');
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
          onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
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
          onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
        },
      );
    }
  };

  return (
    <Modal onClose={onClose} title={mode === 'add' ? '📝 New DCN' : `✏ Edit DCN ${dcn?.code ?? ''}`}>
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
          <Field label="Status">
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
        label="Save"
      />
    </Modal>
  );
}

// ─── Shared modal bits ────────────────────────────────────────────────────

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
          width: 'min(1100px, 96vw)',
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
