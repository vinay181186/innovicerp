import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { machines } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  CreateMachineInput,
  ListMachinesQuery,
  ListMachinesResponse,
  Machine,
  UpdateMachineInput,
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

export async function listMachines(
  input: ListMachinesQuery,
  user: AuthContext,
): Promise<ListMachinesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(machines.companyId, companyId), isNull(machines.deletedAt)];
    if (input.search) {
      const s = or(
        ilike(machines.code, `%${input.search}%`),
        ilike(machines.name, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (input.status) conditions.push(eq(machines.status, input.status));

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx.select().from(machines).where(where).orderBy(asc(machines.code)).limit(input.limit).offset(
        input.offset,
      ),
      tx.select({ value: count() }).from(machines).where(where),
    ]);

    return {
      machines: rows as unknown as Machine[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getMachine(id: string, user: AuthContext): Promise<Machine> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(machines)
      .where(and(eq(machines.id, id), isNull(machines.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`Machine ${id} not found`);
    return row as unknown as Machine;
  });
}

export async function createMachine(
  input: CreateMachineInput,
  user: AuthContext,
): Promise<Machine> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(
        and(
          eq(machines.companyId, companyId),
          eq(machines.code, input.code),
          isNull(machines.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`Machine code "${input.code}" already exists`);
    }

    const inserted = await tx
      .insert(machines)
      .values({
        companyId,
        code: input.code,
        name: input.name,
        machineType: emptyToNull(input.machineType),
        capacityPerShift: input.capacityPerShift ?? null,
        shiftsPerDay: input.shiftsPerDay,
        status: input.status,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return inserted[0] as unknown as Machine;
  });
}

export async function updateMachine(
  id: string,
  input: UpdateMachineInput,
  user: AuthContext,
): Promise<Machine> {
  requireWriteRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.id, id), isNull(machines.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Machine ${id} not found`);

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.name !== undefined) updates.name = input.name;
    if (input.machineType !== undefined) updates.machineType = emptyToNull(input.machineType);
    if (input.capacityPerShift !== undefined)
      updates.capacityPerShift = input.capacityPerShift ?? null;
    if (input.shiftsPerDay !== undefined) updates.shiftsPerDay = input.shiftsPerDay;
    if (input.status !== undefined) updates.status = input.status;

    const updated = await tx
      .update(machines)
      .set(updates)
      .where(eq(machines.id, id))
      .returning();
    return updated[0] as unknown as Machine;
  });
}

export async function softDeleteMachine(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(and(eq(machines.id, id), isNull(machines.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Machine ${id} not found`);
    await tx
      .update(machines)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(machines.id, id));
    return { ok: true };
  });
}
