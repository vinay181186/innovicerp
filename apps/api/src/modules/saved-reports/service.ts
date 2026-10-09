// Saved-reports service (T-041b). CRUD + run.
//
// RLS provides company isolation. The service layer enforces:
//   - List filter: own reports + shared in same company
//   - Update / delete: only owner OR admin/manager
//   - Spec validation against the source catalog before any DB write/run

import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { listSavedReportsQuerySchema } from '@innovic/shared';
import type { z } from 'zod';
import { savedReports, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { editConflicts, rowChangedByName } from '../../lib/row-changed-by';
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
import { SAVED_REPORT_SF_COLUMNS } from './sf-columns';
import { getSource, listSourceDescriptors } from './sources';
import { softDeleteStamp } from '../../lib/audit-trail';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const isManager = (user: AuthContext): boolean => user.role === 'admin' || user.role === 'manager';

// A data source is offered only to users who may VIEW its department page
// (Sales Orders, Purchase Orders, Job Cards, Item Master, NC Register) —
// checked on list, save, preview and run, never only in the browser.
async function canUseSource(user: AuthContext, sourceKey: string): Promise<boolean> {
  const src = getSource(sourceKey);
  if (!src) return false;
  return hasFormAccess(user, src.viewForm, 'view');
}

export async function listSources(user: AuthContext): Promise<ListSourcesResponse> {
  const all = listSourceDescriptors();
  const allowed = await Promise.all(all.map((d) => canUseSource(user, d.sourceKey)));
  return { sources: all.filter((_, i) => allowed[i]) };
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

// ADR-201: one 25-row page; search (name, description, source label / key,
// owner e-mail) + Sort & Filter on the server. No `limit` → every visible
// report. Newest-updated first, id breaks ties.
type ListSavedReportsInput = z.infer<typeof listSavedReportsQuerySchema>;

export async function listSavedReports(
  user: AuthContext,
  input: ListSavedReportsInput = { offset: 0 },
): Promise<ListSavedReportsResponse> {
  const companyId = requireCompany(user);
  const sf = readSf(input.sf);
  const term = (input.search ?? '').trim().replace(/\s+/g, ' ');
  const pat = `%${likeEscape(term)}%`;
  const needle = term.toLowerCase();
  const sourceHits = listSourceDescriptors()
    .filter((d) => d.label.toLowerCase().includes(needle))
    .map((d) => sql`${d.sourceKey}`);
  const searchFrag =
    term === ''
      ? sql`TRUE`
      : sql`(${savedReports.name} ILIKE ${pat} ESCAPE '\\'
          OR ${savedReports.description} ILIKE ${pat} ESCAPE '\\'
          OR ${savedReports.sourceKey} ILIKE ${pat} ESCAPE '\\'
          OR ${users.email} ILIKE ${pat} ESCAPE '\\'
          ${sourceHits.length > 0 ? sql`OR ${savedReports.sourceKey} IN (${sql.join(sourceHits, sql`, `)})` : sql``})`;
  const where = and(
    eq(savedReports.companyId, companyId),
    isNull(savedReports.deletedAt),
    // Service-layer visibility filter — RLS already gates company.
    or(eq(savedReports.ownerId, user.id), eq(savedReports.isShared, true)),
    searchFrag,
    sql`TRUE ${sfWhere(SAVED_REPORT_SF_COLUMNS, sf)}`,
  );
  return withUserContext(user, async (tx) => {
    const base = tx
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
      .where(where)
      .orderBy(
        sfOrderBy(
          SAVED_REPORT_SF_COLUMNS,
          sf,
          sql`${desc(savedReports.updatedAt)}, ${desc(savedReports.id)}`,
        ),
      )
      .$dynamic();
    const [rows, totals] = await Promise.all([
      input.limit === undefined
        ? base.offset(input.offset)
        : base.limit(input.limit).offset(input.offset),
      tx
        .select({ value: count() })
        .from(savedReports)
        .leftJoin(users, eq(users.id, savedReports.ownerId))
        .where(where),
    ]);

    return {
      reports: rows.map((r) =>
        rowToSavedReport(r as typeof savedReports.$inferSelect & { ownerEmail: string | null }),
      ),
      total: totals[0]?.value ?? 0,
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
    if (!row) throw new NotFoundError('Saved report not found. Refresh the page.');
    if (row.ownerId !== user.id && !row.isShared && !isManager(user)) {
      throw new NotFoundError('Saved report not found. Refresh the page.');
    }
    return rowToSavedReport(
      row as typeof savedReports.$inferSelect & { ownerEmail: string | null },
    );
  });
}

async function assertSourceUsable(sourceKey: string, user: AuthContext): Promise<void> {
  const src = getSource(sourceKey);
  if (!src) {
    throw new NotFoundError(`Source "${sourceKey}" not found`);
  }
  if (!(await canUseSource(user, sourceKey))) {
    throw new AuthorizationError(
      `Your access does not let you open ${src.descriptor.label}, so you cannot build or run ` +
        'a report on it. Ask an admin to give you View on that page in Access Control.',
    );
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
  await assertSourceUsable(input.sourceKey, user);

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
      .limit(1)
      // Lock the report row. Without it this re-read and the UPDATE below are two
      // separate statements, and every column is written back as
      // `input.x ?? existing.x` — so two saves a moment apart (even two tabs of
      // the SAME user) could each read the old row, and the second would write
      // the stale value of every field the first one had just changed. That is a
      // lost update with no competing editor at all, which is why the lock comes
      // first and the version check second.
      .for('update');
    const existing = rows[0];
    if (!existing) throw new NotFoundError('Saved report not found. Refresh the page.');
    assertCanWrite(existing, user);
    // ADR-226 / §20.4 — refuse the save if someone else changed this report after
    // the form loaded it, and say who. Under the lock above, so check-then-write
    // is atomic. The name lookup runs only on the refusal path (see
    // lib/row-changed-by.ts), so a normal save pays nothing for it.
    if (editConflicts(existing.updatedAt, input.expectedUpdatedAt)) {
      assertUnchangedSinceOpened(
        existing.updatedAt,
        input.expectedUpdatedAt,
        await rowChangedByName(tx, existing.updatedBy),
      );
    }

    const nextSourceKey = input.sourceKey ?? existing.sourceKey;
    const nextSpec: AdHocSpec = input.spec
      ? adHocSpecSchema.parse(input.spec)
      : adHocSpecSchema.parse(existing.spec);
    if (nextSpec.sourceKey !== nextSourceKey) {
      throw new ConflictError('spec.sourceKey must match the report sourceKey');
    }
    await assertSourceUsable(nextSourceKey, user);

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
    if (!existing) throw new NotFoundError('Saved report not found. Refresh the page.');
    assertCanWrite(existing, user);

    await tx
      .update(savedReports)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(eq(savedReports.id, id));
  });
}

export async function runSavedReport(id: string, user: AuthContext): Promise<RunAdHocResponse> {
  const report = await getSavedReport(id, user);
  // A shared report is run with the RUNNER's rights, not the owner's.
  await assertSourceUsable(report.sourceKey, user);
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
  await assertSourceUsable(spec.sourceKey, user);
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
