// Home (Dashboard) — ADR-250: ONE per-person home for every user, replacing
// the admin / operator / specialist layouts (ADR-044). Every block, row,
// action, link and notification is decided by the caller's rights
// (dashboard/access.ts hasTick / canSeeLink, lib/access.ts canSeeFormPrice /
// canWrite). Read-only: the only write is the caller's own "seen" time.

import {
  type AccessFormKey,
  DASHBOARD_QUICK_LINKS,
  type DashList,
  type DashRow,
  type HomeResponse,
  type HomeQuery,
  homeQuerySchema,
  type MarkNotificationsSeenInput,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice, canWrite } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getApprovalInbox } from '../approvals/service';
import { canSeeLink, type DashAccess, hasTick, loadAccess } from './access';
import { getConfig } from './config-service';
import { done, makeHolders, type OwnRows, sentForApproval, todo, waiting } from './personal/blocks';
import { HOME_PAGE_SIZE, type ListResult, runList } from './personal/list-query';
import {
  defDept,
  holdsAnyApprove,
  type ListCtx,
  type RowCtx,
  toDashRow,
  visibleListDefs,
} from './personal/lists';
import { orderByDept, resolveMainDept } from './personal/main-dept';
import { buildNotifications, markSeenSql } from './personal/notifications';
import { buildCues, buildHeadline, type ListWithLate } from './personal/summary';
import { istToday } from './personal/util';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function greetingPart(): string {
  const istHour = Number(
    new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }),
  );
  if (istHour < 12) return 'morning';
  if (istHour < 17) return 'afternoon';
  return 'evening';
}
function dateLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function visibleQuickLinks(a: DashAccess, selected: string[] | null): string[] {
  return DASHBOARD_QUICK_LINKS.filter((l) => canSeeLink(a, l.dept, l.page))
    .filter((l) => !selected || selected.includes(l.page))
    .map((l) => l.page);
}

/** A failing block must not sink the home: log it, return its empty form. */
async function guarded<T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.error({ err, block: what }, 'dashboard home block failed');
    return fallback;
  }
}

/** How many home blocks read at once. Each block is its own short transaction,
 *  so one caller's home never holds more than this many pool connections. */
const HOME_PARALLEL = 4;

/** Run the tasks HOME_PARALLEL at a time; results keep the input order. */
async function inParallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(HOME_PARALLEL, tasks.length) }, worker));
  return out;
}

/** One block in its own transaction, guarded: a failing query empties only it. */
function own<T>(
  user: AuthContext,
  what: string,
  fallback: T,
  fn: (tx: DbTransaction) => Promise<T>,
): () => Promise<T> {
  return () => guarded(what, fallback, () => withUserContext(user, fn));
}

const MONEY_FORMS: readonly AccessFormKey[] = ['pr_create', 'po_create'];

