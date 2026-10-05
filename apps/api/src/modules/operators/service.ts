import {
  ActivityAction,
  type DocumentEditStagedResult,
  type MasterImportRowResult,
} from '@innovic/shared';
import { and, asc, count, eq, ilike, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { operators } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { dropBlankCells, rawRowText, zodRowReason } from '../../lib/master-rules';
import { createOperatorInputSchema, updateOperatorImportRowSchema } from './schema';
import type {
  BulkCreateOperatorsInput,
  BulkCreateOperatorsResponse,
  BulkOperatorSkip,
  CreateOperatorInput,
  ListOperatorsQuery,
  ListOperatorsResponse,
  Operator,
  UpdateOperatorInput,
} from './schema';
import { type DiffField, diffFields, softDeleteStamp } from '../../lib/audit-trail';
import { OPERATOR_SF_COLUMNS } from './sf-columns';
import { emitActivityLog } from '../activity-log/service';

type OperatorRow = typeof operators.$inferSelect;

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const activeLabel = (v: unknown): string | null =>
  v === true ? 'Active' : v === false ? 'Inactive' : null;

/** Every user-editable Operator Master field, with the label the screen uses,
 *  for the Edit row's Before → After (ADR-197). Mirrors VENDOR_FIELDS. Exported
 *  so operator-edit-registry.ts (ADR-202) diffs the same set as the bulk-import
 *  update path already does. */
export const OPERATOR_FIELDS: readonly DiffField[] = [
  { key: 'name', label: 'Name' },
  { key: 'department', label: 'Department' },
  { key: 'skills', label: 'Skills / Machines' },
  { key: 'isActive', label: 'Active', format: activeLabel },
  { key: 'userId', label: 'Linked User' },
];

/** Excel column names for a refused row's reason (import template headers). */
const OPERATOR_IMPORT_LABELS: Record<string, string> = {
  code: 'Code',
  name: 'Operator Name',
  department: 'Department',
  skills: 'Skills',
  isActive: 'Status',
  userId: 'Linked User',
};

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Operator Master search box gets a wildcard pattern instead
 *  of a literal search — i.e. the search box becomes a "show everything"
 *  button. Postgres's DEFAULT LIKE/ILIKE escape character is backslash, so no
 *  explicit ESCAPE clause is needed here (and drizzle's `ilike()` builder,
 *  which this list is written with, cannot emit one) — verified against the
 *  live database.
 *  Deliberately a local copy of the sales-orders / purchase-orders helper
 *  rather than an export across modules: it is three lines, and each list must
 *  be free to change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listOperators(
  input: ListOperatorsQuery,
  user: AuthContext,
): Promise<ListOperatorsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(operators.companyId, companyId), isNull(operators.deletedAt)];
    if (input.search) {
      // Search covers every column the Operator Master list actually shows —
      // Operator ID, Name, Department and Skills / Machines (the column defs in
      // apps/web/src/modules/operators/routes/list.tsx).
      // Deliberately NOT searched:
      //  - the linked user id — an internal id, not on the screen;
      //  - Status — it is a boolean rendered as an "Active"/"Inactive" badge,
      //    and a substring match on "active" also matches "inactive", so it
      //    would return every row. The list already has a status filter.
      // No money or quantity column exists on this table, so there is nothing
      // here that could leak a value to someone without price access.
      const term = `%${escapeLikeTerm(input.search)}%`;
      const s = or(
        ilike(operators.code, term),
        ilike(operators.name, term),
        ilike(operators.department, term),
        ilike(operators.skills, term),
      );
      if (s) conditions.push(s);
    }
    if (typeof input.isActive === 'boolean') {
      conditions.push(eq(operators.isActive, input.isActive));
    }

    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to list AND count.
    const sf = readSf(input.sf);
    conditions.push(sql`TRUE ${sfWhere(OPERATOR_SF_COLUMNS, sf)}`);

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(operators)
        .where(where)
        .orderBy(sfOrderBy(OPERATOR_SF_COLUMNS, sf, asc(operators.code)))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(operators).where(where),
    ]);

    return {
      operators: rows as unknown as Operator[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getOperator(id: string, user: AuthContext): Promise<Operator> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(operators)
      .where(and(eq(operators.id, id), isNull(operators.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Operator not found. Refresh the page.');
    return row as unknown as Operator;
  });
}

/** Next OP-### code in the company series. Server-authoritative so operator
 *  IDs auto-generate instead of being typed manually. */
async function nextOperatorCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: operators.code })
    .from(operators)
    .where(and(eq(operators.companyId, companyId), like(operators.code, 'OP-%')))
    .orderBy(sql`length(${operators.code}) desc`, sql`${operators.code} desc`)
    .limit(1);
  const last = rows[0]?.code ?? null;
  let next = 1;
  if (last) {
    const m = last.match(/^OP-(\d+)$/i);
    if (m) next = Number(m[1]) + 1;
  }
  return `OP-${String(next).padStart(3, '0')}`;
}

