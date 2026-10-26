// Day Log — the user's own break template, company holidays and the
// tab-access answer.

import {
  DAY_LOG_RULES,
  type DayLogAccess,
  type Holiday,
  type HolidayInput,
  type MyBreaksResponse,
  type SaveMyBreaksInput,
  hhmmToMin,
  minToHhmm,
  overlapMin,
  summarizeDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireCanWrite } from '../../lib/access';
import { isUniqueViolation } from '../../lib/db-retry';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { canSeeTeam, loadViewer } from './access';
import { loadLines, nextLineNo, readHeader, spansOf, touchDay } from './day';
import { breakTemplateProblem, dmy, istClock } from './rules';
import { requireCompany } from './writes';

export async function getAccess(user: AuthContext): Promise<DayLogAccess> {
  const v = await loadViewer(user);
  return { canSeeTeam: canSeeTeam(v), canManageHolidays: v.isSuper };
}

async function readTemplate(
  tx: DbTransaction,
  companyId: string,
  userId: string,
): Promise<MyBreaksResponse> {
  const rows = (await tx.execute(sql`
    SELECT name, to_char(from_time, 'HH24:MI') AS from_time, to_char(to_time, 'HH24:MI') AS to_time
    FROM public.user_break_times
    WHERE company_id = ${companyId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL
    ORDER BY sort_no, from_time
  `)) as unknown as Array<{ name: string; from_time: string; to_time: string }>;
  return {
    breaks: rows.map((r) => ({ name: r.name, fromTime: r.from_time, toTime: r.to_time })),
    breakLimitMin: DAY_LOG_RULES.breakLimitMin,
  };
}

export async function getMyBreaks(user: AuthContext): Promise<MyBreaksResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => readTemplate(tx, companyId, user.id));
}

/**
 * Replace the user's break template (soft delete + insert, one transaction).
 * Today's day, when it exists and is open, is locked and its break lines are
 * replaced too — refused when a new break covers time already logged as work.
 * Earlier days keep the breaks they were opened with.
 */
export async function saveMyBreaks(
  input: SaveMyBreaksInput,
  user: AuthContext,
): Promise<MyBreaksResponse> {
  await requireCanWrite(user);
  const companyId = requireCompany(user);
  const problem = breakTemplateProblem(input.breaks);
  if (problem) throw new ValidationError(problem);
  const clock = istClock();
  return withUserContext(user, async (tx) => {
    // Lock today first (the same order a write that opens the day uses).
    const today = await readHeader(tx, companyId, user.id, clock.today, true);
    if (today && today.status === 'open') {
      const lines = await loadLines(tx, companyId, today.id);
      // A break the day has already reached (it starts before nextFrom) is
      // fixed: removing, moving or adding one there would leave a hole that
      // no entry can fill, since entries only ever start at nextFrom.
      const reached = hhmmToMin(summarizeDay(spansOf(lines)).nextFrom);
      const key = (b: { fromTime: string | null; toTime: string | null }): string =>
        `${b.fromTime}-${b.toTime}`;
      const passedOld = lines
        .filter((l) => l.kind === 'break' && l.fromTime && hhmmToMin(l.fromTime) < reached)
        .map(key)
        .sort();
      const passedNew = input.breaks
        .filter((b) => hhmmToMin(b.fromTime) < reached)
        .map(key)
        .sort();
      if (passedOld.join() !== passedNew.join()) {
        throw new ValidationError(
          `Your breaks before ${minToHhmm(reached)} are already past today, so today's log cannot change them — save this after you submit today's Day Log`,
        );
      }
      for (const b of input.breaks) {
        const a1 = hhmmToMin(b.fromTime);
        const a2 = hhmmToMin(b.toTime);
        const hit = lines.some((l) => {
          if (l.kind !== 'work' || !l.fromTime) return false;
          const end = l.toTime
            ? hhmmToMin(l.toTime)
            : Math.max(hhmmToMin(l.fromTime), clock.nowMin);
          return overlapMin(a1, a2, hhmmToMin(l.fromTime), end) > 0;
        });
        if (hit) throw new ValidationError(`${b.fromTime}–${b.toTime} is already logged as work`);
      }
      await tx.execute(sql`
        UPDATE public.daily_report_lines
        SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
        WHERE daily_report_id = ${today.id}::uuid AND kind = 'break' AND deleted_at IS NULL
      `);
      let lineNo = await nextLineNo(tx, today.id);
      for (const b of input.breaks) {
        await tx.execute(sql`
          INSERT INTO public.daily_report_lines
            (company_id, daily_report_id, line_no, description, kind, from_time, to_time,
             status, hours, created_by, updated_by)
          VALUES (${companyId}::uuid, ${today.id}::uuid, ${lineNo}, ${b.name}, 'break',
                  ${b.fromTime}::time, ${b.toTime}::time, 'completed', 0,
                  ${user.id}::uuid, ${user.id}::uuid)
        `);
        lineNo += 1;
      }
      await touchDay(tx, today.id, user);
    }

    await tx.execute(sql`
      UPDATE public.user_break_times
      SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE company_id = ${companyId}::uuid AND user_id = ${user.id}::uuid AND deleted_at IS NULL
    `);
    let sortNo = 1;
    for (const b of input.breaks) {
      await tx.execute(sql`
        INSERT INTO public.user_break_times
          (company_id, user_id, name, from_time, to_time, sort_no, created_by, updated_by)
        VALUES (${companyId}::uuid, ${user.id}::uuid, ${b.name}, ${b.fromTime}::time,
                ${b.toTime}::time, ${sortNo}, ${user.id}::uuid, ${user.id}::uuid)
      `);
      sortNo += 1;
    }
    return readTemplate(tx, companyId, user.id);
  });
}

