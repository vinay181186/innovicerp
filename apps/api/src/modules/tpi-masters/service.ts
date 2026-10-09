import { ActivityAction } from '@innovic/shared';
import type { DocumentEditStagedResult } from '@innovic/shared';
import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { tpiMasters } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { editConflicts, rowChangedByName } from '../../lib/row-changed-by';
import { TPI_MASTER_SF_COLUMNS } from './sf-columns';
import type {
  CreateTpiMasterInput,
  ListTpiMastersQuery,
  ListTpiMastersResponse,
  TpiMaster,
  UpdateTpiMasterInput,
} from './schema';
import { type DiffField, softDeleteStamp } from '../../lib/audit-trail';
import { emitActivityLog } from '../activity-log/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a
 *  user typing "a_b" — or a bare "%", which listed every inspector — gets a
 *  wildcard pattern instead of a literal search. No ESCAPE clause is needed
 *  alongside it: backslash is already Postgres's default LIKE escape character
 *  (drizzle's `ilike()`, which this list is written with, cannot emit one) —
 *  verified against the live database.
 *  Deliberately a local copy of the clients / operators helper rather than an
 *  export across modules: it is three lines, and each list must be free to
 *  change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Named column list rather than a bare select(): house rule 6 forbids SELECT *,
// and spelling the columns out means a column added to tpi_masters later cannot
// silently start travelling to the browser.
const tpiMasterColumns = {
  id: tpiMasters.id,
  companyId: tpiMasters.companyId,
  code: tpiMasters.code,
  organization: tpiMasters.organization,
  contactNo: tpiMasters.contactNo,
  email: tpiMasters.email,
  remarks: tpiMasters.remarks,
  isActive: tpiMasters.isActive,
  createdAt: tpiMasters.createdAt,
  createdBy: tpiMasters.createdBy,
  updatedAt: tpiMasters.updatedAt,
  updatedBy: tpiMasters.updatedBy,
  deletedAt: tpiMasters.deletedAt,
};

const activeLabel = (v: unknown): string | null =>
  v === true ? 'Active' : v === false ? 'Inactive' : null;

/** Every user-editable TPI Inspector field, with its screen label (NAMING.md),
 *  for the Edit row's Before → After (ADR-197) and the edit-approval engine's
 *  diff (tpi-master-edit-registry.ts). `code` (Inspector Name) is permanent and
 *  is NOT here — it is never written on edit. */
export const TPI_MASTER_EDIT_FIELDS: readonly DiffField[] = [
  { key: 'organization', label: 'Organisation' },
  { key: 'contactNo', label: 'Contact No.' },
  { key: 'email', label: 'Email' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'isActive', label: 'Active', format: activeLabel },
];

export async function listTpiMasters(
  input: ListTpiMastersQuery,
  user: AuthContext,
): Promise<ListTpiMastersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(tpiMasters.companyId, companyId), isNull(tpiMasters.deletedAt)];
    if (input.search) {
      // Search covers every column the TPI Master table actually shows —
      // Inspector Name (`code`), Organization, Contact No. and Email (the
      // column defs in apps/web/src/modules/tpi-masters/routes/list.tsx).
      // Both halves of the picker label stay searchable: users look an
      // inspector up by person ("Sharma") as often as by the firm they inspect
      // for.
      // Deliberately NOT searched:
      //  - remarks: held on the inspector, but not on this screen;
      //  - Status — it is a boolean rendered as an "Active"/"Inactive" badge,
      //    and a substring match on "active" also matches "inactive", so it
      //    would return every row. The list already has an Active/Inactive
      //    dropdown for that.
      // No money or quantity column exists on this table, so there is nothing
      // here that could leak a value to someone without price access.
      const term = `%${escapeLikeTerm(input.search)}%`;
      const s = or(
        ilike(tpiMasters.code, term),
        ilike(tpiMasters.organization, term),
        ilike(tpiMasters.contactNo, term),
        ilike(tpiMasters.email, term),
      );
      if (s) conditions.push(s);
    }
    if (input.isActive !== undefined) conditions.push(eq(tpiMasters.isActive, input.isActive));
    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own whitelist (sf-columns.ts). List AND count.
    const sf = readSf(input.sf);
    conditions.push(sql`TRUE ${sfWhere(TPI_MASTER_SF_COLUMNS, sf)}`);

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select(tpiMasterColumns)
        .from(tpiMasters)
        .where(where)
        .orderBy(
          // ADR-201: ends on id so a 25-row page never skips or repeats a row.
          sfOrderBy(TPI_MASTER_SF_COLUMNS, sf, sql`${asc(tpiMasters.code)}, ${asc(tpiMasters.id)}`),
        )
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(tpiMasters).where(where),
    ]);

    return {
      items: rows as unknown as TpiMaster[],
      total: totals[0]?.value ?? 0,
    };
  });
}