/** Preview the next OP-### for the create form (visible before save). Reuses
 *  the insert-path generator so the preview matches the assigned code. */
export async function getNextOperatorCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextOperatorCode(tx, companyId) }));
}

export async function createOperator(
  input: CreateOperatorInput,
  user: AuthContext,
): Promise<Operator> {
  // Tier gate (was requireWriteRole). L2 Data Entry and up in Production can add
  // an operator; L1 Viewer cannot.
  await requireFormAccess(user, 'operator_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on operators_company_code_uniq (23505) — e.g. both auto-generate the
  // same OP-### — so the loser retries with the next code instead of 500ing.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const code = input.code?.trim() || (await nextOperatorCode(tx, companyId));
      const existing = await tx
        .select({ id: operators.id, deletedAt: operators.deletedAt })
        .from(operators)
        .where(and(eq(operators.companyId, companyId), eq(operators.code, code)))
        .limit(1);
      const dup = existing[0];
      if (dup) {
        if (dup.deletedAt) {
          throw new ConflictError(
            `Operator code "${code}" belongs to a deleted operator — restore it instead of re-creating`,
          );
        }
        throw new ConflictError(`Operator code "${code}" already exists`);
      }

      const userIdValue = input.userId && input.userId.length > 0 ? input.userId : null;

      const inserted = await tx
        .insert(operators)
        .values({
          companyId,
          code,
          name: input.name,
          department: emptyToNull(input.department),
          skills: emptyToNull(input.skills),
          isActive: input.isActive,
          userId: userIdValue,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      return inserted[0] as unknown as Operator;
    }),
  );
}

/**
 * The Excel importer's whole sheet in ONE transaction — ERPNext Data Import
 * behaviour, the same contract Item / Vendor / Customer already answer
 * (shared/schemas/master-import.ts):
 *   - mode 'insert' creates new operators (name must be free; the OP-###
 *     series is continued in memory); mode 'update' finds each row's operator
 *     by Code and writes only the FILLED cells, one History (EDIT) row each;
 *   - EVERY row is parsed on its own — a bad row is skipped with its reason and
 *     the rest go in, so one bad cell no longer rejects the sheet;
 *   - dryRun = the preview: the same per-row answer, nothing written at all.
 *
 * Operator was the last master still writing immediately, insert-only, with no
 * preview — so a retry after a timeout could create the whole sheet a second
 * time. The preview + the code/name duplicate checks below are what close that.
 *
 * Speed (why one request exists at all): the importer used to POST once per row
 * and every answer invalidated the on-screen list, so the browser re-downloaded
 * the whole master after every row — measured on the live vendors import (same
 * code shape) at about one row per second, nine minutes for 500 rows. The
 * per-row work is done ONCE here: one access check, one transaction, one read of
 * the whole master, the series continued in memory, one multi-row INSERT.
 */