// ── Holidays ────────────────────────────────────────────────────────────────

export async function listHolidays(user: AuthContext): Promise<{ holidays: Holiday[] }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT id::text AS id, to_char(holiday_date, 'YYYY-MM-DD') AS date, name
      FROM public.company_holidays
      WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      ORDER BY holiday_date
    `)) as unknown as Holiday[];
    return { holidays: rows.map((r) => ({ id: r.id, date: r.date, name: r.name })) };
  });
}

async function requireSuper(user: AuthContext): Promise<void> {
  const v = await loadViewer(user);
  if (!v.isSuper) throw new AuthorizationError('Only a Super Admin can change company holidays.');
}

export async function addHoliday(input: HolidayInput, user: AuthContext): Promise<Holiday> {
  await requireSuper(user);
  const companyId = requireCompany(user);
  try {
    return await withUserContext(user, async (tx) => {
      const [row] = (await tx.execute(sql`
        INSERT INTO public.company_holidays (company_id, holiday_date, name, created_by, updated_by)
        VALUES (${companyId}::uuid, ${input.date}::date, ${input.name}, ${user.id}::uuid, ${user.id}::uuid)
        RETURNING id::text AS id, to_char(holiday_date, 'YYYY-MM-DD') AS date, name
      `)) as unknown as Holiday[];
      await emitActivityLog(
        tx,
        {
          action: 'CREATE',
          entity: 'Company Holiday',
          entityId: row!.id,
          refId: input.date,
          detail: `Holiday ${dmy(input.date)} ${input.name}`,
        },
        companyId,
        user,
      );
      return { id: row!.id, date: row!.date, name: row!.name };
    });
  } catch (e) {
    if (isUniqueViolation(e) || isUniqueViolation((e as { cause?: unknown } | null)?.cause)) {
      throw new ConflictError(`${dmy(input.date)} is already a holiday`);
    }
    throw e;
  }
}

export async function deleteHoliday(id: string, user: AuthContext): Promise<{ ok: true }> {
  await requireSuper(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      UPDATE public.company_holidays
      SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
      RETURNING to_char(holiday_date, 'YYYY-MM-DD') AS date, name
    `)) as unknown as Array<{ date: string; name: string }>;
    const r = rows[0];
    if (!r) throw new NotFoundError('Holiday not found');
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'Company Holiday',
        entityId: id,
        refId: r.date,
        detail: `Removed holiday ${dmy(r.date)} ${r.name}`,
      },
      companyId,
      user,
    );
    return { ok: true as const };
  });
}
