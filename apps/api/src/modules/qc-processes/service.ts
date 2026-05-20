import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { qcProcesses } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  CreateQcProcessInput,
  ListQcProcessesQuery,
  ListQcProcessesResponse,
  QcProcess,
  UpdateQcProcessInput,
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

export async function listQcProcesses(
  input: ListQcProcessesQuery,
  user: AuthContext,
): Promise<ListQcProcessesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(qcProcesses.companyId, companyId), isNull(qcProcesses.deletedAt)];
    if (input.search) {
      const s = or(
        ilike(qcProcesses.code, `%${input.search}%`),
        ilike(qcProcesses.description, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (input.isActive !== undefined) conditions.push(eq(qcProcesses.isActive, input.isActive));

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(qcProcesses)
        .where(where)
        .orderBy(asc(qcProcesses.code))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(qcProcesses).where(where),
    ]);

    return {
      items: rows as unknown as QcProcess[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getQcProcess(id: string, user: AuthContext): Promise<QcProcess> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(qcProcesses)
      .where(and(eq(qcProcesses.id, id), isNull(qcProcesses.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`QC process ${id} not found`);
    return row as unknown as QcProcess;
  });
}

export async function createQcProcess(
  input: CreateQcProcessInput,
  user: AuthContext,
): Promise<QcProcess> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: qcProcesses.id })
      .from(qcProcesses)
      .where(
        and(
          eq(qcProcesses.companyId, companyId),
          eq(qcProcesses.code, input.code),
          isNull(qcProcesses.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`QC process "${input.code}" already exists`);
    }

    const inserted = await tx
      .insert(qcProcesses)
      .values({
        companyId,
        code: input.code.trim(),
        description: emptyToNull(input.description),
        defaultCycleTimeMin: String(input.defaultCycleTimeMin ?? 0),
        isActive: input.isActive,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return inserted[0] as unknown as QcProcess;
  });
}

export async function updateQcProcess(
  id: string,
  input: UpdateQcProcessInput,
  user: AuthContext,
): Promise<QcProcess> {
  requireWriteRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: qcProcesses.id })
      .from(qcProcesses)
      .where(and(eq(qcProcesses.id, id), isNull(qcProcesses.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`QC process ${id} not found`);

    const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
    if (input.description !== undefined) updates.description = emptyToNull(input.description);
    if (input.defaultCycleTimeMin !== undefined)
      updates.defaultCycleTimeMin = String(input.defaultCycleTimeMin);
    if (input.isActive !== undefined) updates.isActive = input.isActive;

    const updated = await tx
      .update(qcProcesses)
      .set(updates)
      .where(eq(qcProcesses.id, id))
      .returning();
    return updated[0] as unknown as QcProcess;
  });
}

export async function softDeleteQcProcess(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: qcProcesses.id })
      .from(qcProcesses)
      .where(and(eq(qcProcesses.id, id), isNull(qcProcesses.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`QC process ${id} not found`);
    await tx
      .update(qcProcesses)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(qcProcesses.id, id));
    return { ok: true };
  });
}
