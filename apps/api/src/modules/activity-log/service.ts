// Activity log service (T-051). Read-only list with filters.
//
// Append-only: there are no create/update/delete service functions.
// Future emitters (logActivity from inside other services) will INSERT
// directly via withUserContext — kept out of this module to avoid
// circular module dependencies.

import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { activityLog } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import type { ActivityLogEntry, ListActivityLogQuery, ListActivityLogResponse } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function rowToEntry(r: typeof activityLog.$inferSelect): ActivityLogEntry {
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
    if (input.fromDate) {
      conditions.push(gte(activityLog.ts, new Date(input.fromDate)));
    }
    if (input.toDate) {
      conditions.push(lte(activityLog.ts, new Date(input.toDate)));
    }

    const where = and(...conditions);

    const [rows, totals, distinctActions, distinctUsers] = await Promise.all([
      tx
        .select()
        .from(activityLog)
        .where(where)
        .orderBy(desc(activityLog.ts), desc(activityLog.id))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(activityLog).where(where),
      // Distinct action values present for the company — drives the filter
      // dropdown without a separate /actions endpoint.
      tx
        .selectDistinct({ action: activityLog.action })
        .from(activityLog)
        .where(eq(activityLog.companyId, companyId))
        .orderBy(activityLog.action),
      // Distinct {id, name} pairs. NULL ids collapse together — UI shows
      // them as snapshot-only entries (e.g. legacy "Japan").
      tx
        .selectDistinct({
          id: activityLog.userId,
          name: activityLog.userName,
        })
        .from(activityLog)
        .where(eq(activityLog.companyId, companyId))
        .orderBy(activityLog.userName),
    ]);

    return {
      entries: rows.map((r) => rowToEntry(r as typeof activityLog.$inferSelect)),
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
      actions: distinctActions.map((r) => r.action),
      users: distinctUsers.map((r) => ({ id: r.id, name: r.name })),
    };
  });
}

// Standalone emitter — owns its own transaction. Use when there's no
// caller-side tx already running.
export async function appendActivityLog(
  input: {
    action: string;
    entity: string;
    detail?: string;
    refId?: string | null;
  },
  user: AuthContext,
): Promise<void> {
  const companyId = requireCompany(user);
  await withUserContext(user, async (tx) => {
    await emitActivityLog(tx, input, companyId, user);
  });
}

// Low-level emitter — writes inside an existing transaction so the audit
// row is atomic with the caller's mutation (rolled back together if the
// outer tx fails). Used by items / sales-orders / nc-register / etc.
// service modules that emit on create / update / softDelete inside their
// existing withUserContext block.
export async function emitActivityLog(
  tx: DbTransaction,
  input: {
    action: string;
    entity: string;
    detail?: string;
    refId?: string | null;
  },
  companyId: string,
  user: AuthContext,
): Promise<void> {
  await tx.insert(activityLog).values({
    companyId,
    ts: new Date(),
    userId: user.id,
    userName: user.email,
    action: input.action,
    entity: input.entity,
    detail: input.detail ?? '',
    refId: input.refId ?? null,
    createdBy: user.id,
  });
}
