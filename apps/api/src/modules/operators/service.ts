import { and, asc, count, eq, ilike, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { operators } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
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

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function listOperators(
  input: ListOperatorsQuery,
  user: AuthContext,
): Promise<ListOperatorsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(operators.companyId, companyId), isNull(operators.deletedAt)];
    if (input.search) {
      const s = or(
        ilike(operators.code, `%${input.search}%`),
        ilike(operators.name, `%${input.search}%`),
        ilike(operators.department, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (typeof input.isActive === 'boolean') {
      conditions.push(eq(operators.isActive, input.isActive));
    }

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(operators)
        .where(where)
        .orderBy(asc(operators.code))
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
    if (!row) throw new NotFoundError(`Operator ${id} not found`);
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
 * Create many operators in ONE transaction — the Excel importer's whole sheet.
 *
 * Why this exists: the importer used to call createOperator once per row and
 * wait for each round trip, and every success invalidated the on-screen operator
 * list, so the browser re-downloaded the whole master after every row. Measured
 * on the live vendors import (identical code shape), that ran at ~1 row/second
 * and got slower as the list grew — nine minutes for a 500-row sheet.
 *
 * What makes this fast is not batching the HTTP call alone — it is doing the
 * per-row work ONCE:
 *   - one access check, one transaction, one RLS context set;
 *   - existing codes and names read in a single query instead of two per row;
 *   - the OP-### series continued in memory instead of re-scanning the table
 *     for every row;
 *   - one multi-row INSERT instead of N.
 *
 * Tolerant, not all-or-nothing: a bad row is reported and left out, the rest go
 * in. A sheet with one duplicate should not cost the operator the other 499.
 */
export async function createOperatorsBulk(
  input: BulkCreateOperatorsInput,
  user: AuthContext,
): Promise<BulkCreateOperatorsResponse> {
  // Same gate as a single create — this raises operators, so it is `entry`.
  await requireFormAccess(user, 'operator_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // One read of what already exists, rather than a duplicate-check per row.
    // Deleted rows are included on purpose: their CODE is still taken (the
    // single create refuses to reuse it), so the series must skip past them.
    const existingRows = await tx
      .select({ code: operators.code, name: operators.name, deletedAt: operators.deletedAt })
      .from(operators)
      .where(eq(operators.companyId, companyId));

    const takenCodes = new Set(existingRows.map((r) => r.code.trim().toLowerCase()));
    // DE-DUP KEY: the operator NAME, case-insensitive. That is exactly what the
    // import screen already guarded on, and it is the only key it can use — the
    // operator template carries no Code column, so a re-run of the same file has
    // nothing else to recognise itself by. Moving the check here compares each
    // row against every operator in the company; the screen could only compare
    // against the page of operators loaded on screen, so anything past that page
    // read as "new" and got created a second time.
    // Live rows only — a deleted operator's name is free to use again.
    const takenNames = new Set(
      existingRows.filter((r) => !r.deletedAt).map((r) => r.name.trim().toLowerCase()),
    );

    // Continue the OP-### series in memory. nextOperatorCode() scans the table
    // for the highest code; doing that per row is one query per operator.
    let nextSeq = 0;
    for (const r of existingRows) {
      const m = /^OP-(\d+)$/i.exec(r.code.trim());
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const skipped: BulkOperatorSkip[] = [];
    const values: Array<typeof operators.$inferInsert> = [];
    const codes: string[] = [];

    for (const [i, o] of input.operators.entries()) {
      const index = i + 1;
      const name = o.name.trim();
      const nameKey = name.toLowerCase();
      if (takenNames.has(nameKey)) {
        skipped.push({ index, name, reason: 'an operator with this name already exists' });
        continue;
      }

      let code = o.code?.trim();
      if (code) {
        if (takenCodes.has(code.toLowerCase())) {
          skipped.push({ index, name, reason: `code "${code}" is already used` });
          continue;
        }
      } else {
        nextSeq += 1;
        code = `OP-${String(nextSeq).padStart(3, '0')}`;
        // Defensive: a company holding a hand-typed OP-007 alongside the series
        // could collide. Walk forward until the code is free.
        while (takenCodes.has(code.toLowerCase())) {
          nextSeq += 1;
          code = `OP-${String(nextSeq).padStart(3, '0')}`;
        }
      }
      // Claim both keys so a duplicate INSIDE the sheet is caught too, not just
      // one against what was already stored.
      takenCodes.add(code.toLowerCase());
      takenNames.add(nameKey);

      values.push({
        companyId,
        code,
        name,
        department: emptyToNull(o.department),
        skills: emptyToNull(o.skills),
        isActive: o.isActive,
        // Same rule as the single create: an empty string is "no login linked",
        // not a bad UUID. The import template has no userId column, so this is
        // null for every imported row — carried anyway so an API caller that
        // does send it gets the same behaviour as POST /operators.
        userId: o.userId && o.userId.length > 0 ? o.userId : null,
        createdBy: user.id,
        updatedBy: user.id,
      });
      codes.push(code);
    }

    if (values.length > 0) {
      // One statement for the lot. Chunked because a single INSERT carries one
      // parameter per column per row and Postgres caps a statement at 65535.
      const CHUNK = 500;
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(operators).values(values.slice(i, i + CHUNK));
      }
    }

    return { created: values.length, skipped, codes };
  });
}

export async function updateOperator(
  id: string,
  input: UpdateOperatorInput,
  user: AuthContext,
): Promise<Operator> {
  // Changing a saved operator is `edit`, so L2 (create-only) is correctly refused.
  await requireFormAccess(user, 'operator_create', 'edit');
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: operators.id })
      .from(operators)
      .where(and(eq(operators.id, id), isNull(operators.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Operator ${id} not found`);

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
  });
}

export async function softDeleteOperator(id: string, user: AuthContext): Promise<{ ok: true }> {
  // Delete = the edit+approve pair only L5 Department Admin and above hold.
  await requireFormAccess(user, 'operator_create', 'edit');
  await requireFormAccess(user, 'operator_create', 'approve');
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: operators.id })
      .from(operators)
      .where(and(eq(operators.id, id), isNull(operators.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Operator ${id} not found`);
    await tx
      .update(operators)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(operators.id, id));
    return { ok: true };
  });
}
