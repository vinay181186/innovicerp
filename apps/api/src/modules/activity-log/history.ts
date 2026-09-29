// Per-document history read (ADR-197) — GET /activity-log/history.
//
// Kept OUT of service.ts on purpose: service.ts holds emitActivityLog, which
// nearly every module imports (access-control included). This file needs the
// Access Control check, so housing it there would close an import cycle.

import {
  ACTIVITY_ENTITY_META,
  activityActionLabel,
  activityEntitySpellings,
  canonicalActivityEntity,
  hasDeptAccess,
  type ActivityChange,
  type ActivityHistoryQuery,
  type ActivityHistoryResponse,
} from '@innovic/shared';
import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { activityLog, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { getMyAccess } from '../access-control/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** Who may read one document's history: the same `view` right as the
 *  document's own page when the entity maps to an Access Control form, else
 *  the Activity Log's own gate (the Tasks & Alerts department it sits in). */
async function requireHistoryAccess(entity: string, user: AuthContext): Promise<void> {
  if (user.role === 'admin') return;
  const std = canonicalActivityEntity(entity);
  const viewForm = std ? ACTIVITY_ENTITY_META[std].viewForm : null;
  if (viewForm) {
    await requireFormAccess(user, viewForm, 'view');
    return;
  }
  if (hasDeptAccess(await getMyAccess(user), 'tasks')) return;
  throw new AuthorizationError('Your access does not let you open the Activity Log.');
}

/** jsonb `changes` → the contract's array (defensive: an old or hand-written
 *  row that is not an array reads as no changes). */
function readChanges(v: unknown): ActivityChange[] {
  return Array.isArray(v) ? (v as ActivityChange[]) : [];
}

/**
 * GET /activity-log/history — one document's trail, newest first.
 *
 * Matches every stored spelling of the entity (legacy `Job Card` and
 * `JcOp` rows belong to the JobCard trail), and a row belongs to the document
 * when its `entity_id` is the id, OR its `ref_id` is the code (legacy rows
 * carry only the code), OR its `ref_id` is the id (a few old writers logged
 * the uuid there). Pages pass both id and code.
 */
export async function getActivityHistory(
  input: ActivityHistoryQuery,
  user: AuthContext,
): Promise<ActivityHistoryResponse> {
  const companyId = requireCompany(user);
  await requireHistoryAccess(input.entity, user);
  return withUserContext(user, async (tx) => {
    const match: SQL[] = [];
    if (input.entityId) {
      match.push(eq(activityLog.entityId, input.entityId));
      match.push(eq(activityLog.refId, input.entityId));
    }
    if (input.refId) match.push(eq(activityLog.refId, input.refId));

    const rows = await tx
      .select({
        id: activityLog.id,
        ts: activityLog.ts,
        userId: activityLog.userId,
        userName: activityLog.userName,
        userFullName: activityLog.userFullName,
        liveFullName: users.fullName,
        operatorName: activityLog.operatorName,
        action: activityLog.action,
        entity: activityLog.entity,
        entityId: activityLog.entityId,
        refId: activityLog.refId,
        lineRef: activityLog.lineRef,
        opRef: activityLog.opRef,
        qty: activityLog.qty,
        changes: activityLog.changes,
        reason: activityLog.reason,
        detail: activityLog.detail,
      })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.userId))
      .where(
        and(
          eq(activityLog.companyId, companyId),
          inArray(activityLog.entity, activityEntitySpellings(input.entity)),
          or(...match),
        ),
      )
      .orderBy(desc(activityLog.ts), desc(activityLog.id))
      .limit(input.limit);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        ts: r.ts.toISOString(),
        userId: r.userId,
        userFullName: r.userFullName ?? r.liveFullName ?? r.userName,
        operatorName: r.operatorName,
        action: r.action,
        actionLabel: activityActionLabel(r.action),
        entity: r.entity,
        entityId: r.entityId,
        refId: r.refId,
        lineRef: r.lineRef,
        opRef: r.opRef,
        qty: r.qty === null ? null : Number(r.qty),
        changes: readChanges(r.changes),
        reason: r.reason,
        detail: r.detail,
      })),
    };
  });
}
