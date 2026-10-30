// Day Log — company holidays and the tab-access answer.

import { type DayLogAccess, type Holiday, type HolidayInput } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { isUniqueViolation } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { accessJson, canApproveAny, canSeeTeam, loadViewer, resolveAccess } from './access';
import { dmy } from './rules';
import { requireCompany } from './writes';

export async function getAccess(user: AuthContext): Promise<DayLogAccess> {
  const v = await loadViewer(user, { withMates: true });
  return {
    canSeeTeam: canSeeTeam(v),
    canApprove: canApproveAny(v),
    canManageHolidays: v.isSuper,
    canManageTeams: v.isSuper && !v.auditor,
  };
}

// ── Holidays ────────────────────────────────────────────────────────────────

export async function listHolidays(user: AuthContext): Promise<{ holidays: Holiday[] }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Day Log's own calendar: the caller's access rides in the same statement
    // so "Hide page" on Day Log refuses it too (resolveAccess).
    const [r] = (await tx.execute(sql`
      SELECT ${accessJson(user.id, companyId)} AS access,
        (SELECT COALESCE(json_agg(json_build_object(
                  'id', id::text, 'date', to_char(holiday_date, 'YYYY-MM-DD'), 'name', name)
                ORDER BY holiday_date), '[]'::json)
         FROM public.company_holidays
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL) AS holidays
    `)) as unknown as Array<{ access: unknown; holidays: Holiday[] | null }>;
    await resolveAccess(user, r?.access);
    const rows = r?.holidays ?? [];
    return { holidays: rows.map((h) => ({ id: h.id, date: h.date, name: h.name })) };
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
