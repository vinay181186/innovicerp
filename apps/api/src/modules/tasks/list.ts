// Task Board list (ADR-176; ADR-201 25-row pages). Split out of service.ts.
//
// Every row filter (search, status, priority, person, assigned by, due date,
// department) and the Sort & Filter (ADR-200) run in SQL over the WHOLE view,
// so a task on page 3 is found from page 2. `total` uses the page's WHERE. The
// KPI counts are over the whole view BEFORE row filters (as before); the tab
// counters + unread are over the caller's open tasks. No `limit` → every row
// of the view, as before.

import type { ListTasksQuery, ListTasksResponse, TaskRow, TaskView } from '@innovic/shared';
import {
  type AnyColumn,
  and,
  count,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { tasks } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';
import {
  OPEN_STATUSES,
  type RowContext,
  addDays,
  isAdmin,
  isUnreadRow,
  istToday,
  loadUserNames,
  requireCompany,
  rowToTask,
  visibleTasksWhere,
} from './history';
import { loadCounts } from './service';

const nameSql = (col: AnyColumn): SQL =>
  sql`(SELECT u.full_name FROM public.users u WHERE u.id = ${col})`;

/** Open and past its due date (IST today) — the same rule as isOverdueRow. */
const overdueSql = (today: string): SQL =>
  sql`(${tasks.status} IN ('todo', 'in_progress') AND ${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < ${today}::date)`;

/**
 * Sort & Filter columns. The person column is the OTHER party of the view, as
 * the screen prints it (personName): Inbox → assigned by (else creator), To-Do
 * → "Me", Outbox / All → assigned to.
 */
export function taskSfColumns(view: TaskView): SfColumnMap {
  const person =
    view === 'inbox'
      ? sql`COALESCE(${nameSql(tasks.assignedBy)}, ${nameSql(tasks.createdBy)})`
      : view === 'todo'
        ? sql`'Me'`
        : nameSql(tasks.assignedTo);
  return {
    code: { sql: sql`${tasks.code}`, type: 'text' },
    title: { sql: sql`${tasks.title}`, type: 'text' },
    person: { sql: person, type: 'text' },
    related: { sql: sql`${tasks.linkedRefDisplay}`, type: 'text' },
    priority: { sql: sql`${tasks.priority}`, type: 'list' },
    dueDate: { sql: sql`${tasks.dueDate}`, type: 'date' },
    status: { sql: sql`${tasks.status}`, type: 'list' },
  };
}

export async function listTasks(
  query: ListTasksQuery,
  user: AuthContext,
): Promise<ListTasksResponse> {
  const companyId = requireCompany(user);
  if (query.view === 'all') requireAdminRole(user);
  const today = istToday();
  const me = user.id;
  const sf = readSf(query.sf);
  const cols = taskSfColumns(query.view);

  return withUserContext(user, async (tx) => {
    const names = await loadUserNames(tx, companyId);

    const viewWhere =
      query.view === 'inbox'
        ? and(eq(tasks.assignedTo, me), ne(tasks.createdBy, me))
        : query.view === 'outbox'
          ? and(eq(tasks.createdBy, me), or(ne(tasks.assignedTo, me), isNull(tasks.assignedTo)))
          : query.view === 'todo'
            ? and(eq(tasks.createdBy, me), eq(tasks.assignedTo, me))
            : undefined; // all — admin, whole company
    const viewSql = and(visibleTasksWhere(companyId, user), viewWhere) as SQL;

    // KPI cards over the whole view, BEFORE row filters. Overdue rows count
    // only as overdue; cancelled rows count in none.
    const od = overdueSql(today);
    const [k] = await tx
      .select({
        todo: sql<number>`count(*) FILTER (WHERE NOT ${od} AND ${tasks.status} = 'todo')::int`,
        inProgress: sql<number>`count(*) FILTER (WHERE NOT ${od} AND ${tasks.status} = 'in_progress')::int`,
        completed: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'completed')::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${od})::int`,
      })
      .from(tasks)
      .where(viewSql);
    const counts = {
      todo: Number(k?.todo ?? 0),
      in_progress: Number(k?.inProgress ?? 0),
      completed: Number(k?.completed ?? 0),
      overdue: Number(k?.overdue ?? 0),
    };

    // Tab counters + unread — one pass over my open tasks.
    const mine = await tx
      .select({
        createdBy: tasks.createdBy,
        assignedTo: tasks.assignedTo,
        viewedAt: tasks.viewedAt,
        status: tasks.status,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.companyId, companyId),
          isNull(tasks.deletedAt),
          inArray(tasks.status, [...OPEN_STATUSES]),
          or(eq(tasks.createdBy, me), eq(tasks.assignedTo, me)),
        ),
      );
    const viewCounts = { inbox: 0, outbox: 0, todo: 0, all: null as number | null };
    let unreadCount = 0;
    for (const r of mine) {
      if (r.assignedTo === me && r.createdBy !== me) viewCounts.inbox += 1;
      else if (r.createdBy === me && r.assignedTo !== me) viewCounts.outbox += 1;
      else if (r.createdBy === me && r.assignedTo === me) viewCounts.todo += 1;
      if (isUnreadRow(r, me)) unreadCount += 1;
    }
    if (isAdmin(user)) {
      const allOpen = await tx
        .select({ n: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.companyId, companyId),
            isNull(tasks.deletedAt),
            inArray(tasks.status, [...OPEN_STATUSES]),
          ),
        );
      viewCounts.all = Number(allOpen[0]?.n ?? 0);
    }

    // Row filters — in SQL, over the whole view.
    const parts: SQL[] = [viewSql];
    const s = (query.search ?? '').trim();
    if (s) {
      const pat = `%${likeEscape(s)}%`;
      parts.push(
        sql`(${tasks.code} ILIKE ${pat} ESCAPE '\\' OR ${tasks.title} ILIKE ${pat} ESCAPE '\\'
          OR COALESCE(${tasks.description}, '') ILIKE ${pat} ESCAPE '\\'
          OR COALESCE(${tasks.linkedRefDisplay}, '') ILIKE ${pat} ESCAPE '\\')`,
      );
    }
    if (query.status) parts.push(sql`${tasks.status} = ${query.status}`);
    if (query.priority) parts.push(sql`${tasks.priority} = ${query.priority}`);
    if (query.person) {
      parts.push(
        query.view === 'inbox'
          ? sql`${tasks.assignedBy} = ${query.person}`
          : sql`${tasks.assignedTo} = ${query.person}`,
      );
    }
    if (query.assignedBy) parts.push(sql`${tasks.assignedBy} = ${query.assignedBy}`);
    if (query.due === 'today') parts.push(sql`${tasks.dueDate} = ${today}::date`);
    else if (query.due === 'week') {
      parts.push(sql`${tasks.dueDate} BETWEEN ${today}::date AND ${addDays(today, 6)}::date`);
    } else if (query.due === 'overdue') parts.push(od);
    if (query.dept && query.view === 'all') {
      parts.push(sql`EXISTS (
        SELECT 1 FROM public.user_access ua
        WHERE ua.user_id = ${tasks.assignedTo} AND ua.company_id = ${companyId}
          AND ua.deleted_at IS NULL AND ua.main_dept = ${query.dept})`);
    }
    const where = sql`${sql.join(parts, sql` AND `)} ${sfWhere(cols, sf)}`;
    const order = sfOrderBy(cols, sf, sql`${tasks.createdAt} DESC, ${tasks.id} DESC`);

    const base = tx.select().from(tasks).where(where).orderBy(order);
    const offset = query.offset ?? 0;
    const rows =
      query.limit !== undefined
        ? await base.limit(query.limit).offset(offset)
        : offset > 0
          ? await base.offset(offset)
          : await base;
    const [cnt] = await tx.select({ n: count() }).from(tasks).where(where);

    const perTask = await loadCounts(
      tx,
      companyId,
      rows.map((r) => r.id),
    );
    const ctx: RowContext = { names, user, today, ...perTask };
    const mapped: TaskRow[] = rows.map((r) => rowToTask(r, ctx));

    return {
      tasks: mapped,
      total: Number(cnt?.n ?? 0),
      counts,
      viewCounts,
      unreadCount,
      isAdmin: isAdmin(user),
    };
  });
}
