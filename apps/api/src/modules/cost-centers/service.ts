import { ActivityAction, type DocumentEditStagedResult } from '@innovic/shared';
import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { costCenters } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { editConflicts, rowChangedByName } from '../../lib/row-changed-by';
import type {
  CostCenter,
  CreateCostCenterInput,
  ListCostCentersQuery,
  ListCostCentersResponse,
  UpdateCostCenterInput,
} from './schema';
import { type DiffField, softDeleteStamp } from '../../lib/audit-trail';
import { COST_CENTER_SF_COLUMNS } from './sf-columns';
import { emitActivityLog } from '../activity-log/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const activeLabel = (v: unknown): string | null =>
  v === true ? 'Active' : v === false ? 'Inactive' : null;

/** Every user-editable Cost Centre field, with its screen label (the Cost Centre
 *  form / NAMING.md), for the edit-approval engine's Before → After (ADR-202).
 *  Exported so cost-center-edit-registry.ts diffs the same set. `code` is not
 *  updatable (omitted from the shared input schema), so it is not diffed. */
export const COST_CENTER_EDIT_FIELDS: readonly DiffField[] = [
  { key: 'name', label: 'Cost Centre Name' },
  { key: 'department', label: 'Department' },
  { key: 'type', label: 'Cost Centre Type' },
  { key: 'description', label: 'Description' },
  { key: 'isActive', label: 'Active', format: activeLabel },
];

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Cost Center Master search box gets a wildcard pattern
 *  instead of a literal search — i.e. the search box becomes a "show
 *  everything" button. Postgres's DEFAULT LIKE/ILIKE escape character is
 *  backslash, so no explicit ESCAPE clause is needed here (and drizzle's
 *  `ilike()` builder, which this list is written with, cannot emit one) —
 *  verified against the live database.
 *  Deliberately a local copy of the sales-orders / purchase-orders helper
 *  rather than an export across modules: it is three lines, and each list must
 *  be free to change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listCostCenters(
  input: ListCostCentersQuery,
  user: AuthContext,
): Promise<ListCostCentersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(costCenters.companyId, companyId), isNull(costCenters.deletedAt)];
    if (input.search) {
      // Search covers every column the Cost Center Master list actually shows —
      // Code, Name, Department, Type and Description (the column defs in
      // apps/web/src/modules/cost-centers/routes/list.tsx).
      // Deliberately NOT searched: Status — it is a boolean rendered as an
      // "Active"/"Inactive" badge, and a substring match on "active" also
      // matches "inactive", so it would return every row. The list already has
      // its own status filter.
      // No money or quantity column exists on this table, so there is nothing
      // here that could leak a value to someone without price access.
      const term = `%${escapeLikeTerm(input.search)}%`;
      const s = or(
        ilike(costCenters.code, term),
        ilike(costCenters.name, term),
        ilike(costCenters.department, term),
        ilike(costCenters.type, term),
        ilike(costCenters.description, term),
      );
      if (s) conditions.push(s);
    }
    if (input.isActive !== undefined) conditions.push(eq(costCenters.isActive, input.isActive));
    if (input.department) conditions.push(eq(costCenters.department, input.department));
    if (input.type) conditions.push(eq(costCenters.type, input.type));

    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to list AND count.
    const sf = readSf(input.sf);
    conditions.push(sql`TRUE ${sfWhere(COST_CENTER_SF_COLUMNS, sf)}`);

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(costCenters)
        .where(where)
        .orderBy(sfOrderBy(COST_CENTER_SF_COLUMNS, sf, asc(costCenters.code)))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(costCenters).where(where),
    ]);

    return {
      items: rows as unknown as CostCenter[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getCostCenter(id: string, user: AuthContext): Promise<CostCenter> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(costCenters)
      .where(and(eq(costCenters.id, id), isNull(costCenters.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Cost Centre not found. It may have been moved to Trash.');
    return row as unknown as CostCenter;
  });
}

export async function createCostCenter(
  input: CreateCostCenterInput,
  user: AuthContext,
): Promise<CostCenter> {
  requireWriteRole(user);
  // Tier gate (Access Control matrix). L2 Data Entry+ in Finance can add a cost
  // center; L1 Viewer and L4 Approver cannot.
  await requireFormAccess(user, 'cc_create', 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(
        and(
          eq(costCenters.companyId, companyId),
          eq(costCenters.code, input.code),
          isNull(costCenters.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`Cost Centre Code "${input.code}" already exists.`);
    }

    const inserted = await tx
      .insert(costCenters)
      .values({
        companyId,
        code: input.code.trim(),
        name: input.name.trim(),
        department: emptyToNull(input.department),
        type: emptyToNull(input.type),
        description: emptyToNull(input.description),
        isActive: input.isActive,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return inserted[0] as unknown as CostCenter;
  });
}

export async function updateCostCenter(
  id: string,
  input: UpdateCostCenterInput,
  user: AuthContext,
): Promise<CostCenter> {
  requireWriteRole(user);
  // Changing a saved record is `edit`, so L2 (create-only) is correctly refused.
  // Checked HERE, not in the tx body, so the edit-approval engine's applyEdit can
  // replay an approved edit for an approver who holds `approve` but not `edit`.
  await requireFormAccess(user, 'cc_create', 'edit');
  return withUserContext(user, (tx) => updateCostCenterTx(tx, id, input, user));
}

/**
 * The body of a Cost Centre edit, inside a caller-supplied transaction. Called by
 * updateCostCenter (which opens the tx) and by the edit-approval engine's
 * applyEdit (which already holds one, with the row locked FOR UPDATE). Every
 * §20 guard lives here: the row's FOR UPDATE lock and
 * assertUnchangedSinceOpened. The caller performs the write-role / edit /
 * approve access check.
 */
export async function updateCostCenterTx(
  tx: DbTransaction,
  id: string,
  input: UpdateCostCenterInput,
  user: AuthContext,
): Promise<CostCenter> {
  requireCompany(user);
  // ADR-226 / §20.4 — read under the row lock, so the version check below and
  // the UPDATE are one atomic step: a second editor WAITS here, then sees the
  // first editor's new updated_at and is refused instead of overwriting it.
  // Named columns, never SELECT * (§6 rule 6).
  const existing = await tx
    .select({
      id: costCenters.id,
      updatedAt: costCenters.updatedAt,
      updatedBy: costCenters.updatedBy,
    })
    .from(costCenters)
    .where(and(eq(costCenters.id, id), isNull(costCenters.deletedAt)))
    .limit(1)
    .for('update');
  if (existing.length === 0)
    throw new NotFoundError('Cost Centre not found. It may have been moved to Trash.');
  const cur = existing[0]!;
  // Refuse a save made over someone else's newer edit, naming who changed it.
  // The name lookup sits INSIDE the cheap predicate: the happy path must not
  // pay for a query that only ever fills in an error message.
  if (editConflicts(cur.updatedAt, input.expectedUpdatedAt)) {
    assertUnchangedSinceOpened(
      cur.updatedAt,
      input.expectedUpdatedAt,
      await rowChangedByName(tx, cur.updatedBy),
    );
  }

  // `updatedAt` is stamped BY HAND here: cost_centers has no set_updated_at
  // database trigger (unlike machines / operators / qc_processes). The version
  // check above depends on this stamp — drop it and every concurrent edit
  // silently wins again. Any new EDIT path on this table must stamp it too.
  // (softDeleteCostCenter does not, deliberately: a deleted cost centre 404s
  // on edit, so there is no version for anyone to race over.)
  const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.department !== undefined) updates.department = emptyToNull(input.department);
  if (input.type !== undefined) updates.type = emptyToNull(input.type);
  if (input.description !== undefined) updates.description = emptyToNull(input.description);
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  const updated = await tx
    .update(costCenters)
    .set(updates)
    .where(eq(costCenters.id, id))
    .returning();
  return updated[0] as unknown as CostCenter;
}

/**
 * The Cost Centre edit entry point the HTTP route calls. Edit-approval (ADR-202):
 * when the company gate is on and the cost centre is still editable (a master is
 * editable while it is not in Trash), the edit is STAGED for approval; otherwise
 * it falls through to updateCostCenter. A cost centre is a single record with no
 * child lines, so there is no line guard. The form's `expectedUpdatedAt` is
 * forwarded to the engine (ADR-226), so staging an edit from a stale form is
 * refused the same way saving one is.
 */
export async function updateCostCenterOrStage(
  id: string,
  input: UpdateCostCenterInput,
  user: AuthContext,
): Promise<CostCenter | DocumentEditStagedResult> {
  requireWriteRole(user);
  await requireFormAccess(user, 'cc_create', 'edit');
  const companyId = requireCompany(user);

  // Imported dynamically to avoid a static import cycle with
  // cost-center-edit-registry (which imports updateCostCenterTx from here).
  const { isDocEditApprovalOn, requestDocumentEdit } = await import('../document-edits/service');
  const shouldStage = await withUserContext(user, async (tx) => {
    if (!(await isDocEditApprovalOn(tx, companyId))) return false;
    // "Editable" mirrors costCenterEditRegistryEntry.isLive: any live row.
    const rows = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(
        and(
          eq(costCenters.id, id),
          eq(costCenters.companyId, companyId),
          isNull(costCenters.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
  if (shouldStage) {
    const request = await requestDocumentEdit(
      'CostCenter',
      id,
      input,
      input.expectedUpdatedAt,
      user,
    );
    return { staged: true, request };
  }

  return updateCostCenter(id, input, user);
}

export async function softDeleteCostCenter(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  // Delete is expressed as the pair only L5 Department Admin and above hold:
  // edit AND approve. L3 Editor has edit but not approve; L4 Approver the reverse.
  await requireFormAccess(user, 'cc_create', 'edit');
  await requireFormAccess(user, 'cc_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: costCenters.id, code: costCenters.code })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), isNull(costCenters.deletedAt)))
      .limit(1);
    if (existing.length === 0)
      throw new NotFoundError('Cost Centre not found. It may have been moved to Trash.');
    await tx
      .update(costCenters)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(eq(costCenters.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'CostCenter',
        entityId: id,
        refId: existing[0]?.code ?? null,
        detail: `Deleted Cost Centre ${existing[0]?.code ?? id}`,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
