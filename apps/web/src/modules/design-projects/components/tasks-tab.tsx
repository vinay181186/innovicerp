// Design Project — Tasks tab. Table/Kanban toggle: the Kanban board is kept as
// it was; the TABLE side now renders on the shared FIT table (DataTable,
// tableKey designProjectTasks). ADR-199. Split out of detail.tsx.

import { DESIGN_TASK_STATUSES, type DesignProjectDetail, type DesignTask } from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, todayIst } from '@/lib/date';
import { DataTable, ROW_TINT, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Badge } from './detail-shared';
import { TaskFormModal, ViewTaskModal } from './task-modals';

export function TasksTab({ detail }: { detail: DesignProjectDetail }): React.JSX.Element {
  // Tasks are part of the Design Project form (dsnproj_create).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnproj_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [showAdd, setShowAdd] = useState(false);
  const [editTask, setEditTask] = useState<DesignTask | null>(null);
  const [viewTask, setViewTask] = useState<DesignTask | null>(null);

  const today = todayIst();
  const openIssuesFor = (taskId: string): number =>
    detail.issues.filter(
      (i) => i.designTaskId === taskId && (i.status === 'Open' || i.status === 'In Progress'),
    ).length;
  const isOverdue = (t: DesignTask): boolean =>
    t.dueDate != null && t.dueDate < today && t.status !== 'Completed';

  const columns = useMemo<DataTableColumn<DesignTask>[]>(
    () => [
      {
        id: 'title',
        header: 'Task',
        kind: 'text',
        align: 'left',
        ellipsis: true,
        className: 'fw-700',
        render: (t) => t.title,
        title: (t) => t.title,
      },
      {
        id: 'part_name',
        header: 'Item Name',
        kind: 'text',
        align: 'left',
        ellipsis: true,
        render: (t) => t.partText ?? '—',
        title: (t) => t.partText ?? '',
      },
      {
        id: 'assignee',
        header: 'Assignee',
        kind: 'text',
        render: (t) => t.assigneeText ?? '',
      },
      {
        id: 'priority',
        header: 'Priority',
        kind: 'badge',
        render: (t) => <Badge value={t.priority} />,
      },
      {
        id: 'status',
        header: 'Task Status',
        kind: 'badge',
        render: (t) => <Badge value={t.status} kind="status" />,
      },
      {
        id: 'due_date',
        header: 'Due Date',
        kind: 'date',
        render: (t) => (
          <span style={{ color: isOverdue(t) ? 'var(--red)' : undefined }}>
            {fmtDate(t.dueDate)}
            {isOverdue(t) ? ' ⚠' : ''}
          </span>
        ),
      },
      {
        id: 'issues',
        header: 'Issues',
        kind: 'num',
        render: (t) => {
          const n = openIssuesFor(t.id);
          return n > 0 ? <span style={{ color: 'var(--red2)', fontWeight: 700 }}>⚠ {n}</span> : '✔';
        },
      },
    ],
    // openIssuesFor / isOverdue close over detail + today, which change together.
    [detail, today],
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div className="section-hdr m-0">Task Board</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={
              view === 'table' ? { background: 'var(--blue3)', color: 'var(--blue)' } : undefined
            }
            onClick={() => setView('table')}
          >
            Table
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={
              view === 'kanban' ? { background: 'var(--blue3)', color: 'var(--blue)' } : undefined
            }
            onClick={() => setView('kanban')}
          >
            Kanban
          </button>
          {canAdd ? (
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
        <DataTable
          tableKey={TABLE_KEYS.designProjectTasks}
          columns={columns}
          rows={detail.tasks}
          rowKey={(t) => t.id}
          emptyText="No Tasks yet."
          onRowClick={(t) => setViewTask(t)}
          rowClassName={(t) =>
            t.status === 'Completed' ? ROW_TINT.done : isOverdue(t) ? ROW_TINT.late : undefined
          }
          rowMenu={(t) => [
            {
              key: 'edit',
              label: 'Edit',
              icon: 'pencil',
              hidden: !canEdit,
              onSelect: () => setEditTask(t),
            },
          ]}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
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
                      fontSize: 11,
                      color: 'var(--text3)',
                    }}
                  >
                    {ts.length}
                  </span>
                </div>
                <div style={{ padding: 6 }}>
                  {ts.map((t) => {
                    const taskIssues = openIssuesFor(t.id);
                    return (
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 11 }}>
                          <Badge value={t.priority} />
                          <span className="text3">👤 {t.assigneeText ?? ''}</span>
                          {t.dueDate ? (
                            <span style={{ color: isOverdue(t) ? 'var(--red)' : 'var(--text3)' }}>
                              📅 {fmtDate(t.dueDate)}
                            </span>
                          ) : null}
                          {taskIssues > 0 ? (
                            <span style={{ color: 'var(--red2)', fontWeight: 700 }}>
                              ⚠{taskIssues}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd ? (
        <TaskFormModal projectId={detail.project.id} mode="add" onClose={() => setShowAdd(false)} />
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
