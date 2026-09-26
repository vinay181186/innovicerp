// Task Board (ADR-176) — the approved Inbox / Outbox / My To-Do / All Tasks
// board. Title row with "+ My To-Do" and "+ Assign Task" (any user), a tab
// strip with open counts, the KPI strip (TO DO / IN PROGRESS / COMPLETED /
// OVERDUE, each a filter), the five-box filter strip, the table, and a hint
// line that names the view. `?view=` keeps the tab across a refresh;
// `?task=<uuid>` (Global Search deep link) opens that task's detail on
// arrival; `?search=` keeps the typed term. Everything else is local state.
//
// The All Tasks tab renders ONLY when the server says the caller is admin
// (`isAdmin` on the list response) — never merely disabled — and the server
// refuses view=all for anyone else regardless.

import type {
  ListTasksQuery,
  TaskDueFilter,
  TaskPriority,
  TaskRow,
  TaskStatus,
  TaskView,
} from '@innovic/shared';
import { TASK_VIEWS } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { StatStrip } from '@/components/shared/stat-strip';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMarkTasksViewed, useTaskList, useTaskUserOptions } from '../api';
import { AssignTaskModal } from '../components/assign-task-modal';
import {
  CancelModal,
  CompleteModal,
  ReassignModal,
  UpdateStatusModal,
} from '../components/task-action-modals';
import { TaskDetailModal } from '../components/task-detail-modal';
import { TaskFilters, TaskTabs } from '../components/board-filters';
import { TaskTable, type RowAction } from '../components/task-table';
import { TodoModal } from '../components/todo-modal';

const searchSchema = z.object({
  task: z.string().uuid().optional(),
  view: z.enum(TASK_VIEWS).optional(),
  search: z.string().optional(),
});

export const taskBoardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'task-board',
  validateSearch: (search) => searchSchema.parse(search),
  component: TaskBoardPage,
});

type ModalState =
  | { kind: 'none' }
  | { kind: 'assign' }
  | { kind: 'todo' }
  | { kind: 'view'; id: string }
  | { kind: 'row'; action: Exclude<RowAction, 'view'>; task: TaskRow };

