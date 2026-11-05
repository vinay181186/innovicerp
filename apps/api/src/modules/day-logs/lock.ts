// Day Log — the write transaction and its FIRST statement, which
// does three jobs in one round trip (owner 2026-10-27: each trip costs):
//   1. sets the caller's claims (what withUserContext's own statement does),
//   2. takes the day lock (§20.3) — every write on this day queues here,
//   3. reads the caller's access (accessJson), checked before anything else.
// The day's lines are read AFTER this, in a second statement (snapshot.ts),
// so they are the lines under the lock.

import { type SQL, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import {
  type DayPerson,
  type DayUser,
  accessJson,
  dayPersonJson,
  dayUserJson,
  toDayPerson,
  toDayUser,
} from './access';
import { type DayHeader, HEADER_COLS, toHeader } from './day';

/** set_config of the caller's claims — the same value withUserContext sets. */
function claimsOf(user: AuthContext): SQL {
  const claims = JSON.stringify({
    sub: user.id,
    company_id: user.companyId ?? '',
    role: user.role,
    email: user.email,
  });
  return sql`set_config('request.jwt.claims', ${claims}, true)`;
}

/** The write transaction. Its first statement must be openDayLocked or
 *  lockEntryDay (they carry the claims). */
export const dayTx = <T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> => db.transaction(fn);

export interface Locked {
  /** The caller's raw access row (resolveAccess). */
  access: unknown;
  header: DayHeader | null;
}

/**
 * Open (user, date) and lock it: insert the header if it is missing, else
 * take the existing one's row lock (ON CONFLICT … DO UPDATE locks the row —
 * the SET writes the value it already has). On daily_reports_user_day_uq,
 * so two first entries at once open ONE day. Nothing is copied into a new day.
 */
export async function openDayLocked(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  date: string,
): Promise<Locked & { header: DayHeader }> {
  const rows = (await tx.execute(sql`
    INSERT INTO public.daily_reports AS dr (company_id, user_id, report_date, created_by, updated_by)
    SELECT ${companyId}::uuid, ${user.id}::uuid, ${date}::date, ${user.id}::uuid, ${user.id}::uuid
    FROM (SELECT ${claimsOf(user)} AS cfg) c WHERE c.cfg IS NOT NULL
    ON CONFLICT (company_id, user_id, report_date) WHERE deleted_at IS NULL
    DO UPDATE SET updated_at = dr.updated_at
    RETURNING ${HEADER_COLS}, ${accessJson(user.id, companyId)} AS access
  `)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) throw new ConflictError('This day could not be opened — reload and try again');
  return { access: r['access'] ?? null, header: toHeader(r) };
}

/**
 * Pending Entries — openDayLocked on SOMEONE ELSE's day: the Super Admin's
 * reply opens (target, date), created_by = the caller, and locks it. Also
 * returns the target person (one statement). No row = no such person in the
 * company. Whether the caller may do this is judged after, on the same
 * statement's access; a refusal throws, so the header rolls back with it.
 */
export async function openTargetDayLocked(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  targetId: string,
  date: string,
): Promise<Locked & { header: DayHeader; target: DayPerson | null }> {
  const rows = (await tx.execute(sql`
    INSERT INTO public.daily_reports AS dr (company_id, user_id, report_date, created_by, updated_by)
    SELECT ${companyId}::uuid, ${targetId}::uuid, ${date}::date, ${user.id}::uuid, ${user.id}::uuid
    FROM (SELECT ${claimsOf(user)} AS cfg) c
    WHERE c.cfg IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = ${targetId}::uuid AND u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL)
    ON CONFLICT (company_id, user_id, report_date) WHERE deleted_at IS NULL
    DO UPDATE SET updated_at = dr.updated_at
    RETURNING ${HEADER_COLS}, ${accessJson(user.id, companyId)} AS access,
      ${dayPersonJson(companyId, targetId)} AS target
  `)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) throw new NotFoundError('Person not found');
  return { access: r['access'] ?? null, header: toHeader(r), target: toDayPerson(r['target']) };
}

/** The caller's own day on `date`, locked FOR UPDATE; header null = no such day. */
export async function lockOwnDay(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  date: string,
): Promise<Locked> {
  const rows = (await tx.execute(sql`
    SELECT c.cfg, ${accessJson(user.id, companyId)} AS access, h.*
    FROM (SELECT ${claimsOf(user)} AS cfg) c
    LEFT JOIN (
      SELECT ${HEADER_COLS}
      FROM public.daily_reports dr
      WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${user.id}::uuid
        AND dr.report_date = ${date}::date AND dr.deleted_at IS NULL
      FOR UPDATE OF dr
    ) h ON true
  `)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0]!;
  return { access: r['access'] ?? null, header: r['id'] ? toHeader(r) : null };
}

/** The day of the caller's own entry, locked FOR UPDATE (someone else's
 *  entry → header null, "not found" once access has been checked). */
export async function lockEntryDay(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  entryId: string,
): Promise<Locked> {
  const rows = (await tx.execute(sql`
    SELECT c.cfg, ${accessJson(user.id, companyId)} AS access, h.*
    FROM (SELECT ${claimsOf(user)} AS cfg) c
    LEFT JOIN (
      SELECT ${HEADER_COLS}
      FROM public.daily_reports dr
      WHERE dr.id = (
          SELECT l.daily_report_id FROM public.daily_report_lines l
          JOIN public.daily_reports d2 ON d2.id = l.daily_report_id AND d2.deleted_at IS NULL
          WHERE l.id = ${entryId}::uuid AND l.company_id = ${companyId}::uuid
            AND l.deleted_at IS NULL AND d2.user_id = ${user.id}::uuid)
        AND dr.company_id = ${companyId}::uuid AND dr.deleted_at IS NULL
      FOR UPDATE OF dr
    ) h ON true
  `)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0]!;
  return { access: r['access'] ?? null, header: r['id'] ? toHeader(r) : null };
}

/** An approver's lock: the day of ANYONE's entry in the company, FOR UPDATE,
 *  with the caller's access and the person (one statement). Header null =
 *  no such live entry. Whether the caller may approve is judged after. */
export const lockAnyEntryDay = (
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  entryId: string,
): Promise<Locked & { target: DayUser | null }> =>
  lockLineDay(tx, user, companyId, sql`${entryId}::uuid`);

/** ADR-255 — the same lock, found from a reply: the day of the reply's line
 *  (header null = no such live reply / line). */
export const lockReplyDay = (
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  replyId: string,
): Promise<Locked & { target: DayUser | null }> =>
  lockLineDay(
    tx,
    user,
    companyId,
    sql`(SELECT rp.line_id FROM public.daily_report_line_replies rp
         WHERE rp.id = ${replyId}::uuid AND rp.company_id = ${companyId}::uuid
           AND rp.deleted_at IS NULL)`,
  );

/** Pending Entries — the same lock, found from a reply on the day itself. */
export const lockDayReplyDay = (
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  replyId: string,
): Promise<Locked & { target: DayUser | null }> =>
  lockReportDay(
    tx,
    user,
    companyId,
    sql`(SELECT rp.daily_report_id FROM public.daily_report_day_replies rp
         WHERE rp.id = ${replyId}::uuid AND rp.company_id = ${companyId}::uuid
           AND rp.deleted_at IS NULL)`,
  );

function lockLineDay(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  lineId: SQL,
): Promise<Locked & { target: DayUser | null }> {
  return lockReportDay(
    tx,
    user,
    companyId,
    sql`(SELECT l.daily_report_id FROM public.daily_report_lines l
         WHERE l.id = ${lineId} AND l.company_id = ${companyId}::uuid
           AND l.deleted_at IS NULL)`,
  );
}

async function lockReportDay(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  reportId: SQL,
): Promise<Locked & { target: DayUser | null }> {
  const rows = (await tx.execute(sql`
    SELECT c.cfg, ${accessJson(user.id, companyId)} AS access, h.*,
      CASE WHEN h.user_id IS NULL THEN NULL
           ELSE ${dayUserJson(companyId, sql`h.user_id::uuid`)} END AS target
    FROM (SELECT ${claimsOf(user)} AS cfg) c
    LEFT JOIN (
      SELECT ${HEADER_COLS}
      FROM public.daily_reports dr
      WHERE dr.id = ${reportId}
        AND dr.company_id = ${companyId}::uuid AND dr.deleted_at IS NULL
      FOR UPDATE OF dr
    ) h ON true
  `)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0]!;
  return {
    access: r['access'] ?? null,
    header: r['id'] ? toHeader(r) : null,
    target: toDayUser(r['target']),
  };
}

/** The locked header, or "Entry not found". */
export function requireHeader(l: Locked): DayHeader {
  if (!l.header) throw new NotFoundError('Entry not found');
  return l.header;
}
