// Task Board (ADR-176) — the approved Inbox / Outbox / My To-Do / All Tasks
// board. Title row with "+ My To-Do" and "+ Assign Task" (any user), a tab
// strip with open counts, the filter bar (search + Status / Priority / Person /
// Due Date, with the TO DO / IN PROGRESS / COMPLETED / OVERDUE counts in the
// Status and Due Date options — they replaced the clickable KPI strip), the table, and a hint
// line that names the view. `?view=` keeps the tab across a refresh;
// `?task=<uuid>` (Global Search deep link) opens that task's detail on
// arrival; `?search=` keeps the typed term; `?page=` the page (ADR-201: 25
// rows a page — search, filters and Sort & Filter run on the server over the
// whole view, any change → page 1). Everything else is local state.
//
// The All Tasks tab renders ONLY when the server says the caller is admin
// (`isAdmin` on the list response) — never merely disabled — and the server
// refuses view=all for anyone else regardless.
// Day Log tabs (`?view=daylog|team|person|approvals`, `?date=`, `?user=`, `?line=`):
// see modules/day-logs/components/board-day-log.tsx.
// Task Board and Day Log are two pages on this one route, each with its own
// "Hide page" switch (taskboard_view / daylog_view, canOpenPage tells them
// apart by `?view=`). The route guard lets in whoever may open either; this
// page then draws — and loads — only the half the person may see, and moves a
// URL for the hidden half to the other one.

import type {
  ListTasksQuery,
  TaskDueFilter,
  TaskPriority,
  TaskRow,
  TaskStatus,
  TaskView,
} from '@innovic/shared';
import { DAY_LOG_VIEWS, TASK_VIEWS } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useCanOpen, useCanWrite } from '@/components/shared/action-link';
import { useMyAccess } from '@/lib/access-control';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader } from '@/ui/layout';
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
import {
  DayLogBoardBody,
  dayLogTabOf,
  dayLogSearchShape,
  isDayLogTab,
  useDayLogBoardTabs,
  type DayLogNav,
} from '@/modules/day-logs/components/board-day-log';

