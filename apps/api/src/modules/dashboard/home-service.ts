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
import { canSeeLink, type DashAccess, loadAccess } from './access';
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

/** The same, inside a savepoint — a failed query would otherwise abort the
 *  transaction every other block shares. */
function safe<T>(
  tx: DbTransaction,
  what: string,
  fallback: T,
  fn: (sp: DbTransaction) => Promise<T>,
): Promise<T> {
  return guarded(what, fallback, () => tx.transaction((sp) => fn(sp as unknown as DbTransaction)));
}

const MONEY_FORMS: readonly AccessFormKey[] = ['pr_create', 'po_create'];

export async function getHome(user: AuthContext, query: HomeQuery = {}): Promise<HomeResponse> {
  const cid = requireCompany(user);
  // My department (every row) or Mine (rows the caller raised / received):
  // applied INSIDE each list query, so a list's total and its cue are the
  // mine set too.
  const { scope } = homeQuerySchema.parse(query);
  const a = await loadAccess(user);
  const today = istToday();
  const cfg = await getConfig(user);
  // Access reads open their own transactions — all of them before ours.
  const showMoney = new Set<AccessFormKey>();
  for (const f of MONEY_FORMS) if (await canSeeFormPrice(user, f)) showMoney.add(f);
  const canRemind = await canWrite(user);
  // Opens its own transactions, so it runs before ours — guarded the same way
  // as every block: a failure empties only the approvals block.
  const approvals = holdsAnyApprove(a)
    ? await guarded('approvals', null, () => getApprovalInbox(user))
    : null;

  return withUserContext(user, async (tx) => {
    const me = (await tx.execute(sql`
      SELECT u.full_name, ua.main_dept
      FROM public.users u
      LEFT JOIN public.user_access ua
        ON ua.user_id = u.id AND ua.company_id = ${cid}::uuid AND ua.deleted_at IS NULL
      WHERE u.id = ${user.id}::uuid
      LIMIT 1
    `)) as unknown as Array<{ full_name: string | null; main_dept: string | null }>;
    const myName = me[0]?.full_name ?? '';
    const mainDept = resolveMainDept(me[0]?.main_dept ?? null, a);

    const c: ListCtx = { cid, today, myName };
    const rc: RowCtx = { a, today, userId: user.id, showMoney };

    const built: Array<ListWithLate & { dept: string }> = [];
    for (const d of visibleListDefs(a)) {
      const res = await safe<ListResult | null>(tx, d.key, null, (sp) =>
        runList(sp, d.query(c, scope === 'mine' ? { createdBy: user.id } : {}), {
          limit: HOME_PAGE_SIZE,
        }),
      );
      if (!res) continue;
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
    }
    const ordered = orderByDept(built, mainDept);

    // ONE holders memo for the request (sent + waiting + remind targets).
    const holders = makeHolders(tx, cid);
    const sent = await safe<DashRow[]>(tx, 'sentForApproval', [], (sp) =>
      sentForApproval(sp, c, rc, holders, canRemind),
    );
    const wait = await safe<OwnRows>(tx, 'waiting', { rows: [], total: 0 }, (sp) =>
      waiting(sp, c, rc, holders, canRemind),
    );
    const todoBlock = await safe<HomeResponse['todo']>(
      tx,
      'todo',
      { late: [], today: [], planned: [] },
      (sp) => todo(sp, cid, user.id, today),
    );
    const doneBlock = await safe<HomeResponse['done']>(
      tx,
      'done',
      { today: [], yesterday: [], todayTotal: 0, yesterdayTotal: 0 },
      (sp) => done(sp, cid, user.id, today),
    );
    const notifications = await safe<HomeResponse['notifications']>(
      tx,
      'notifications',
      { items: [], unseen: 0, seenAt: null },
      (sp) => buildNotifications(sp, a, c, user.id, approvals),
    );

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
  });
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
