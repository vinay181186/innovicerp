// Design Work Log service (Design slice E).
//
// Daily timesheet feed across the Design team. Mirrors
// renderDesignWorkLog (HTML L7935) + _dpWlEntry/_dpWlDaily/_dpWlWeekly/
// _dpWlProject/_dpWlAlerts.

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateDesignWorkLogInput,
  DesignWorkLogEntry,
  ListDesignWorkLogQuery,
  ListDesignWorkLogResponse,
} from '@innovic/shared';
import { designProjects, designWorkLog } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number(v) || 0;
}

export async function listDesignWorkLog(
  input: ListDesignWorkLogQuery,
  user: AuthContext,
): Promise<ListDesignWorkLogResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const engineerFrag = input.engineer
      ? sql`AND wl.engineer_text = ${input.engineer}`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND wl.log_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND wl.log_date <= ${input.toDate}::date` : sql``;
    const projFrag = input.designProjectId
      ? sql`AND wl.design_project_id = ${input.designProjectId}::uuid`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        wl.id,
        wl.log_date AS "logDate",
        wl.engineer_text AS "engineerText",
        wl.design_project_id AS "designProjectId",
        wl.task_text AS "taskText",
        wl.category,
        wl.hours,
        wl.description,
        wl.created_at AS "createdAt",
        dp.project_name AS "projectName",
        dp.code AS "projectCode"
      FROM public.design_work_log wl
      LEFT JOIN public.design_projects dp ON dp.id = wl.design_project_id AND dp.deleted_at IS NULL
      WHERE wl.company_id = ${companyId}::uuid
        AND wl.deleted_at IS NULL
        ${engineerFrag}
        ${fromFrag}
        ${toFrag}
        ${projFrag}
      ORDER BY wl.log_date DESC, wl.created_at DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(designWorkLog.companyId, companyId), isNull(designWorkLog.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(designWorkLog)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(
      (r): DesignWorkLogEntry => ({
        id: r['id'] as string,
        logDate: dateLike(r['logDate']),
        engineerText: String(r['engineerText'] ?? ''),
        designProjectId: (r['designProjectId'] as string | null) ?? null,
        projectName: (r['projectName'] as string | null) ?? null,
        projectCode: (r['projectCode'] as string | null) ?? null,
        taskText: (r['taskText'] as string | null) ?? null,
        category: r['category'] as DesignWorkLogEntry['category'],
        hours: num(r['hours']),
        description: (r['description'] as string | null) ?? null,
        createdAt: tsLike(r['createdAt']),
      }),
    );
    return { items: itemsOut, total, limit: input.limit, offset: input.offset };
  });
}

export async function createDesignWorkLogEntry(
  input: CreateDesignWorkLogInput,
  user: AuthContext,
): Promise<DesignWorkLogEntry> {
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const projRows = await tx
      .select({ id: designProjects.id, projectName: designProjects.projectName, code: designProjects.code })
      .from(designProjects)
      .where(
        and(
          eq(designProjects.id, input.designProjectId),
          eq(designProjects.companyId, companyId),
          isNull(designProjects.deletedAt),
        ),
      )
      .limit(1);
    const proj = projRows[0];
    if (!proj) throw new NotFoundError(`Design project ${input.designProjectId} not found`);

    const inserted = await tx
      .insert(designWorkLog)
      .values({
        companyId,
        logDate: input.logDate,
        engineerText: user.email ?? user.id,
        designProjectId: proj.id,
        taskText: input.taskText ?? null,
        category: input.category,
        hours: String(input.hours),
        description: input.description ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to log work');
    return {
      id: row.id,
      logDate: dateLike(row.logDate),
      engineerText: row.engineerText,
      designProjectId: row.designProjectId,
      projectName: proj.projectName,
      projectCode: proj.code,
      taskText: row.taskText,
      category: row.category as DesignWorkLogEntry['category'],
      hours: num(row.hours),
      description: row.description,
      createdAt: tsLike(row.createdAt),
    };
  });
}

export async function deleteDesignWorkLogEntry(id: string, user: AuthContext): Promise<void> {
  const companyId = requireCompany(user);
  const userId = user.id;
  await withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ id: designWorkLog.id })
      .from(designWorkLog)
      .where(
        and(
          eq(designWorkLog.id, id),
          eq(designWorkLog.companyId, companyId),
          isNull(designWorkLog.deletedAt),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundError(`Work log entry ${id} not found`);
    await tx
      .update(designWorkLog)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: userId })
      .where(eq(designWorkLog.id, rows[0].id));
  });
}