function TaskBoardPage(): React.JSX.Element {
  const routeSearch = taskBoardRoute.useSearch();
  const navigate = taskBoardRoute.useNavigate();
  const view: TaskView = routeSearch.view ?? 'inbox';

  // Search term: URL is the source of truth; the box mirrors it and writes
  // back after 300ms of quiet (same shape as the SO / WO list).
  const [searchInput, setSearchInput] = useState(routeSearch.search ?? '');
  useEffect(() => {
    setSearchInput(routeSearch.search ?? '');
  }, [routeSearch.search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === routeSearch.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, routeSearch.search, navigate]);

  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [person, setPerson] = useState('');
  const [assignedBy, setAssignedBy] = useState('');
  const [dept, setDept] = useState('');
  const [due, setDue] = useState<TaskDueFilter | ''>('');

  const setView = (v: TaskView): void => {
    // The person filters mean something different on each tab — reset them.
    setPerson('');
    setAssignedBy('');
    setDept('');
    void navigate({ search: (prev) => ({ ...prev, view: v, task: undefined }), replace: true });
  };

  // `?task=<uuid>` opens that task's detail on arrival. Lazy initial covers the
  // cold load; the effect covers a NEW ?task landing while this page is already
  // mounted (same route, no remount).
  const [modal, setModal] = useState<ModalState>(() =>
    routeSearch.task ? { kind: 'view', id: routeSearch.task } : { kind: 'none' },
  );
  useEffect(() => {
    if (routeSearch.task) setModal({ kind: 'view', id: routeSearch.task });
  }, [routeSearch.task]);
  const closeModal = (): void => {
    setModal({ kind: 'none' });
    // Closing the detail also drops ?task so a reload does not reopen it.
    if (routeSearch.task)
      void navigate({ search: (prev) => ({ ...prev, task: undefined }), replace: true });
  };

  const query: ListTasksQuery = useMemo(
    () => ({
      view,
      search: routeSearch.search,
      status: status || undefined,
      priority: priority || undefined,
      person: person || undefined,
      assignedBy: assignedBy || undefined,
      due: due || undefined,
      dept: dept || undefined,
    }),
    [view, routeSearch.search, status, priority, person, assignedBy, due, dept],
  );
  const { data, isLoading, isFetching, isError, error } = useTaskList(query);
  const { data: userOpts } = useTaskUserOptions();
  const users = userOpts?.options ?? [];
  const departments = useMemo(
    () =>
      Array.from(
        new Set(users.map((u) => u.mainDept).filter((d): d is string => Boolean(d))),
      ).sort(),
    [users],
  );
  const markViewed = useMarkTasksViewed();

  // Stamp the current user's freshly-assigned tasks as viewed, once on mount.
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    markViewed.mutate();
  }, [markViewed]);

  const onRowAction = (action: RowAction, task: TaskRow): void => {
    if (action === 'view') setModal({ kind: 'view', id: task.id });
    else setModal({ kind: 'row', action, task });
  };

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Could not load tasks. Try again.'}
      </div>
    );
  }

  const counts = data.counts;
  const tabs: TaskView[] = data.isAdmin ? [...TASK_VIEWS] : TASK_VIEWS.filter((v) => v !== 'all');
  const tabCount = (v: TaskView): number | null => data.viewCounts[v];
  const toggleStatus = (k: TaskStatus): void => setStatus((cur) => (cur === k ? '' : k));
  const toggleOverdue = (): void => setDue((cur) => (cur === 'overdue' ? '' : 'overdue'));

  return (
    <div>
      {/* Title row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📋 Task Board
          {data.unreadCount > 0 ? (
            <span className="badge b-red" style={{ marginLeft: 8 }}>
              🔔 {data.unreadCount} new
            </span>
          ) : null}
          {isFetching ? (
            <span className="text3 mono" style={{ fontSize: 11, marginLeft: 8, fontWeight: 400 }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setModal({ kind: 'todo' })}
          >
            + My To-Do
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModal({ kind: 'assign' })}
          >
            + Assign Task
          </button>
        </div>
      </div>

      <TaskTabs tabs={tabs} view={view} countOf={tabCount} onChange={setView} />

      {/* KPI strip — each tile is a filter */}
      <StatStrip
        items={[
          {
            key: 'todo',
            label: 'To Do',
            count: counts.todo,
            color: 'var(--amber)',
            active: status === 'todo',
            onClick: () => toggleStatus('todo'),
          },
          {
            key: 'in_progress',
            label: 'In Progress',
            count: counts.in_progress,
            color: 'var(--blue)',
            active: status === 'in_progress',
            onClick: () => toggleStatus('in_progress'),
          },
          {
            key: 'completed',
            label: 'Completed',
            count: counts.completed,
            color: 'var(--green)',
            active: status === 'completed',
            onClick: () => toggleStatus('completed'),
          },
          {
            key: 'overdue',
            label: 'Overdue',
            count: counts.overdue,
            color: 'var(--red)',
            active: due === 'overdue',
            onClick: toggleOverdue,
          },
        ]}
      />

      <TaskFilters
        view={view}
        users={users}
        departments={departments}
        values={{ searchInput, status, priority, person, assignedBy, dept, due }}
        onSearch={setSearchInput}
        onStatus={setStatus}
        onPriority={setPriority}
        onPerson={setPerson}
        onAssignedBy={setAssignedBy}
        onDept={setDept}
        onDue={setDue}
      />

      {isError ? (
        // A refetch failed (e.g. a non-admin landing on ?view=all): keep the
        // board and its tabs on screen so the user can move off the bad view.
        <div className="panel" style={{ padding: '8px 12px', fontSize: 12, color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load tasks. Try again.'}
        </div>
      ) : null}

      <TaskTable rows={data.tasks} view={view} onAction={onRowAction} />

      {modal.kind === 'assign' ? <AssignTaskModal onClose={closeModal} /> : null}
      {modal.kind === 'todo' ? <TodoModal onClose={closeModal} /> : null}
      {modal.kind === 'view' ? <TaskDetailModal taskId={modal.id} onClose={closeModal} /> : null}
      {modal.kind === 'row' && modal.action === 'status' ? (
        <UpdateStatusModal task={modal.task} onClose={closeModal} />
      ) : null}
      {modal.kind === 'row' && modal.action === 'complete' ? (
        <CompleteModal task={modal.task} onClose={closeModal} />
      ) : null}
      {modal.kind === 'row' && modal.action === 'reassign' ? (
        <ReassignModal task={modal.task} onClose={closeModal} />
      ) : null}
      {modal.kind === 'row' && modal.action === 'cancel' ? (
        <CancelModal task={modal.task} onClose={closeModal} />
      ) : null}
    </div>
  );
}
