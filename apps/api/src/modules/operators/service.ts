import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { operators } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
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
    .where(eq(operators.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = (r.code || '').match(/OP-(\d+)\s*$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `OP-${String(max + 1).padStart(3, '0')}`;
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
  requireWriteRole(user);
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on operators_company_code_uniq (23505) — e.g. both auto-generate the
  // same OP-### — so the loser retries with the next code instead of 500ing.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const code = input.code?.trim() || (await nextOperatorCode(tx, companyId));
      const existing = await tx
        .select({ id: operators.id })
        .from(operators)
        .where(
          and(
            eq(operators.companyId, companyId),
            eq(operators.code, code),
            isNull(operators.deletedAt),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
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

export async function updateOperator(
  id: string,
  input: UpdateOperatorInput,
  user: AuthContext,
): Promise<Operator> {
  requireWriteRole(user);
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
  requireWriteRole(user);
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