export async function createOperatorsBulk(
  input: BulkCreateOperatorsInput,
  user: AuthContext,
): Promise<BulkCreateOperatorsResponse> {
  const mode = input.mode ?? 'insert';
  const dryRun = input.dryRun ?? false;
  // Insert raises operators (`entry`); Update Existing changes ones already
  // saved, which is `edit` — so an L2 Data-Entry user can still import new
  // operators but cannot overwrite the saved master. This used to be hard-coded
  // to 'entry' for the whole route.
  await requireFormAccess(user, 'operator_create', mode === 'update' ? 'edit' : 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // One read of what already exists, rather than a duplicate-check per row.
    // Deleted rows are included on purpose: their CODE is still taken (the
    // single create refuses to reuse it), so the series must skip past them.
    const existingRows = await tx
      .select()
      .from(operators)
      .where(eq(operators.companyId, companyId));

    const takenCodes = new Set(existingRows.map((r) => r.code.trim().toLowerCase()));
    const liveByCode = new Map(
      existingRows.filter((r) => !r.deletedAt).map((r) => [r.code.trim().toLowerCase(), r]),
    );
    const trashCodes = new Set(
      existingRows.filter((r) => r.deletedAt).map((r) => r.code.trim().toLowerCase()),
    );
    // SECOND DE-DUP KEY: the operator NAME, case-insensitive → the code that
    // owns it. The import screen already guarded on the name, and it is the only
    // key an operator sheet without a Code column has to recognise a re-run of
    // the same file by. Checking it here compares each row against every
    // operator in the company; the screen could only compare against the page it
    // had loaded, so anything past that page read as "new" and got created a
    // second time. Live rows only — a deleted operator's name is free again.
    const nameOwner = new Map(
      existingRows
        .filter((r) => !r.deletedAt)
        .map((r) => [r.name.trim().toLowerCase(), r.code.trim().toLowerCase()]),
    );

    // Continue the OP-### series in memory. nextOperatorCode() scans the table
    // for the highest code; doing that per row is one query per operator.
    let nextSeq = 0;
    for (const r of existingRows) {
      const m = /^OP-(\d+)$/i.exec(r.code.trim());
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const rows: MasterImportRowResult[] = [];
    const inserts: Array<typeof operators.$inferInsert> = [];
    const codes: string[] = [];
    const updates: Array<{
      before: OperatorRow;
      set: Record<string, unknown>;
      changes: ReturnType<typeof diffFields>;
    }> = [];
    const seenCodes = new Set<string>();

    for (const [i, raw] of input.operators.entries()) {
      const index = i + 1;
      const rawName = rawRowText(raw, 'name');
      const rawCode = rawRowText(raw, 'code') || null;
      const skip = (reason: string, code: string | null = rawCode, name = rawName): void => {
        rows.push({ index, code, name, action: 'skip', reason });
      };
      // Blank cells are dropped in BOTH modes, not just Update Existing (where
      // blank means "keep the current value"). Operator's Code column is
      // optional — a blank Code must mean "auto-generate the next OP-###", and
      // an empty string would otherwise fail the schema and lose the row.
      const cells = dropBlankCells(raw);

      if (mode === 'insert') {
        const parsed = createOperatorInputSchema.safeParse(cells);
        if (!parsed.success) {
          skip(zodRowReason(parsed.error, OPERATOR_IMPORT_LABELS));
          continue;
        }
        const c = parsed.data;
        const name = c.name.trim();
        const nameKey = name.toLowerCase();
        if (nameOwner.has(nameKey)) {
          skip('an operator with this name already exists', c.code ?? null, name);
          continue;
        }
        let code = c.code?.trim();
        if (code) {
          if (takenCodes.has(code.toLowerCase())) {
            skip(
              trashCodes.has(code.toLowerCase())
                ? `Code "${code}" belongs to a deleted operator — restore it instead of re-creating`
                : `Code "${code}" is already used`,
              code,
              name,
            );
            continue;
          }
        } else {
          // Defensive loop: a company holding a hand-typed OP-007 beside the
          // series could collide, so walk forward until the code is free.
          do {
            nextSeq += 1;
            code = `OP-${String(nextSeq).padStart(3, '0')}`;
          } while (takenCodes.has(code.toLowerCase()));
        }
        // Claim both keys so a duplicate INSIDE the sheet is caught too, not
        // just one against what was already stored.
        takenCodes.add(code.toLowerCase());
        nameOwner.set(nameKey, code.toLowerCase());
        inserts.push({
          companyId,
          code,
          name,
          department: emptyToNull(c.department),
          skills: emptyToNull(c.skills),
          isActive: c.isActive,
          // Same rule as the single create: an empty string is "no login
          // linked", not a bad UUID. The import template has no Linked User
          // column, so this is null for every imported row — carried anyway so
          // an API caller that does send it behaves like POST /operators.
          userId: c.userId && c.userId.length > 0 ? c.userId : null,
          createdBy: user.id,
          updatedBy: user.id,
        });
        codes.push(code);
        rows.push({ index, code, name, action: 'insert' });
        continue;
      }

      // ── Update Existing (matched by Code) ──
      const parsed = updateOperatorImportRowSchema.safeParse(cells);
      if (!parsed.success) {
        skip(zodRowReason(parsed.error, OPERATOR_IMPORT_LABELS));
        continue;
      }
      const { code: codeIn, ...patch } = parsed.data;
      const key = codeIn.toLowerCase();
      if (seenCodes.has(key)) {
        skip(`Code "${codeIn}" is repeated in the sheet`);
        continue;
      }
      seenCodes.add(key);
      const before = liveByCode.get(key);
      if (!before) {
        // Never create in update mode — a code that matches nothing is skipped.
        skip(
          trashCodes.has(key)
            ? `Operator ${codeIn} is deleted — restore it first`
            : `No operator with Code "${codeIn}"`,
        );
        continue;
      }
      if (patch.name !== undefined) {
        const owner = nameOwner.get(patch.name.trim().toLowerCase());
        if (owner && owner !== key) {
          skip(
            `another operator is already named "${patch.name.trim()}"`,
            before.code,
            before.name,
          );
          continue;
        }
      }
      // Only the keys the row actually filled reach `set`, so a blank cell
      // keeps the stored value.
      const set: Record<string, unknown> = {};
      if (patch.name !== undefined) set.name = patch.name.trim();
      if (patch.department !== undefined) set.department = emptyToNull(patch.department);
      if (patch.skills !== undefined) set.skills = emptyToNull(patch.skills);
      if (patch.isActive !== undefined) set.isActive = patch.isActive;
      if (patch.userId !== undefined) {
        set.userId = patch.userId && patch.userId.length > 0 ? patch.userId : null;
      }
      const changes = diffFields(before, set, OPERATOR_FIELDS);
      if (patch.name !== undefined) {
        nameOwner.delete(before.name.trim().toLowerCase());
        nameOwner.set(patch.name.trim().toLowerCase(), key);
      }
      // A row whose filled cells all match what is stored changes nothing — it
      // is reported as an update of 0 fields and not written.
      if (changes.length > 0) updates.push({ before, set, changes });
      rows.push({
        index,
        code: before.code,
        name: patch.name?.trim() ?? before.name,
        action: 'update',
        changedFields: changes.length,
      });
    }

    if (!dryRun) {
      // Chunked: one INSERT carries one parameter per column per row and
      // Postgres caps a statement at 65535.
      const CHUNK = 500;
      for (let i = 0; i < inserts.length; i += CHUNK) {
        await tx.insert(operators).values(inserts.slice(i, i + CHUNK));
      }
      if (inserts.length > 0) {
        // One line for the whole insert, as the Item / Vendor imports do.
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Create,
            entity: 'Operator',
            detail: `Excel import — ${inserts.length} operator(s): ${codes[0]}…${codes[codes.length - 1]}`,
          },
          companyId,
          user,
        );
      }
      // Update Existing: one History row per operator, Before → After (ADR-197).
      for (const u of updates) {
        await tx
          .update(operators)
          .set({ ...u.set, updatedBy: user.id })
          .where(eq(operators.id, u.before.id));
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Edit,
            entity: 'Operator',
            entityId: u.before.id,
            refId: u.before.code,
            changes: u.changes,
            detail: `Excel import (update) — ${u.before.code} — ${u.before.name}`,
          },
          companyId,
          user,
        );
      }
    }

    const skipped: BulkOperatorSkip[] = rows
      .filter((r) => r.action === 'skip')
      .map((r) => ({ index: r.index, name: r.name, reason: r.reason ?? '' }));
    return {
      dryRun,
      mode,
      created: inserts.length,
      updated: rows.filter((r) => r.action === 'update').length,
      rows,
      skipped,
      codes,
    };
  });
}

