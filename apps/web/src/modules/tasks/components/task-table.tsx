// The Task Board table (ADR-176 board, ADR-199 table standard). THE Innovic fit
// sheet: one row per task of the standard columns — Task No. (pinned first,
// carries the fit table's ▸) · Title · <Person> · Related To · Priority · Due
// Date · Task Status. The row's ▸ reveals Last Update, the attachment / remark
// counts and the task's remarks; the row click opens the detail; the row's ⋯
// lists only the actions the server says the caller may take; the whole row is
// washed by status (ROW_TINT).
//
// The <Person> column is the OTHER party of the current view — who assigned it
// (Inbox), who it went to (Outbox / All), "Me" on My To-Do.

import type { TaskRow, TaskView } from '@innovic/shared';
import { TASK_PRIORITY_LABELS } from '@innovic/shared';
import { useState } from 'react';
import { DataTable, Panel, ROW_TINT, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { fmtTaskDate, fmtTaskDateTime, isOpenTask, priorityColor, statusPill } from '../lib/format';
import { RelatedRefLink } from './related-ref-link';

export const PERSON_LABEL: Record<TaskView, string> = {
  inbox: 'Assigned By',
  outbox: 'Assigned To',
  todo: 'Owner',
  all: 'Assigned To',
};

export type RowAction = 'view' | 'status' | 'complete' | 'reassign' | 'cancel';

export function personName(t: TaskRow, view: TaskView): string {
  if (view === 'inbox') return t.assignedByName ?? t.createdByName ?? '—';
  if (view === 'todo') return 'Me';
  return t.assignedToName ?? '—';
}

/**
 * Whole-row wash by the task's real status (ADR-199 ROW_TINT), aligned with the
 * status badge colours: Completed green, Cancelled grey, an open-but-late task
 * red, In Progress amber. To Do waits with no wash.
 */
function taskRowTint(t: TaskRow): string | undefined {
  if (t.status === 'cancelled') return ROW_TINT.cancelled;
  if (t.status === 'completed') return ROW_TINT.done;
  if (t.isOverdue) return ROW_TINT.late;
  if (t.status === 'in_progress') return ROW_TINT.pending;
  return undefined;
}

function taskColumns(view: TaskView): DataTableColumn<TaskRow>[] {
  return [
    {
      id: 'task_no',
      header: 'Task No.',
      nowrap: true,
      render: (t) => (
        <span className="td-code mono fw-700" style={{ color: 'var(--blue)' }}>
          {t.isUnread ? <span className="task-unread" title="Unread — new task" /> : null}
          {t.code}
        </span>
      ),
    },
    {
      id: 'title',
      kind: 'text',
      header: 'Title',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (t) => t.title,
      title: (t) => t.title,
    },
    {
      id: 'person',
      kind: 'text',
      header: PERSON_LABEL[view],
      align: 'left',
      ellipsis: true,
      render: (t) => personName(t, view),
      title: (t) => personName(t, view),
    },
    {
      id: 'related',
      header: 'Related To',
      nowrap: true,
      render: (t) => <RelatedRefLink linkedRef={t.linkedRef} stopRowClick />,
    },
    {
      id: 'priority',
      kind: 'badge',
      header: 'Priority',
      nowrap: true,
      render: (t) => (
        <span
          style={{
            fontWeight: t.priority === 'urgent' || t.priority === 'high' ? 700 : 600,
            color: priorityColor(t.priority),
          }}
        >
          {TASK_PRIORITY_LABELS[t.priority]}
        </span>
      ),
    },
    {
      id: 'due_date',
      kind: 'date',
      header: 'Due Date',
      className: 'mono',
      nowrap: true,
      render: (t) => {
        if (!t.dueDate) return <span className="text2">—</span>;
        return (
          <span
            style={{
              fontWeight: 700,
              color: t.isOverdue ? 'var(--red)' : 'var(--text)',
            }}
          >
            {fmtTaskDate(t.dueDate)}
            {t.isOverdue ? ' ⚠' : ''}
          </span>
        );
      },
    },
    {
      id: 'status',
      kind: 'badge',
      header: 'Task Status',
      nowrap: true,
      render: (t) => {
        const pill = statusPill(t);
        return <span className={pill.cls}>{pill.label}</span>;
      },
    },
  ];
}

/** The ▸ reveal: Last Update, the 📎 / 💬 counts and the task's remarks. */
function TaskExpand({ t }: { t: TaskRow }): React.JSX.Element {
  return (
    <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text2)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 6 }}>
        <span>
          <span className="text3">Last Update: </span>
          <span className="mono">{fmtTaskDateTime(t.updatedAt)}</span>
        </span>
        <span>
          <span className="text3">Attachments: </span>
          {t.attachmentCount > 0 ? `📎 ${t.attachmentCount}` : '—'}
        </span>
        <span>
          <span className="text3">Remarks posted: </span>
          {t.commentCount > 0 ? `💬 ${t.commentCount}` : '—'}
        </span>
      </div>
      {t.description ? (
        <div style={{ marginBottom: 4 }}>
          <span className="text3">Description: </span>
          {t.description}
        </div>
      ) : null}
      {t.completionRemark ? (
        <div>
          <span className="text3">Completion Remark: </span>
          {t.completionRemark}
        </div>
      ) : null}
      {!t.description && !t.completionRemark ? <div className="text3">No remarks.</div> : null}
    </div>
  );
}

export function TaskTable({
  rows,
  view,
  filtered,
  onAction,
}: {
  rows: TaskRow[];
  view: TaskView;
  /** True when a search / filter is on — picks the empty-state wording. */
  filtered: boolean;
  onAction: (action: RowAction, task: TaskRow) => void;
}): React.JSX.Element {
  // The row's ▸ (fit engine) is the one expand control. A Set — many open.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Panel bodyPadding="none" style={{ marginBottom: 0 }}>
      <DataTable<TaskRow>
        tableKey={TABLE_KEYS.taskBoard}
        columns={taskColumns(view)}
        rows={rows}
        rowClassName={(t) => taskRowTint(t)}
        onRowClick={(t) => onAction('view', t)}
        renderExpanded={(t) => (expandedIds.has(t.id) ? <TaskExpand t={t} /> : null)}
        onToggleExpanded={(t) => toggleExpand(t.id)}
        empty={filtered ? 'No Tasks match.' : 'No Tasks yet.'}
        rowMenu={(t) => {
          const p = t.permissions;
          const open = isOpenTask(t);
          return [
            {
              key: 'status',
              label: 'Update Status',
              icon: 'pencil',
              hidden: !(p.canUpdateStatus && open),
              onSelect: () => onAction('status', t),
            },
            {
              key: 'complete',
              label: 'Mark Completed',
              icon: 'check',
              group: 'workflow',
              hidden: !(p.canComplete && open),
              onSelect: () => onAction('complete', t),
            },
            {
              key: 'reassign',
              label: 'Reassign',
              icon: 'user-round',
              group: 'assign',
              hidden: !(p.canReassign && open),
              onSelect: () => onAction('reassign', t),
            },
            {
              key: 'cancel',
              label: 'Cancel Task',
              icon: 'x',
              group: 'danger',
              hidden: !(p.canCancel && open),
              onSelect: () => onAction('cancel', t),
            },
          ];
        }}
      />
    </Panel>
  );
}
