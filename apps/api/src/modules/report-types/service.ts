// Report / Document Master service (QC Wave 5). Mirrors legacy
// renderReportMaster L23677. CRUD over report_types (migration 0038).

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateReportTypeInput,
  ListReportTypesQuery,
  ListReportTypesResponse,
  ReportType,
  UpdateReportTypeInput,
} from '@innovic/shared';
import { reportTypes } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { softDeleteStamp } from '../../lib/audit-trail';
import { readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';

/** Sort & Filter (ADR-200) — the Report Types sheet's columns, as SELECTed. */
const REPORT_TYPE_SF_COLUMNS: SfColumnMap = {
  name: { sql: sql`${reportTypes.name}`, type: 'text' },
  description: { sql: sql`${reportTypes.description}`, type: 'text' },
  defaultMandatory: {
    sql: sql`CASE WHEN ${reportTypes.defaultMandatory} THEN 'mandatory' ELSE 'optional' END`,
    type: 'list',
  },
  status: { sql: sql`${reportTypes.status}`, type: 'list' },
};

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

type Row = typeof reportTypes.$inferSelect;

function toItem(r: Row): ReportType {
  return {
    id: r.id,
    companyId: r.companyId,
    name: r.name,
    description: r.description ?? null,
    defaultMandatory: r.defaultMandatory,
    status: r.status as ReportType['status'],
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  };
}

/** Paged (ADR-201): `total` uses the SAME where as the page; newest first,
 *  id as the tie-breaker so a page never repeats or skips a row. */
export async function listReportTypes(
  input: ListReportTypesQuery,
  user: AuthContext,
): Promise<ListReportTypesResponse> {
  const companyId = requireCompany(user);
  const sf = readSf(input.sf);
  const where = and(
    eq(reportTypes.companyId, companyId),
    isNull(reportTypes.deletedAt),
    sql`TRUE ${sfWhere(REPORT_TYPE_SF_COLUMNS, sf)}`,
  );
  const orderBy = sfOrderBy(
    REPORT_TYPE_SF_COLUMNS,
    sf,
    sql`${reportTypes.createdAt} DESC, ${reportTypes.id} DESC`,
  );
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(reportTypes)
      .where(where)
      .orderBy(orderBy)
      .limit(input.limit)
      .offset(input.offset);
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reportTypes)
      .where(where);
    return { items: rows.map(toItem), total: Number(cnt?.n ?? 0) };
  });
}

export async function createReportType(
  input: CreateReportTypeInput,
  user: AuthContext,
): Promise<ReportType> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const inserted = await tx
      .insert(reportTypes)
      .values({
        companyId,
        name: input.name,
        description: input.description ?? null,
        defaultMandatory: input.defaultMandatory,
        status: input.status,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return toItem(inserted[0] as Row);
  });
}

export async function updateReportType(
  id: string,
  input: UpdateReportTypeInput,
  user: AuthContext,
): Promise<ReportType> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(reportTypes)
      .where(
        and(
          eq(reportTypes.id, id),
          eq(reportTypes.companyId, companyId),
          isNull(reportTypes.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Report type ${id} not found`);

    const patch: Partial<typeof reportTypes.$inferInsert> = {
      updatedBy: user.id,
      updatedAt: new Date(),
    };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.defaultMandatory !== undefined) patch.defaultMandatory = input.defaultMandatory;
    if (input.status !== undefined) patch.status = input.status;

    const updated = await tx
      .update(reportTypes)
      .set(patch)
      .where(eq(reportTypes.id, id))
      .returning();
    return toItem(updated[0] as Row);
  });
}

export async function deleteReportType(id: string, user: AuthContext): Promise<{ id: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const updated = await tx
      .update(reportTypes)
      .set({ ...softDeleteStamp(user), updatedBy: user.id, updatedAt: new Date() })
      .where(
        and(
          eq(reportTypes.id, id),
          eq(reportTypes.companyId, companyId),
          isNull(reportTypes.deletedAt),
        ),
      )
      .returning({ id: reportTypes.id });
    if (updated.length === 0) throw new NotFoundError(`Report type ${id} not found`);
    return { id };
  });
}