export async function updateOperator(
  id: string,
  input: UpdateOperatorInput,
  user: AuthContext,
): Promise<Operator> {
  // Changing a saved operator is `edit`, so L2 (create-only) is correctly refused.
  // Checked HERE, not in the tx body, so the edit-approval engine's applyEdit can
  // replay an approved edit for an approver who holds `approve` but not `edit`.
  await requireFormAccess(user, 'operator_create', 'edit');
  return withUserContext(user, (tx) => updateOperatorTx(tx, id, input, user));
}

/**
 * The body of an Operator edit, inside a caller-supplied transaction. Called by
 * updateOperator (which opens the tx) and by the edit-approval engine's applyEdit
 * (which already holds one, with the row locked FOR UPDATE). Concurrency is the
 * engine's — this master carries no `expectedUpdatedAt` token. The caller
 * performs the edit / approve access check.
 */
export async function updateOperatorTx(
  tx: DbTransaction,
  id: string,
  input: UpdateOperatorInput,
  user: AuthContext,
): Promise<Operator> {
  requireCompany(user);
  const existing = await tx
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, id), isNull(operators.deletedAt)))
    .limit(1);
  if (existing.length === 0) throw new NotFoundError('Operator not found. Refresh the page.');

  const updates: Record<string, unknown> = { updatedBy: user.id };
  if (input.name !== undefined) updates.name = input.name;
  if (input.department !== undefined) updates.department = emptyToNull(input.department);
  if (input.skills !== undefined) updates.skills = emptyToNull(input.skills);
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.userId !== undefined) {
    updates.userId = input.userId && input.userId.length > 0 ? input.userId : null;
  }

  const updated = await tx.update(operators).set(updates).where(eq(operators.id, id)).returning();
  return updated[0] as unknown as Operator;
}