const searchSchema = z.object({
  task: z.string().uuid().optional(),
  view: z.enum([...TASK_VIEWS, ...DAY_LOG_VIEWS]).optional(),
  ...dayLogSearchShape,
  search: z.string().optional(),
  page: pageSearchParam,
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
  // Which of the two pages this person may see (the same rule as the menu).
  // If the access read failed, the route guard lets the page in as before and
  // the server judges each request — so show both halves rather than nothing.
  const canOpen = useCanOpen();
  const accessFailed = useMyAccess().isError;
  const canTasks = accessFailed || canOpen('/task-board');
  const canDayLog = accessFailed || canOpen('/task-board?view=daylog');
  const tab = routeSearch.view ?? 'inbox';
  // Day Log only → every URL shows the Day Log; Task Board only → never.
  const dayTab = !canDayLog ? null : isDayLogTab(tab) ? tab : canTasks ? null : 'daylog';
  // On a day-log tab the task list keeps loading Inbox: the tab strip and its
  // counts come from it.
  const view: TaskView = isDayLogTab(tab) ? 'inbox' : tab;
  const dayTabs = useDayLogBoardTabs(canDayLog, dayTab);
  // ADR-232/234: + Assign Task / + My To-Do are writes — hidden for an
  // Auditor or an account nobody has set up (the server refuses them too) —
  // and with the Task Board page hidden.
  const canWrite = useCanWrite() && canTasks;
  // A URL for the hidden page moves to the other one (replace — Back skips it).
  const wrongDay = canDayLog && !canTasks && !isDayLogTab(tab);
  const wrongTask = canTasks && !canDayLog && isDayLogTab(tab);
  useEffect(() => {
    if (wrongDay)
      void navigate({
        search: (prev) => ({ ...prev, view: 'daylog', task: undefined, page: 1 }),
        replace: true,
      });
    else if (wrongTask)
      void navigate({
        search: (prev) => ({
          ...prev,
          view: 'inbox',
          date: undefined,
          user: undefined,
          line: undefined,
          page: 1,
        }),
        replace: true,
      });
  }, [wrongDay, wrongTask, navigate]);

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
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, routeSearch.search, navigate]);

  const [status, setStatusRaw] = useState<TaskStatus | ''>('');
  const [priority, setPriorityRaw] = useState<TaskPriority | ''>('');
  const [person, setPersonRaw] = useState('');
  const [assignedBy, setAssignedByRaw] = useState('');
  const [dept, setDeptRaw] = useState('');
  const [due, setDueRaw] = useState<TaskDueFilter | ''>('');

  const page = routeSearch.page;
  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  // Every filter change goes back to page 1.
  function toFirst<T>(set: (v: T) => void): (v: T) => void {
    return (v) => {
      set(v);
      gotoPage(1);
    };
  }
  const setStatus = toFirst(setStatusRaw);
  const setPriority = toFirst(setPriorityRaw);
  const setPerson = toFirst(setPersonRaw);
  const setAssignedBy = toFirst(setAssignedByRaw);
  const setDept = toFirst(setDeptRaw);
  const setDue = toFirst(setDueRaw);
  const sf = useServerSortFilter(TABLE_KEYS.taskBoard, () => gotoPage(1));

  const setView = (v: TaskView): void => {
    // The person filters mean something different on each tab — reset them.
    setPersonRaw('');
    setAssignedByRaw('');
    setDeptRaw('');
    void navigate({
      search: (prev) => ({
        ...prev,
        view: v,
        task: undefined,
        date: undefined,
        user: undefined,
        line: undefined,
        page: 1,
      }),
      replace: true,
    });
  };
  // Day-log tabs: switch tab / day / person (the task filters stay as they are).
  const goDay = (s: DayLogNav): void => {
    void navigate({
      search: (prev) => ({ ...prev, task: undefined, page: 1, ...s }),
      replace: true,
    });
  };

  // `?task=<uuid>` opens that task's detail on arrival. Lazy initial covers the
  // cold load; the effect covers a NEW ?task landing while this page is already
  // mounted (same route, no remount).
  // Only for someone who may see the Task Board.
  const [modal, setModal] = useState<ModalState>(() =>
    routeSearch.task && canTasks ? { kind: 'view', id: routeSearch.task } : { kind: 'none' },
  );
  useEffect(() => {
    if (routeSearch.task && canTasks) setModal({ kind: 'view', id: routeSearch.task });
  }, [routeSearch.task, canTasks]);
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
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    }),
    [view, routeSearch.search, status, priority, person, assignedBy, due, dept, sf.param, page],
  );
  const { data, isLoading, isFetching, isError, error } = useTaskList(query, canTasks);
  useClampPage(page, data?.total, gotoPage);
  const { data: userOpts } = useTaskUserOptions(canTasks);
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
    if (markedRef.current || !canTasks) return;
    markedRef.current = true;
    markViewed.mutate();
  }, [markViewed, canTasks]);

  const onRowAction = (action: RowAction, task: TaskRow): void => {
    if (action === 'view') setModal({ kind: 'view', id: task.id });
    else setModal({ kind: 'row', action, task });
  };

  if (canTasks && isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (canTasks && !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load tasks. Try again.'}
      </div>
    );
  }

  const counts = data?.counts;
  const tabs: TaskView[] = !data
    ? []
    : data.isAdmin
      ? [...TASK_VIEWS]
      : TASK_VIEWS.filter((v) => v !== 'all');
  const tabCount = (v: TaskView): number | null => data?.viewCounts[v] ?? null;

  return (
    <div>
      <ListHeader
        title={canTasks ? 'Task Board' : 'Day Log'}
        icon={canTasks ? '📋' : '📝'}
        count={dayTab ? undefined : data?.total}
        noun="task"
        search={searchInput}
        onSearch={dayTab ? undefined : setSearchInput}
        searchPlaceholder="Search Task No., title, related document…"
        updating={!dayTab && isFetching}
        filters={
          dayTab ? undefined : (
            <TaskFilters
              view={view}
              users={users}
              departments={departments}
              values={{ searchInput, status, priority, person, assignedBy, dept, due }}
              counts={counts}
              onStatus={setStatus}
              onPriority={setPriority}
              onPerson={setPerson}
              onAssignedBy={setAssignedBy}
              onDept={setDept}
              onDue={setDue}
            />
          )
        }
        onClearFilters={
          dayTab
            ? undefined
            : () => {
                setStatusRaw('');
                setPriorityRaw('');
                setPersonRaw('');
                setAssignedByRaw('');
                setDeptRaw('');
                setDueRaw('');
                setSearchInput('');
                sf.clearFilters();
                void navigate({
                  search: (prev) => ({ ...prev, search: undefined, page: 1 }),
                  replace: true,
                });
              }
        }
        filtersActive={
          sf.filtering ||
          status !== '' ||
          priority !== '' ||
          person !== '' ||
          assignedBy !== '' ||
          dept !== '' ||
          due !== '' ||
          searchInput.trim() !== ''
        }
        tools={
          <>
            {data && data.unreadCount > 0 ? (
              <span className="badge b-red">🔔 {data.unreadCount} new</span>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModal({ kind: 'todo' })}
              >
                + My To-Do
              </button>
            ) : null}
          </>
        }
        primary={
          canWrite ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setModal({ kind: 'assign' })}
            >
              + Assign Task
            </button>
          ) : undefined
        }
      >
        <TaskTabs
          tabs={tabs}
          view={dayTab ? dayLogTabOf(dayTab) : tab}
          countOf={tabCount}
          onChange={setView}
          extra={dayTabs}
          onExtra={(t) =>
            goDay({
              view: isDayLogTab(t) ? t : 'daylog',
              user: undefined,
              line: undefined,
            })
          }
        />
      </ListHeader>

      {dayTab ? (
        <DayLogBoardBody
          tab={dayTab}
          date={routeSearch.date}
          user={routeSearch.user}
          line={routeSearch.line}
          onNav={goDay}
        />
      ) : data ? (
        <>
          {isError ? (
            // A refetch failed (e.g. a non-admin landing on ?view=all): keep the
            // board and its tabs on screen so the user can move off the bad view.
            <div
              className="panel"
              style={{ padding: '8px 12px', fontSize: 12, color: 'var(--red2)' }}
            >
              {error instanceof Error ? error.message : 'Could not load tasks. Try again.'}
            </div>
          ) : null}

          <TaskTable
            rows={data.tasks}
            view={view}
            filtered={Boolean(
              routeSearch.search ||
              status ||
              priority ||
              person ||
              assignedBy ||
              dept ||
              due ||
              sf.filtering,
            )}
            sortFilterServer={sf}
            onAction={onRowAction}
          />
          <ListFooter
            total={data.total}
            noun="task"
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={gotoPage}
          />
        </>
      ) : null}

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
