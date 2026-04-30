import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { clients } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  Client,
  CreateClientInput,
  ListClientsQuery,
  ListClientsResponse,
  UpdateClientInput,
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

export async function listClients(
  input: ListClientsQuery,
  user: AuthContext,
): Promise<ListClientsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(clients.companyId, companyId), isNull(clients.deletedAt)];
    if (input.search) {
      const s = or(
        ilike(clients.code, `%${input.search}%`),
        ilike(clients.name, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (typeof input.isActive === 'boolean') {
      conditions.push(eq(clients.isActive, input.isActive));
    }

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx.select().from(clients).where(where).orderBy(asc(clients.code)).limit(input.limit).offset(
        input.offset,
      ),
      tx.select({ value: count() }).from(clients).where(where),
    ]);

    return {
      clients: rows as unknown as Client[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getClient(id: string, user: AuthContext): Promise<Client> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`Client ${id} not found`);
    return row as unknown as Client;
  });
}

export async function createClient(
  input: CreateClientInput,
  user: AuthContext,
): Promise<Client> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(eq(clients.companyId, companyId), eq(clients.code, input.code), isNull(clients.deletedAt)),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`Client code "${input.code}" already exists`);
    }

    const inserted = await tx
      .insert(clients)
      .values({
        companyId,
        code: input.code,
        name: input.name,
        contactPerson: emptyToNull(input.contactPerson),
        email: emptyToNull(input.email),
        phone: emptyToNull(input.phone),
        gstNumber: emptyToNull(input.gstNumber),
        addressLine1: emptyToNull(input.addressLine1),
        city: emptyToNull(input.city),
        state: emptyToNull(input.state),
        pincode: emptyToNull(input.pincode),
        isActive: input.isActive,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return inserted[0] as unknown as Client;
  });
}

export async function updateClient(
  id: string,
  input: UpdateClientInput,
  user: AuthContext,
): Promise<Client> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Client ${id} not found`);

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.name !== undefined) updates.name = input.name;
    if (input.contactPerson !== undefined) updates.contactPerson = emptyToNull(input.contactPerson);
    if (input.email !== undefined) updates.email = emptyToNull(input.email);
    if (input.phone !== undefined) updates.phone = emptyToNull(input.phone);
    if (input.gstNumber !== undefined) updates.gstNumber = emptyToNull(input.gstNumber);
    if (input.addressLine1 !== undefined) updates.addressLine1 = emptyToNull(input.addressLine1);
    if (input.city !== undefined) updates.city = emptyToNull(input.city);
    if (input.state !== undefined) updates.state = emptyToNull(input.state);
    if (input.pincode !== undefined) updates.pincode = emptyToNull(input.pincode);
    if (input.isActive !== undefined) updates.isActive = input.isActive;

    const updated = await tx
      .update(clients)
      .set(updates)
      .where(eq(clients.id, id))
      .returning();
    return updated[0] as unknown as Client;
  });
}

export async function softDeleteClient(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Client ${id} not found`);
    await tx
      .update(clients)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(clients.id, id));
    return { ok: true };
  });
}