/**
 * The Operator edit entry point the HTTP route calls. Edit-approval (ADR-202):
 * when the company gate is on and the operator is still editable (a master is
 * editable while it is not in Trash), the edit is STAGED for approval; otherwise
 * it falls through to updateOperator. An operator is a single record with no
 * child lines — there is no line guard, and no updatedAt token (the engine's row
 * lock guards concurrency).
 */
export async function updateOperatorOrStage(
  id: string,
  input: UpdateOperatorInput,
  user: AuthContext,
): Promise<Operator | DocumentEditStagedResult> {
  await requireFormAccess(user, 'operator_create', 'edit');
  const companyId = requireCompany(user);

  // Imported dynamically to avoid a static import cycle with operator-edit-registry
  // (which imports updateOperatorTx from this file).
  const { isDocEditApprovalOn, requestDocumentEdit } = await import('../document-edits/service');
  const shouldStage = await withUserContext(user, async (tx) => {
    if (!(await isDocEditApprovalOn(tx, companyId))) return false;
    // "Editable" mirrors operatorEditRegistryEntry.isLive: any live row.
    const rows = await tx
      .select({ id: operators.id })
      .from(operators)
      .where(
        and(eq(operators.id, id), eq(operators.companyId, companyId), isNull(operators.deletedAt)),
      )
      .limit(1);
    return rows.length > 0;
  });
  if (shouldStage) {
    const request = await requestDocumentEdit('Operator', id, input, undefined, user);
    return { staged: true, request };
  }

  return updateOperator(id, input, user);
}

export async function softDeleteOperator(id: string, user: AuthContext): Promise<{ ok: true }> {
  // Delete = the edit+approve pair only L5 Department Admin and above hold.
  await requireFormAccess(user, 'operator_create', 'edit');
  await requireFormAccess(user, 'operator_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: operators.id, code: operators.code })
      .from(operators)
      .where(and(eq(operators.id, id), isNull(operators.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError('Operator not found. Refresh the page.');
    await tx
      .update(operators)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(eq(operators.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'Operator',
        entityId: id,
        refId: existing[0]?.code ?? null,
        detail: `Deleted Operator ${existing[0]?.code ?? id}`,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