export async function getTpiMaster(id: string, user: AuthContext): Promise<TpiMaster> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select(tpiMasterColumns)
      .from(tpiMasters)
      .where(and(eq(tpiMasters.id, id), isNull(tpiMasters.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('TPI Inspector not found. Refresh the page.');
    return row as unknown as TpiMaster;
  });
}

export async function createTpiMaster(
  input: CreateTpiMasterInput,
  user: AuthContext,
): Promise<TpiMaster> {
  // Creating a master record is `entry`, so L2 Data Entry and above in QC.
  await requireFormAccess(user, 'tpimaster_create', 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Checked up front so a repeated name comes back as a sentence the shop
    // floor can act on. The unique index stays the real guard — two
    // simultaneous creates raise 23505, which the error handler maps to 409.
    const existing = await tx
      .select({ id: tpiMasters.id })
      .from(tpiMasters)
      .where(
        and(
          eq(tpiMasters.companyId, companyId),
          eq(tpiMasters.code, input.code),
          isNull(tpiMasters.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`An inspector named "${input.code}" already exists`);
    }

    const inserted = await tx
      .insert(tpiMasters)
      .values({
        companyId,
        code: input.code.trim(),
        organization: emptyToNull(input.organization),
        contactNo: emptyToNull(input.contactNo),
        // The shared schema lets email through as '' (the box is optional on
        // the form). Blank is stored as null so "no email" reads the same way
        // whether the box was skipped or cleared.
        email: emptyToNull(input.email),
        remarks: emptyToNull(input.remarks),
        isActive: input.isActive,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning(tpiMasterColumns);
    return inserted[0] as unknown as TpiMaster;
  });
}

export async function updateTpiMaster(
  id: string,
  input: UpdateTpiMasterInput,
  user: AuthContext,
): Promise<TpiMaster> {
  // Changing a saved record is `edit`, which L2 Data Entry deliberately does
  // not have — it may create, not alter. Checked in the public wrapper, not the
  // tx body, so the edit-approval engine's applyEdit can replay an approved edit
  // for an approver who holds `approve` but not `edit`.
  await requireFormAccess(user, 'tpimaster_create', 'edit');
  return withUserContext(user, (tx) => updateTpiMasterTx(tx, id, input, user));
}

/**
 * The body of a TPI Inspector edit, inside a caller-supplied transaction. Called
 * by updateTpiMaster (which opens the tx) and by the edit-approval engine's
 * applyEdit (which already holds the target row lock). Every §20 guard lives
 * here: the row's FOR UPDATE lock and assertUnchangedSinceOpened. The caller
 * performs the edit / approve access check.
 */
export async function updateTpiMasterTx(
  tx: DbTransaction,
  id: string,
  input: UpdateTpiMasterInput,
  user: AuthContext,
): Promise<TpiMaster> {
  requireCompany(user);
  // ADR-226 / §20.4 — read under the row lock, so the version check below and
  // the UPDATE are one atomic step: a second editor WAITS here, then sees the
  // first editor's new updated_at and is refused instead of overwriting it.
  // Named columns, never SELECT * (§6 rule 6).
  const existing = await tx
    .select({ id: tpiMasters.id, updatedAt: tpiMasters.updatedAt, updatedBy: tpiMasters.updatedBy })
    .from(tpiMasters)
    .where(and(eq(tpiMasters.id, id), isNull(tpiMasters.deletedAt)))
    .limit(1)
    .for('update');
  if (existing.length === 0) throw new NotFoundError('TPI Inspector not found. Refresh the page.');
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

  // `code` is absent from UpdateTpiMasterInput and is never written here: the
  // TPI logs already signed off under that name have to keep agreeing with
  // the master. An inspector is retired with isActive, not renamed.
  // `updatedAt` is stamped BY HAND here: tpi_masters has no set_updated_at
  // database trigger (unlike machines / operators / qc_processes). The version
  // check above depends on this stamp — drop it and every concurrent edit
  // silently wins again. Any new EDIT path on this table must stamp it too.
  // (softDeleteTpiMaster below does not, deliberately: a deleted inspector
  // 404s on edit, so there is no version for anyone to race over.)
  const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
  if (input.organization !== undefined) updates.organization = emptyToNull(input.organization);
  if (input.contactNo !== undefined) updates.contactNo = emptyToNull(input.contactNo);
  if (input.email !== undefined) updates.email = emptyToNull(input.email);
  if (input.remarks !== undefined) updates.remarks = emptyToNull(input.remarks);
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  const updated = await tx
    .update(tpiMasters)
    .set(updates)
    .where(eq(tpiMasters.id, id))
    .returning(tpiMasterColumns);
  return updated[0] as unknown as TpiMaster;
}

/**
 * The TPI Inspector edit entry point the HTTP route calls. Edit-approval
 * (ADR-202): when the company gate is on and the inspector is still editable (a
 * master is editable while it is not in Trash), the edit is STAGED for approval
 * and a {staged:true, request} result is returned; otherwise it falls through to
 * updateTpiMaster (today's behaviour). A record-level master has no child lines
 * — there is no line guard.
 */
export async function updateTpiMasterOrStage(
  id: string,
  input: UpdateTpiMasterInput,
  user: AuthContext,
): Promise<TpiMaster | DocumentEditStagedResult> {
  await requireFormAccess(user, 'tpimaster_create', 'edit');
  const companyId = requireCompany(user);

  // Imported dynamically to avoid a static import cycle with the registry entry
  // (which imports updateTpiMasterTx from this file).
  const { isDocEditApprovalOn, requestDocumentEdit } = await import('../document-edits/service');
  const shouldStage = await withUserContext(user, async (tx) => {
    if (!(await isDocEditApprovalOn(tx, companyId))) return false;
    // "Editable" mirrors the registry's isLive: any live (not-Trash) inspector.
    const rows = await tx
      .select({ id: tpiMasters.id })
      .from(tpiMasters)
      .where(
        and(
          eq(tpiMasters.id, id),
          eq(tpiMasters.companyId, companyId),
          isNull(tpiMasters.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
  if (shouldStage) {
    // The form's own version token rides along (ADR-226), so staging an edit
    // from a stale form is refused the same way saving one is.
    const request = await requestDocumentEdit(
      'TpiInspector',
      id,
      input,
      input.expectedUpdatedAt,
      user,
    );
    return { staged: true, request };
  }

  return updateTpiMaster(id, input, user);
}

export async function softDeleteTpiMaster(id: string, user: AuthContext): Promise<{ ok: true }> {
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // that only L5 Department Admin and above hold: edit AND approve. L3 Editor
  // has edit but not approve; L4 Approver has approve but not edit.
  await requireFormAccess(user, 'tpimaster_create', 'edit');
  await requireFormAccess(user, 'tpimaster_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: tpiMasters.id, code: tpiMasters.code })
      .from(tpiMasters)
      .where(and(eq(tpiMasters.id, id), isNull(tpiMasters.deletedAt)))
      .limit(1);
    if (existing.length === 0)
      throw new NotFoundError('TPI Inspector not found. Refresh the page.');

    // Soft delete only. A TPI log stores the inspector's name as text, so
    // removing the master row never rewrites an inspection already signed off —
    // it only takes the name out of the pickers.
    await tx
      .update(tpiMasters)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(eq(tpiMasters.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'TpiInspector',
        entityId: id,
        refId: existing[0]?.code ?? null,
        detail: `Deleted TPI Inspector ${existing[0]?.code ?? id}`,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
