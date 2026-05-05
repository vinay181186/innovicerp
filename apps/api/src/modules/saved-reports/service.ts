// Saved-reports service (T-041b). CRUD + run.
//
// RLS provides company isolation. The service layer enforces:
//   - List filter: own reports + shared in same company
//   - Update / delete: only owner OR admin/manager
//   - Spec validation against the source catalog before any DB write/run

import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { savedReports, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { runAdHoc } from './runner';
import type {
  AdHocSpec,
  CreateSavedReportInput,
  ListSavedReportsResponse,
  ListSourcesResponse,
  RunAdHocResponse,
  SavedReport,
  UpdateSavedReportInput,
} from './schema';
import { adHocSpecSchema } from './schema';
import { getSource, listSourceDescriptors } from './sources';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const isManager = (user: AuthContext): boolean => user.role === 'admin' || user.role === 'manager';

export function listSources(): ListSourcesResponse {
  return { sources: listSourceDescriptors() };
}

function rowToSavedReport(
  r: typeof savedReports.$inferSelect & { ownerEmail?: string | null },
): SavedReport {
  return {
    id: r.id,
    companyId: r.companyId,
    ownerId: r.ownerId,
    ownerEmail: r.ownerEmail ?? null,
    name: r.name,
    description: r.description ?? '',
    sourceKey: r.sourceKey,
    spec: adHocSpecSchema.parse(r.spec),
    isShared: r.isShared,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listSavedReports(user: AuthContext): Promise<ListSavedReportsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: savedReports.id,
        companyId: savedReports.companyId,
        ownerId: savedReports.ownerId,
        ownerEmail: users.email,
        name: savedReports.name,
        description: savedReports.description,
        sourceKey: savedReports.sourceKey,
        spec: savedReports.spec,
        isShared: savedReports.isShared,
        createdAt: savedReports.createdAt,
        createdBy: savedReports.createdBy,
        updatedAt: savedReports.updatedAt,
        updatedBy: savedReports.updatedBy,
        deletedAt: savedReports.deletedAt,
      })
      .from(savedReports)
      .leftJoin(users, eq(users.id, savedReports.ownerId))
      .where(
        and(
          eq(savedReports.companyId, companyId),
          isNull(savedReports.deletedAt),
          // Service-layer visibility filter — RLS already gates company.
          or(eq(savedReports.ownerId, user.id), eq(savedReports.isShared, true)),
        ),
      )
      .orderBy(desc(savedReports.updatedAt));

    return {
      reports: rows.map((r) =>
        rowToSavedReport(r as typeof savedReports.$inferSelect & { ownerEmail: string | null }),
      ),
    };
  });
}

export async function getSavedReport(id: string, user: AuthContext): Promise<SavedReport> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: savedReports.id,
        companyId: savedReports.companyId,
        ownerId: savedReports.ownerId,
        ownerEmail: users.email,
        name: savedReports.name,
        description: savedReports.description,
        sourceKey: savedReports.sourceKey,
        spec: savedReports.spec,
        isShared: savedReports.isShared,
        createdAt: savedReports.createdAt,
        createdBy: savedReports.createdBy,
        updatedAt: savedReports.updatedAt,
        updatedBy: savedReports.updatedBy,
        deletedAt: savedReports.deletedAt,
      })
      .from(savedReports)
      .leftJoin(users, eq(users.id, savedReports.ownerId))
      .where(
        and(
          eq(savedReports.id, id),
          eq(savedReports.companyId, companyId),
          isNull(savedReports.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundError(`Saved report ${id} not found`);
    if (row.ownerId !== user.id && !row.isShared && !isManager(user)) {
      throw new NotFoundError(`Saved report ${id} not found`);
    }
    return rowToSavedReport(
      row as typeof savedReports.$inferSelect & { ownerEmail: string | null },
    );
  });
}

function assertSourceExists(sourceKey: string): void {
  if (!getSource(sourceKey)) {
    throw new NotFoundError(`Source "${sourceKey}" not found`);
  }
}

