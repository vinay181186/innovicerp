import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { costCenters } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  CostCenter,
  CreateCostCenterInput,
  ListCostCentersQuery,
  ListCostCentersResponse,
  UpdateCostCenterInput,
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

export async function listCostCenters(
  input: ListCostCentersQuery,
  user: AuthContext,
): Promise<ListCostCentersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(costCenters.companyId, companyId), isNull(costCenters.deletedAt)];
    if (input.search) {
      const s = or(
        ilike(costCenters.code, `%${input.search}%`),
        ilike(costCenters.name, `%${input.search}%`),
        ilike(costCenters.description, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (input.isActive !== undefined) conditions.push(eq(costCenters.isActive, input.isActive));
    if (input.department) conditions.push(eq(costCenters.department, input.department));
    if (input.type) conditions.push(eq(costCenters.type, input.type));

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(costCenters)
        .where(where)
        .orderBy(asc(costCenters.code))
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
    if (!row) throw new NotFoundError(`Cost center ${id} not found`);
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
      throw new ConflictError(`Cost center code "${input.code}" already exists`);
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
  await requireFormAccess(user, 'cc_create', 'edit');
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), isNull(costCenters.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Cost center ${id} not found`);

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
  });
}

export async function softDeleteCostCenter(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  // Delete is expressed as the pair only L5 Department Admin and above hold:
  // edit AND approve. L3 Editor has edit but not approve; L4 Approver the reverse.
  await requireFormAccess(user, 'cc_create', 'edit');
  await requireFormAccess(user, 'cc_create', 'approve');
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), isNull(costCenters.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Cost center ${id} not found`);
    await tx
      .update(costCenters)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(costCenters.id, id));
    return { ok: true };
  });
}
