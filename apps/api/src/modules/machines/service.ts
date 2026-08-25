import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { machines } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice, requireFormAccess } from '../../lib/access';
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

// numeric columns come back as strings from postgres.js — coerce hour_rate.
function toMachine(row: unknown): Machine {
  const r = row as { hourRate: string | number };
  return { ...(row as object), hourRate: Number(r.hourRate) || 0 } as Machine;
}

// Money-hiding for L1 Viewers ("Can See Price"). The machine's only money is
// its ₹/hr rate, nulled for price-restricted viewers.
function hideMachineMoney(m: Machine): Machine {
  return { ...m, hourRate: null };
}

export async function listMachines(
  input: ListMachinesQuery,
  user: AuthContext,
): Promise<ListMachinesResponse> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'machine_create');
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
      tx
        .select()
        .from(machines)
        .where(where)
        .orderBy(asc(machines.code))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(machines).where(where),
    ]);

    const mapped = rows.map(toMachine);
    return {
      machines: showMoney ? mapped : mapped.map(hideMachineMoney),
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getMachine(id: string, user: AuthContext): Promise<Machine> {
  requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'machine_create');
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(machines)
      .where(and(eq(machines.id, id), isNull(machines.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`Machine ${id} not found`);
    const m = toMachine(row);
    return showMoney ? m : hideMachineMoney(m);
  });
}

export async function createMachine(
  input: CreateMachineInput,
  user: AuthContext,
): Promise<Machine> {
  // Tier gate (was requireWriteRole, which only knew admin/manager). L2 Data
  // Entry can add a machine; L1 Viewer and L4 Approver cannot.
  await requireFormAccess(user, 'machine_create', 'entry');
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
        hourRate: String(input.hourRate ?? 0),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    // list/get already mask this; the create response did not, so a
    // price-restricted creator got the rate echoed straight back.
    const created = toMachine(inserted[0]);
    const showMoney = await canSeeFormPrice(user, 'machine_create');
    return showMoney ? created : hideMachineMoney(created);
  });
}

export async function updateMachine(
  id: string,
  input: UpdateMachineInput,
  user: AuthContext,
): Promise<Machine> {
  // Changing a saved record is `edit`, so L2 (create-only) is correctly refused.
  await requireFormAccess(user, 'machine_create', 'edit');
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
    // Money in, same rule as money out: a caller who cannot SEE the hour rate
    // cannot SET it either — their payload's hourRate is ignored and the stored
    // value stands. `priceOff` exists precisely to make "can do the job but must
    // not see the number" a supported setup, so an L3 editor with prices hidden
    // is a real user. Without this their save wrote whatever their blinded form
    // posted back over a rate they were never shown.
    if (input.hourRate !== undefined && (await canSeeFormPrice(user, 'machine_create'))) {
      updates.hourRate = String(input.hourRate);
    }

    const updated = await tx.update(machines).set(updates).where(eq(machines.id, id)).returning();
    return toMachine(updated[0]);
  });
}

export async function softDeleteMachine(id: string, user: AuthContext): Promise<{ ok: true }> {
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // that only L5 Department Admin and above hold: edit AND approve. L3 Editor
  // has edit but not approve; L4 Approver has approve but not edit. Previously
  // this was admin-only, which locked out the very tier meant to run the dept.
  await requireFormAccess(user, 'machine_create', 'edit');
  await requireFormAccess(user, 'machine_create', 'approve');
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