export async function getHome(user: AuthContext, query: HomeQuery = {}): Promise<HomeResponse> {
  const cid = requireCompany(user);
  // My department (every row) or Mine (rows the caller raised / received):
  // applied INSIDE each list query, so a list's total and its cue are the
  // mine set too.
  const { scope } = homeQuerySchema.parse(query);
  // The access read is remembered for the request (ADR-229), so it goes first
  // and every check below reuses it. Everything after it is independent and
  // reads at the same time: the home takes as long as its slowest block, not
  // the sum of all of them.
  const a = await loadAccess(user);
  const today = istToday();
  const [cfg, money, canRemind, approvals, me] = await Promise.all([
    getConfig(user),
    Promise.all(MONEY_FORMS.map((f) => canSeeFormPrice(user, f))),
    canWrite(user),
    // A failure empties only the approvals block.
    holdsAnyApprove(a) ? guarded('approvals', null, () => getApprovalInbox(user)) : null,
    withUserContext(
      user,
      async (tx) =>
        (await tx.execute(sql`
          SELECT u.full_name, ua.main_dept
          FROM public.users u
          LEFT JOIN public.user_access ua
            ON ua.user_id = u.id AND ua.company_id = ${cid}::uuid AND ua.deleted_at IS NULL
          WHERE u.id = ${user.id}::uuid
          LIMIT 1
        `)) as unknown as Array<{ full_name: string | null; main_dept: string | null }>,
    ),
  ]);
  const showMoney = new Set<AccessFormKey>(MONEY_FORMS.filter((_, i) => money[i]));
  const myName = me[0]?.full_name ?? '';
  const mainDept = resolveMainDept(me[0]?.main_dept ?? null, a);
  const c: ListCtx = { cid, today, myName };
  const rc: RowCtx = { a, today, userId: user.id, showMoney };

  const defs = visibleListDefs(a);
  const listTasks = defs.map((d) =>
    own<ListResult | null>(user, d.key, null, (tx) =>
      runList(tx, d.query(c, scope === 'mine' ? { createdBy: user.id } : {}), {
        limit: HOME_PAGE_SIZE,
      }),
    ),
  );
  const emptyPair = { sent: [] as DashRow[], wait: { rows: [], total: 0 } as OwnRows };
  const blockTasks = [
    // Sent + waiting share ONE holders memo (remind targets too), so they read
    // in one transaction.
    own(user, 'sentForApproval+waiting', emptyPair, async (tx) => {
      const holders = makeHolders(tx, cid);
      const sent = await sentForApproval(tx, c, rc, holders, canRemind);
      const wait = await waiting(tx, c, rc, holders, canRemind);
      return { sent, wait };
    }),
    // ADR-257: no tasks on Home for someone whose Task Board is hidden.
    own<HomeResponse['todo']>(user, 'todo', { late: [], today: [], planned: [] }, async (tx) =>
      hasTick(a, 'taskboard_view', 'view')
        ? todo(tx, cid, user.id, today)
        : { late: [], today: [], planned: [] },
    ),
    own<HomeResponse['done']>(
      user,
      'done',
      { today: [], yesterday: [], todayTotal: 0, yesterdayTotal: 0 },
      (tx) => done(tx, cid, user.id, today),
    ),
    own<HomeResponse['notifications']>(
      user,
      'notifications',
      { items: [], unseen: 0, seenAt: null },
      (tx) => buildNotifications(tx, a, c, user.id, approvals),
    ),
  ];
  const results = await inParallel<unknown>([...listTasks, ...blockTasks]);
  const listResults = results.slice(0, defs.length) as Array<ListResult | null>;
  const [pair, todoBlock, doneBlock, notifications] = results.slice(defs.length) as [
    typeof emptyPair,
    HomeResponse['todo'],
    HomeResponse['done'],
    HomeResponse['notifications'],
  ];
  const { sent, wait } = pair;

  const built: Array<ListWithLate & { dept: string }> = [];
  defs.forEach((d, i) => {
    const res = listResults[i];
    if (!res) return;
    const list: DashList = {
      key: d.key as DashList['key'],
      title: d.title,
      dept: defDept(d),
      head: d.head,
      total: res.total,
      rows: res.rows.map((r) => toDashRow(d, r, rc)),
      href: d.href,
    };
    built.push({ list, lateTotal: res.lateTotal, dept: list.dept });
  });
  const ordered = orderByDept(built, mainDept);

  return {
    userName: myName || user.email,
    role: user.role,
    dateLabel: dateLabel(),
    greetingPart: greetingPart(),
    isAdmin: a.isAdmin,
    mainDept,
    headline: buildHeadline(ordered, approvals),
    cues: buildCues(ordered, approvals, wait.total, doneBlock.todayTotal),
    approvals,
    sentForApproval: sent,
    lists: ordered.map((l) => l.list),
    waiting: wait.rows,
    waitingTotal: wait.total,
    todo: todoBlock,
    done: doneBlock,
    notifications,
    quickLinks: visibleQuickLinks(a, cfg.quickLinks),
  };
}

/** POST /dashboard/notifications/seen — the caller's own seen time, forward only. */
export async function markNotificationsSeen(
  input: MarkNotificationsSeenInput,
  user: AuthContext,
): Promise<{ seenAt: string }> {
  const cid = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(markSeenSql(cid, user.id, input.seenAt))) as unknown as Array<{
      setting_value: string;
    }>;
    return { seenAt: new Date(rows[0]!.setting_value).toISOString() };
  });
}
