import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { operators } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
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

export async function createOperator(
  input: CreateOperatorInput,
  user: AuthContext,
): Promise<Operator> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: operators.id })
      .from(operators)
      .where(
        and(
          eq(operators.companyId, companyId),
          eq(operators.code, input.code),
          isNull(operators.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`Operator code "${input.code}" already exists`);
    }

    const userIdValue = input.userId && input.userId.length > 0 ? input.userId : null;

    const inserted = await tx
      .insert(operators)
      .values({
        companyId,
        code: input.code,
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
  });
}

export async function updateOperator(
  id: string,
  input: UpdateOperatorInput,
  user: AuthContext,
): Promise<Operator> {
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

    const updated = await tx
      .update(operators)
      .set(updates)
      .where(eq(operators.id, id))
      .returning();
    return updated[0] as unknown as Operator;
  });
}

export async function softDeleteOperator(id: string, user: AuthContext): Promise<{ ok: true }> {
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
