// Saved-reports service (T-041b). CRUD + run.
//
// RLS provides company isolation. The service layer enforces:
//   - List filter: own reports + shared in same company
//   - Update / delete: only the owner, or a Super Admin (ADR-232)
//   - Spec validation against the source catalog before any DB write/run

import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { listSavedReportsQuerySchema } from '@innovic/shared';
import type { z } from 'zod';
import { savedReports, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  canSeeFormPrice,
  hasFormAccess,
  primeAccess,
  requireCanWrite,
  requireDeleteRight,
} from '../../lib/access';
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
import { getSource, listSourceDescriptors, type RegisteredSource } from './sources';
import { softDeleteStamp } from '../../lib/audit-trail';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// ADR-232: role 'admin' is L6 Super Admin — the only one who sees or changes
// another person's private report.
const isSuperAdmin = (user: AuthContext): boolean => user.role === 'admin';

// A data source is offered only to users who may VIEW its department page
// (Sales Orders, Purchase Orders, Job Cards, Item Master, NC Register) —
// checked on list, save, preview and run, never only in the browser.
async function canUseSource(user: AuthContext, sourceKey: string): Promise<boolean> {
  const src = getSource(sourceKey);
  if (!src) return false;
  return hasFormAccess(user, src.viewForm, 'view');
}

// The source's money fields this user may NOT see (empty when they may).
async function hiddenPriceFields(user: AuthContext, src: RegisteredSource): Promise<Set<string>> {
  if (!src.priceFields?.length) return new Set();
  return (await canSeeFormPrice(user, src.viewForm)) ? new Set() : new Set(src.priceFields);
}

export async function listSources(user: AuthContext): Promise<ListSourcesResponse> {
  const all = listSourceDescriptors();
  const allowed = await Promise.all(all.map((d) => canUseSource(user, d.sourceKey)));
  const sources = await Promise.all(
    all
      .filter((_, i) => allowed[i])
      .map(async (d) => {
        const src = getSource(d.sourceKey);
        const hidden = src ? await hiddenPriceFields(user, src) : new Set<string>();
        return hidden.size ? { ...d, fields: d.fields.filter((f) => !hidden.has(f.key)) } : d;
      }),
  );
  return { sources };
}

function priceRefusal(src: RegisteredSource): AuthorizationError {
  return new AuthorizationError(
    `Your access hides prices on ${src.descriptor.label}, so this report cannot use Rate ` +
      'or Amount. Remove them, or ask an admin for Price on that page in Access Control.',
  );
}

// Fields whose VALUES shape the result even when no money column is shown:
// filters, sort, group, and a money total (COUNT reveals nothing).
function moneyShapesResult(spec: AdHocSpec, hidden: Set<string>): boolean {
  const aggregated = spec.groupBy !== null && spec.sumFn !== 'COUNT' ? spec.sumCol : null;
  return [
    ...spec.filters.map((f) => f.field),
    ...spec.sort.map((x) => x.field),
    spec.groupBy,
    aggregated,
  ].some((k) => k !== null && hidden.has(k));
}

async function hiddenFor(spec: AdHocSpec, user: AuthContext) {
  const src = getSource(spec.sourceKey);
  return src ? { src, hidden: await hiddenPriceFields(user, src) } : null;
}

// Run / preview / Excel: a price-hidden user gets the report WITHOUT its money
// columns; one that filters, sorts, groups or totals by money is refused — its
// result would give the figures away even with the column gone.
async function priceSafeSpec(spec: AdHocSpec, user: AuthContext): Promise<AdHocSpec> {
  const h = await hiddenFor(spec, user);
  if (!h?.hidden.size) return spec;
  const columns = spec.columns.filter((c) => !h.hidden.has(c));
  if (moneyShapesResult(spec, h.hidden) || columns.length === 0) throw priceRefusal(h.src);
  return { ...spec, columns };
}

// Save: a price-hidden user may not store a report that uses money at all.
async function assertSpecPriceSafe(spec: AdHocSpec, user: AuthContext): Promise<void> {
  const h = await hiddenFor(spec, user);
  if (!h?.hidden.size) return;
  if (moneyShapesResult(spec, h.hidden) || spec.columns.some((c) => h.hidden.has(c))) {
    throw priceRefusal(h.src);
  }
}

// Reading a report: a price-hidden user never sees the VALUE of a money filter
// (e.g. "Rate > 1250" gives the price away). Running it is refused anyway.
async function maskPriceFilters(r: SavedReport, user: AuthContext): Promise<SavedReport> {
  const h = await hiddenFor(r.spec, user);
  if (!h?.hidden.size || !r.spec.filters.some((f) => h.hidden.has(f.field))) return r;
  const filters = r.spec.filters.map((f) => (h.hidden.has(f.field) ? { ...f, value: '' } : f));
  return { ...r, spec: { ...r.spec, filters } };
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
  const res = await listSavedReportsRows(user, input);
  return { ...res, reports: await Promise.all(res.reports.map((r) => maskPriceFilters(r, user))) };
}

async function listSavedReportsRows(
  user: AuthContext,
  input: ListSavedReportsInput,
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

/** GET /saved-reports/:id — the report as the CALLER may see it. */
export async function readSavedReport(id: string, user: AuthContext): Promise<SavedReport> {
  return maskPriceFilters(await getSavedReport(id, user), user);
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
    if (row.ownerId !== user.id && !row.isShared && !isSuperAdmin(user)) {
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
  // ADR-232: a person's own report — everyone set up may save one, an Auditor not.
  await requireCanWrite(user);
  const companyId = requireCompany(user);
  if (input.spec.sourceKey !== input.sourceKey) {
    throw new ConflictError('spec.sourceKey must match input.sourceKey');
  }
  await assertSourceUsable(input.sourceKey, user);
  await assertSpecPriceSafe(input.spec, user);

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

async function assertCanWrite(
  row: typeof savedReports.$inferSelect,
  user: AuthContext,
): Promise<void> {
  if (row.ownerId === user.id) {
    await requireCanWrite(user);
    return;
  }
  if (isSuperAdmin(user)) return;
  throw new AuthorizationError('Only the owner or a Super Admin can modify this report');
}

/** ADR-232: a person may delete their OWN saved report; anyone else's needs
 *  the Super Admin delete right. */
async function assertCanDelete(
  row: typeof savedReports.$inferSelect,
  user: AuthContext,
): Promise<void> {
  if (row.ownerId === user.id) {
    await requireCanWrite(user);
    return;
  }
  await requireDeleteRight(user, "other people's saved reports");
}

export async function updateSavedReport(
  id: string,
  input: UpdateSavedReportInput,
  user: AuthContext,
): Promise<SavedReport> {
  // Access is read now, outside the transaction below (see primeAccess).
  await primeAccess(user);
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
    await assertCanWrite(existing, user);
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
    if (input.spec) await assertSpecPriceSafe(nextSpec, user);

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
  // Access is read now, outside the transaction below (see primeAccess).
  await primeAccess(user);
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
    await assertCanDelete(existing, user);

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
  const spec = await priceSafeSpec(report.spec, user);
  return withUserContext(user, async (tx) => {
    const result = await runAdHoc(spec, { tx, companyId: report.companyId });
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
  const parsed = await priceSafeSpec(adHocSpecSchema.parse(spec), user);
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
