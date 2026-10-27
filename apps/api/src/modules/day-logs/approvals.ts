// Day Log — EDIT APPROVAL (owner 2026-10-27, migration 0225). A saved row's
// edit is staged on the row (pending_*, entries.ts updateEntry); here an
// approver lists, approves (the pending values become the row's values) or
// rejects (the row keeps its values, the reason is kept). Approver: Super
// Admin → everyone; L5 of a department where the person holds L2+ → them.
// Never one's own; an Auditor never (canApproveUser, access.ts).
// Approve / reject run under the day lock of the row (§20.3) and are
// conditional on the SAME request still waiting (§20.2) — a second decision
// is a 409.

import {
  type DayLogApprovalRow,
  type DayLogApprovalsResponse,
  type DayLogRejectInput,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import {
  AppError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import {
  type Viewer,
  accessJson,
  assertCanWrite,
  canApproveUser,
  resolveAccess,
  viewerOf,
} from './access';
import { type DayHeader, type DayLine, ts } from './day';
import { label, log, returning, writeLines } from './entry-write';
import { dayTx, lockAnyEntryDay, requireHeader } from './lock';
import { type DayLogClock, istClock } from './rules';
import { readSnapshot } from './snapshot';
import { hoursOf, requireCompany, validateEntry } from './writes';

const DECIDED = 'This edit was already approved or rejected — reload';

/** Every edit waiting in the company, with the person's rights — ONE json value. */
const pendingJson = (companyId: string): SQL => sql`(
  SELECT COALESCE(json_agg(json_build_object(
           'entryId', l.id::text, 'userId', dr.user_id::text,
           'userName', COALESCE(u.full_name, u.email),
           'departments', COALESCE(ua.departments, '{}'::jsonb),
           'date', to_char(dr.report_date, 'YYYY-MM-DD'),
           'cFrom', to_char(l.from_time, 'HH24:MI'), 'cTo', to_char(l.to_time, 'HH24:MI'),
           'cDesc', l.description, 'cCode', COALESCE(so.code, jw.code),
           'pFrom', to_char(l.pending_from, 'HH24:MI'), 'pTo', to_char(l.pending_to, 'HH24:MI'),
           'pDesc', l.pending_description, 'pCode', COALESCE(pso.code, pjw.code),
           'requestedAt', ${ts('l.pending_at')})
         ORDER BY l.pending_at), '[]'::json)
  FROM public.daily_report_lines l
  JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
  JOIN public.users u ON u.id = dr.user_id
  LEFT JOIN public.user_access ua
    ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
  LEFT JOIN public.sales_orders so ON so.id = l.sales_order_id
  LEFT JOIN public.job_work_orders jw ON jw.id = l.job_work_order_id
  LEFT JOIN public.sales_orders pso ON pso.id = l.pending_sales_order_id
  LEFT JOIN public.job_work_orders pjw ON pjw.id = l.pending_job_work_order_id
  WHERE l.company_id = ${companyId}::uuid AND l.pending_at IS NOT NULL AND l.deleted_at IS NULL)`;

type PendingRow = {
  entryId: string;
  userId: string;
  userName: string;
  departments: Record<string, unknown>;
  date: string;
  cFrom: string | null;
  cTo: string | null;
  cDesc: string;
  cCode: string | null;
  pFrom: string;
  pTo: string;
  pDesc: string | null;
  pCode: string | null;
  requestedAt: string;
};

/** The waiting edits `v` may decide. */
function approvalsOf(v: Viewer, json: unknown): DayLogApprovalsResponse {
  const rows: DayLogApprovalRow[] = ((json as PendingRow[] | null) ?? [])
    .filter((p) => canApproveUser(v, { id: p.userId, departments: p.departments }))
    .map((p) => ({
      entryId: p.entryId,
      userId: p.userId,
      userName: p.userName,
      date: p.date,
      current: {
        fromTime: p.cFrom ?? '',
        toTime: p.cTo,
        description: p.cDesc,
        orderCode: p.cCode,
      },
      proposed: {
        fromTime: p.pFrom,
        toTime: p.pTo,
        description: p.pDesc ?? '',
        orderCode: p.pCode,
      },
      requestedAt: p.requestedAt,
    }));
  return { rows };
}

/** GET /day-logs/approvals — ONE statement (access + every waiting edit). */
export async function getApprovals(user: AuthContext): Promise<DayLogApprovalsResponse> {
  const companyId = requireCompany(user);
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access, ${pendingJson(companyId)} AS rows
  `)) as unknown as Array<{ access: unknown; rows: unknown }>;
  const v = viewerOf(user, await resolveAccess(user, r?.access));
  return approvalsOf(v, r?.rows);
}

interface Decision {
  tx: DbTransaction;
  companyId: string;
  v: Viewer;
  h: DayHeader;
  self: DayLine & { pending: NonNullable<DayLine['pending']> };
  others: DayLine[];
}

/** Lock the row's day, check the caller may decide it and that it waits. */
async function decide<T>(
  user: AuthContext,
  entryId: string,
  fn: (d: Decision) => Promise<T>,
): Promise<T> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    const locked = await lockAnyEntryDay(tx, user, companyId, entryId);
    const eff = await resolveAccess(user, locked.access);
    assertCanWrite(eff);
    const v = viewerOf(user, eff);
    const h = requireHeader(locked);
    const target = locked.target;
    if (!target) throw new NotFoundError('Entry not found');
    if (target.id === v.userId) {
      throw new AuthorizationError('Your own Day Log edit must be approved by someone else');
    }
    if (!canApproveUser(v, target)) {
      throw new AuthorizationError(
        "Only the person's Department Admin or a Super Admin can approve Day Log edits",
      );
    }
    const snap = await readSnapshot(
      { companyId, viewerId: null, targetId: target.id, date: h.date },
      tx,
    );
    const self = snap.lines.find((l) => l.id === entryId);
    if (!self) throw new NotFoundError('Entry not found');
    if (!self.pending) throw new ConflictError(DECIDED);
    const others = snap.lines.filter((l) => l.id !== entryId);
    return fn({ tx, companyId, v, h, self: { ...self, pending: self.pending }, others });
  });
}

/** The approver's list after the decision, inside the same transaction. */
async function listAfter(d: Decision): Promise<DayLogApprovalsResponse> {
  const [r] = (await d.tx.execute(
    sql`SELECT ${pendingJson(d.companyId)} AS rows`,
  )) as unknown as Array<{ rows: unknown }>;
  return approvalsOf(d.v, r?.rows);
}

/** Only the request that was checked: `pending_at` as loaded (§20.2). */
const sameRequest = (d: Decision): SQL => sql`
  id = ${d.self.id}::uuid AND deleted_at IS NULL AND pending_at IS NOT NULL
  AND date_trunc('milliseconds', pending_at) = ${d.self.pending.requestedAt}::timestamptz`;

export async function approveEntry(
  entryId: string,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogApprovalsResponse> {
  return decide(user, entryId, async (d) => {
    const p = d.self.pending;
    // Re-checked under the day lock: the other rows may have changed since.
    try {
      validateEntry(
        d.h.date,
        d.others,
        { fromTime: p.fromTime, toTime: p.toTime, description: p.description },
        clock,
      );
    } catch (e) {
      if (e instanceof AppError) throw new ConflictError(`Cannot approve — ${e.message}`);
      throw e;
    }
    const [w] = await writeLines(
      d.tx,
      d.h,
      user,
      sql`
      UPDATE public.daily_report_lines
      SET from_time = pending_from, to_time = pending_to, description = pending_description,
          sales_order_id = pending_sales_order_id, job_work_order_id = pending_job_work_order_id,
          kind = 'work', status = 'completed', hours = ${hoursOf(p.fromTime, p.toTime)},
          pending_from = NULL, pending_to = NULL, pending_description = NULL,
          pending_sales_order_id = NULL, pending_job_work_order_id = NULL,
          pending_at = NULL, pending_by = NULL, reject_reason = NULL,
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE ${sameRequest(d)}
      RETURNING ${returning(d.h)}`,
    );
    if (!w) throw new ConflictError(DECIDED);
    await log(
      d.tx,
      d.companyId,
      user,
      d.h,
      'EDIT_APPROVED',
      `approved the change of ${label({ fromTime: d.self.fromTime ?? '', toTime: d.self.toTime, description: d.self.description })} to ${label(p)}`,
    );
    return listAfter(d);
  });
}

export async function rejectEntry(
  entryId: string,
  input: DayLogRejectInput,
  user: AuthContext,
): Promise<DayLogApprovalsResponse> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('Give a reason');
  return decide(user, entryId, async (d) => {
    const [w] = await writeLines(
      d.tx,
      d.h,
      user,
      sql`
      UPDATE public.daily_report_lines
      SET pending_from = NULL, pending_to = NULL, pending_description = NULL,
          pending_sales_order_id = NULL, pending_job_work_order_id = NULL,
          pending_at = NULL, pending_by = NULL, reject_reason = ${reason},
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE ${sameRequest(d)}
      RETURNING ${returning(d.h)}`,
    );
    if (!w) throw new ConflictError(DECIDED);
    await log(
      d.tx,
      d.companyId,
      user,
      d.h,
      'EDIT_REJECTED',
      `rejected the change of ${label({ fromTime: d.self.fromTime ?? '', toTime: d.self.toTime, description: d.self.description })} to ${label(d.self.pending)}: ${reason}`,
    );
    return listAfter(d);
  });
}