export async function createSavedReport(
  input: CreateSavedReportInput,
  user: AuthContext,
): Promise<SavedReport> {
  const companyId = requireCompany(user);
  if (input.spec.sourceKey !== input.sourceKey) {
    throw new ConflictError('spec.sourceKey must match input.sourceKey');
  }
  assertSourceExists(input.sourceKey);

  return withUserContext(user, async (tx) => {
    const dup = await tx
      .select({ id: savedReports.id })
      .from(savedReports)
      .where(
        and(
          eq(savedReports.companyId, companyId),
          eq(savedReports.ownerId, user.id),
          eq(savedReports.name, input.name),
          isNull(savedReports.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`A saved report named "${input.name}" already exists`);
    }

    const [inserted] = await tx
      .insert(savedReports)
      .values({
        companyId,
        ownerId: user.id,
        name: input.name,
        description: input.description,
        sourceKey: input.sourceKey,
        spec: input.spec,
        isShared: input.isShared,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();

    if (!inserted) throw new Error('Insert returned no row');
    return rowToSavedReport({ ...inserted, ownerEmail: user.email });
  });
}

function assertCanWrite(row: typeof savedReports.$inferSelect, user: AuthContext): void {
  if (row.ownerId === user.id || isManager(user)) return;
  throw new AuthorizationError('Only the owner or an admin/manager can modify this report');
}

export async function updateSavedReport(
  id: string,
  input: UpdateSavedReportInput,
  user: AuthContext,
): Promise<SavedReport> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(savedReports)
      .where(
        and(
          eq(savedReports.id, id),
          eq(savedReports.companyId, companyId),
          isNull(savedReports.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Saved report ${id} not found`);
    assertCanWrite(existing, user);

    const nextSourceKey = input.sourceKey ?? existing.sourceKey;
    const nextSpec: AdHocSpec = input.spec
      ? adHocSpecSchema.parse(input.spec)
      : adHocSpecSchema.parse(existing.spec);
    if (nextSpec.sourceKey !== nextSourceKey) {
      throw new ConflictError('spec.sourceKey must match the report sourceKey');
    }
    assertSourceExists(nextSourceKey);

    if (input.name && input.name !== existing.name) {
      const dup = await tx
        .select({ id: savedReports.id })
        .from(savedReports)
        .where(
          and(
            eq(savedReports.companyId, companyId),
            eq(savedReports.ownerId, existing.ownerId),
            eq(savedReports.name, input.name),
            isNull(savedReports.deletedAt),
          ),
        )
        .limit(1);
      if (dup.length > 0 && dup[0]!.id !== id) {
        throw new ConflictError(`A saved report named "${input.name}" already exists`);
      }
    }

    const [updated] = await tx
      .update(savedReports)
      .set({
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        sourceKey: nextSourceKey,
        spec: nextSpec,
        isShared: input.isShared ?? existing.isShared,
        updatedBy: user.id,
      })
      .where(eq(savedReports.id, id))
      .returning();
    if (!updated) throw new Error('Update returned no row');

    const ownerRows = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, updated.ownerId))
      .limit(1);
    return rowToSavedReport({ ...updated, ownerEmail: ownerRows[0]?.email ?? null });
  });
}

export async function softDeleteSavedReport(id: string, user: AuthContext): Promise<void> {
  const companyId = requireCompany(user);
  await withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(savedReports)
      .where(
        and(
          eq(savedReports.id, id),
          eq(savedReports.companyId, companyId),
          isNull(savedReports.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new NotFoundError(`Saved report ${id} not found`);
    assertCanWrite(existing, user);

    await tx
      .update(savedReports)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(savedReports.id, id));
  });
}

export async function runSavedReport(id: string, user: AuthContext): Promise<RunAdHocResponse> {
  const report = await getSavedReport(id, user);
  return withUserContext(user, async (tx) => {
    const result = await runAdHoc(report.spec, { tx, companyId: report.companyId });
    return {
      id: report.id,
      title: report.name,
      sourceKey: report.sourceKey,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length,
      summary: result.summary,
      summaryFunction: result.summaryFunction,
      summaryColumn: result.summaryColumn,
      generatedAt: new Date().toISOString(),
    };
  });
}

export async function previewAdHocSpec(
  spec: AdHocSpec,
  user: AuthContext,
): Promise<RunAdHocResponse> {
  const companyId = requireCompany(user);
  assertSourceExists(spec.sourceKey);
  const parsed = adHocSpecSchema.parse(spec);
  return withUserContext(user, async (tx) => {
    const result = await runAdHoc(parsed, { tx, companyId });
    return {
      id: 'preview',
      title: 'Preview',
      sourceKey: parsed.sourceKey,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length,
      summary: result.summary,
      summaryFunction: result.summaryFunction,
      summaryColumn: result.summaryColumn,
      generatedAt: new Date().toISOString(),
    };
  });
}
