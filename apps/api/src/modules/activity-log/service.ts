// Activity log service (T-051). Read-only list with filters.
//
// Append-only: there are no create/update/delete service functions.
// Future emitters (logActivity from inside other services) will INSERT
// directly via withUserContext — kept out of this module to avoid
// circular module dependencies.

import type { ActivityAction, ActivityChange, ActivityEntity } from '@innovic/shared';
import { and, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { activityLog, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import type { ActivityLogEntry, ListActivityLogQuery, ListActivityLogResponse } from './schema';
import { ACTIVITY_LOG_SF_COLUMNS } from './sf-columns';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function rowToEntry(
  r: typeof activityLog.$inferSelect,
  liveFullName: string | null,
): ActivityLogEntry {
  return {
    id: r.id,
    companyId: r.companyId,
    ts: r.ts.toISOString(),
    userId: r.userId,
    userName: r.userName,
    action: r.action,
    entity: r.entity,
    detail: r.detail,
    refId: r.refId,
    createdAt: r.createdAt.toISOString(),
    // ADR-197: the name snapshotted on the row, else today's full name, else
    // the e-mail (legacy rows).
    userFullName: r.userFullName ?? liveFullName ?? r.userName,
    entityId: r.entityId,
  };
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Activity Log search box gets a wildcard pattern instead of a
 *  literal search — i.e. the search box becomes a "show everything" button.
 *  Postgres's DEFAULT LIKE/ILIKE escape character is backslash, so no explicit
 *  ESCAPE clause is needed here (and drizzle's `ilike()` builder, which this
 *  list is written with, cannot emit one) — verified against the live database.
 *  Deliberately a local copy of the sales-orders / purchase-orders helper
 *  rather than an export across modules: it is three lines, and each list must
 *  be free to change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listActivityLog(
  input: ListActivityLogQuery,
  user: AuthContext,
): Promise<ListActivityLogResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(activityLog.companyId, companyId)];

    if (input.search) {
      // Search covers exactly the seven columns the log table (activity-log/
      // routes/list.tsx) shows: Date, Time, Action, Entity, Detail, Ref, User.
      // Detail is matched because it IS a visible column here — it holds the
      // one-line human summary the row prints, not a hidden payload or diff
      // blob. This table stores no such blob, and nothing that is not on the
      // screen is searchable: an audit trail must not become a way to probe for
      // records the search box never displays.
      const pattern = `%${escapeLikeTerm(input.search)}%`;
      const searchCondition = or(
        ilike(activityLog.action, pattern),
        ilike(activityLog.entity, pattern),
        ilike(activityLog.detail, pattern),
        ilike(activityLog.userName, pattern),
        // The User column shows the person's name (ADR-197): the row's
        // snapshot, or today's full name for rows written before it existed.
        ilike(activityLog.userFullName, pattern),
        sql`EXISTS (SELECT 1 FROM users u WHERE u.id = ${activityLog.userId} AND u.full_name ILIKE ${pattern})`,
        ilike(activityLog.refId, pattern),
        // Date + Time columns. Both are rendered from `ts`, which is stored in
        // UTC and displayed in IST (CLAUDE.md §6.5), so the text a user reads
        // is the IST one — match that, or an evening entry would answer to
        // yesterday's date. Gives "2026-09-07" and "18:04" style searches.
        sql`(${activityLog.ts} AT TIME ZONE 'Asia/Kolkata')::text ILIKE ${pattern}`,
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (input.action) {
      conditions.push(eq(activityLog.action, input.action));
    }
    if (input.userId) {
      conditions.push(eq(activityLog.userId, input.userId));
    }
    // Date range = whole India-time days (CLAUDE.md §6.5). `ts` is UTC; the
    // old `ts <= new Date(toDate)` stopped at 05:30 IST on the last day and
    // `ts >= new Date(fromDate)` began at 05:30 IST on the first. Written as
    // bounds on `ts` itself (IST midnight → the instant) so the
    // (company_id, ts) index still serves the range.
    if (input.fromDate) {
      conditions.push(
        sql`${activityLog.ts} >= ((${input.fromDate}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      );
    }
    if (input.toDate) {
      conditions.push(
        sql`${activityLog.ts} < ((${input.toDate}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`,
      );
    }
    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to list AND count —
    // both join `users`, which the User field reads.
    const sf = readSf(input.sf);
    // sfWhere answers `AND (…)`; a leading TRUE makes it one condition.
    if (sf && sf.filters.length > 0) {
      conditions.push(sql`TRUE ${sfWhere(ACTIVITY_LOG_SF_COLUMNS, sf)}`);
    }
    const orderBy = sfOrderBy(
      ACTIVITY_LOG_SF_COLUMNS,
      sf,
      sql`${activityLog.ts} DESC, ${activityLog.id} DESC`,
    );

    const where = and(...conditions);
    const userNameExpr = sql<string>`COALESCE(${users.fullName}, ${activityLog.userName})`;

    const [rows, totals, distinctActions, distinctUsers] = await Promise.all([
      tx
        .select({ log: activityLog, liveFullName: users.fullName })
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.userId))
        .where(where)
        .orderBy(orderBy)
        .limit(input.limit)
        .offset(input.offset),
      tx
        .select({ value: count() })
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.userId))
        .where(where),
      // Distinct action values present for the company — drives the filter
      // dropdown without a separate /actions endpoint.
      tx
        .selectDistinct({ action: activityLog.action })
        .from(activityLog)
        .where(eq(activityLog.companyId, companyId))
        .orderBy(activityLog.action),
      // Distinct {id, name} pairs. NULL ids collapse together — UI shows
      // them as snapshot-only entries (e.g. legacy "Japan"). The name is the
      // person's full name where the users row has one (ADR-197).
      tx
        .selectDistinct({
          id: activityLog.userId,
          name: userNameExpr,
        })
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.userId))
        .where(eq(activityLog.companyId, companyId))
        .orderBy(userNameExpr),
    ]);

    return {
      entries: rows.map((r) => rowToEntry(r.log, r.liveFullName)),
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
      actions: distinctActions.map((r) => r.action),
      users: distinctUsers.map((r) => ({ id: r.id, name: r.name })),
    };
  });
}

// ─── Writers ────────────────────────────────────────────────────────────────

/**
 * What one activity-log row records (ADR-197). Only `action` and `entity` are
 * required, so every pre-ADR-197 caller keeps compiling unchanged. New code
 * uses the standard names (`ActivityAction`, `ACTIVITY_ENTITIES`) and fills
 * the fields that apply — docs/AUDIT-TRAIL.md has one example per action.
 */
export interface ActivityLogInput {
  /** Standard `ActivityAction` (UPPER_SNAKE). Free text is still accepted
   *  for legacy callers. */
  action: ActivityAction | (string & {});
  /** Standard entity name — the DOCUMENT, never a line or an op. */
  entity: ActivityEntity | (string & {});
  /** One-line human summary (still shown on the global Activity Log). */
  detail?: string | undefined;
  /** The document's code, e.g. IN-PO-00012. */
  refId?: string | null | undefined;
  /** The document's uuid (header row). */
  entityId?: string | null | undefined;
  /** Which line, e.g. `Line 2`. */
  lineRef?: string | null | undefined;
  /** Which operation, e.g. `Op 20 · Turning`. */
  opRef?: string | null | undefined;
  /** Quantity this action moved. */
  qty?: number | string | null | undefined;
  /** Before → after list — build it with diffFields(). */
  changes?: ActivityChange[] | null | undefined;
  /** Why — required by the service for REASON_REQUIRED_ACTIONS. */
  reason?: string | null | undefined;
  /** Operator / inspector named on the entry (when not the user). */
  operatorName?: string | null | undefined;
}

// Standalone emitter — owns its own transaction. Use when there's no
// caller-side tx already running.
export async function appendActivityLog(input: ActivityLogInput, user: AuthContext): Promise<void> {
  const companyId = requireCompany(user);
  await withUserContext(user, async (tx) => {
    await emitActivityLog(tx, input, companyId, user);
  });
}

function blankToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

// Low-level emitter — writes inside an existing transaction so the audit
// row is atomic with the caller's mutation (rolled back together if the
// outer tx fails). Used by items / sales-orders / nc-register / etc.
// service modules that emit on create / update / softDelete inside their
// existing withUserContext block.
export async function emitActivityLog(
  tx: DbTransaction,
  input: ActivityLogInput,
  companyId: string,
  user: AuthContext,
): Promise<void> {
  // The user's name is snapshotted on every row (ADR-197). The auth plugin
  // sets `fullName`; only a caller that built its own AuthContext (tests,
  // scripts) leaves it undefined, and then it is read from users.
  let fullName: string | null = user.fullName ?? null;
  if (user.fullName === undefined) {
    const u = await tx
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    fullName = u[0]?.fullName ?? null;
  }

  let qty: string | null = null;
  if (input.qty !== undefined && input.qty !== null && input.qty !== '') {
    const n = Number(input.qty);
    if (Number.isFinite(n)) qty = String(n);
  }

  await tx.insert(activityLog).values({
    companyId,
    ts: new Date(),
    userId: user.id,
    userName: user.email,
    userFullName: blankToNull(fullName),
    action: input.action,
    entity: input.entity,
    detail: input.detail ?? '',
    refId: input.refId ?? null,
    entityId: input.entityId ?? null,
    lineRef: blankToNull(input.lineRef),
    opRef: blankToNull(input.opRef),
    qty,
    changes: input.changes && input.changes.length > 0 ? input.changes : null,
    reason: blankToNull(input.reason),
    operatorName: blankToNull(input.operatorName),
    createdBy: user.id,
  });
}
