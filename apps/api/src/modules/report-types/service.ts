// Report / Document Master service (QC Wave 5). Mirrors legacy
// renderReportMaster L23677. CRUD over report_types (migration 0038).

import { and, desc, eq, isNull } from 'drizzle-orm';
import type {
  CreateReportTypeInput,
  ListReportTypesResponse,
  ReportType,
  UpdateReportTypeInput,
} from '@innovic/shared';
import { reportTypes } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

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

export async function listReportTypes(user: AuthContext): Promise<ListReportTypesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(reportTypes)
      .where(and(eq(reportTypes.companyId, companyId), isNull(reportTypes.deletedAt)))
      .orderBy(desc(reportTypes.createdAt));
    return { items: rows.map(toItem) };
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
      .set({ deletedAt: new Date(), updatedBy: user.id, updatedAt: new Date() })
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
