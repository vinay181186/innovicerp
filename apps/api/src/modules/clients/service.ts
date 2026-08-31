import { and, asc, count, desc, eq, ilike, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { clients } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  BulkClientSkip,
  BulkCreateClientsInput,
  BulkCreateClientsResponse,
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

    const dir = input.sortDir === 'desc' ? desc : asc;
    const sortCol = input.sortBy === 'name' ? clients.name : clients.code;
    const orderBy = dir(sortCol);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(clients)
        .where(where)
        .orderBy(orderBy)
        .limit(input.limit)
        .offset(input.offset),
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

/** Next CLI-### code in the company series. Server-authoritative so client
 *  codes auto-generate instead of being typed manually (bug 5.1). */
async function nextClientCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: clients.code })
    .from(clients)
    .where(and(eq(clients.companyId, companyId), like(clients.code, 'CLI-%')))
    .orderBy(sql`length(${clients.code}) desc`, sql`${clients.code} desc`)
    .limit(1);
  const last = rows[0]?.code ?? null;
  let next = 1;
  if (last) {
    const m = last.match(/^CLI-(\d+)$/i);
    if (m) next = Number(m[1]) + 1;
  }
  return `CLI-${String(next).padStart(3, '0')}`;
}

/** Preview the next CLI-### for the create form, so the auto-generated code is
 *  visible before save. Reuses the same generator the insert path uses, so the
 *  previewed number matches what createClient assigns. */
export async function getNextClientCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextClientCode(tx, companyId) }));
}

export async function createClient(input: CreateClientInput, user: AuthContext): Promise<Client> {
  requireWriteRole(user);
  await requireFormAccess(user, 'client_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on clients_company_code_uniq (23505) — e.g. both auto-generate the
  // same CLI-### — so the loser retries with the next code instead of 500ing.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const code = input.code?.trim() || (await nextClientCode(tx, companyId));
      const existing = await tx
        .select({ id: clients.id, deletedAt: clients.deletedAt })
        .from(clients)
        .where(and(eq(clients.companyId, companyId), eq(clients.code, code)))
        .limit(1);
      const dup = existing[0];
      if (dup) {
        if (dup.deletedAt) {
          throw new ConflictError(
            `Client code "${code}" belongs to a deleted client — restore it instead of re-creating`,
          );
        }
        throw new ConflictError(`Client code "${code}" already exists`);
      }

      const inserted = await tx
        .insert(clients)
        .values({
          companyId,
          code,
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
    }),
  );
}

/**
 * Create many clients in ONE transaction — the Excel importer's whole sheet.
 *
 * Why this exists: the importer used to call createClient once per row and wait
 * for each round trip, and every success invalidated the on-screen client list,
 * so the browser re-downloaded the whole master after every row. Measured on the
 * live system, the identical vendor import ran at ~1 row/second and got slower
 * as the list grew — nine minutes for a 500-row sheet.
 *
 * What makes this fast is not batching the HTTP call alone — it is doing the
 * per-row work ONCE:
 *   - one access check, one transaction, one RLS context set;
 *   - existing codes and names read in a single query instead of two per row;
 *   - the CLI-### series continued in memory instead of re-scanning the table
 *     for every row;
 *   - one multi-row INSERT instead of N.
 *
 * Tolerant, not all-or-nothing: a bad row is reported and left out, the rest go
 * in. A sheet with one duplicate should not cost the operator the other 499.
 */
export async function createClientsBulk(
  input: BulkCreateClientsInput,
  user: AuthContext,
): Promise<BulkCreateClientsResponse> {
  // Same gate as a single create — this raises clients, so it is `entry`.
  requireWriteRole(user);
  await requireFormAccess(user, 'client_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // One read of what already exists, rather than a duplicate-check per row.
    // Deleted rows are included on purpose: their CODE is still taken (the
    // single create refuses to reuse it), so the series must skip past them.
    const existingRows = await tx
      .select({ code: clients.code, name: clients.name, deletedAt: clients.deletedAt })
      .from(clients)
      .where(eq(clients.companyId, companyId));

    const takenCodes = new Set(existingRows.map((r) => r.code.trim().toLowerCase()));
    // NAME is the de-duplication key the Client Master importer has always used
    // — the template carries no Code column, so a re-run of the same file has
    // nothing else to match on. Kept exactly as it was, only moved here: on the
    // page it compared against the clients loaded on screen, so anything past
    // that page read as "new" and got created a second time. Here it compares
    // against the whole company. Live rows only — a deleted client's name is
    // free to use again.
    const takenNames = new Set(
      existingRows.filter((r) => !r.deletedAt).map((r) => r.name.trim().toLowerCase()),
    );

    // Continue the CLI-### series in memory. nextClientCode() scans the table
    // for the highest code; doing that per row is one query per client.
    let nextSeq = 0;
    for (const r of existingRows) {
      const m = /^CLI-(\d+)$/i.exec(r.code.trim());
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const skipped: BulkClientSkip[] = [];
    const values: Array<typeof clients.$inferInsert> = [];
    const codes: string[] = [];

    for (const [i, c] of input.clients.entries()) {
      const index = i + 1;
      const name = c.name.trim();
      const nameKey = name.toLowerCase();
      if (takenNames.has(nameKey)) {
        skipped.push({ index, name, reason: 'a client with this name already exists' });
        continue;
      }

      let code = c.code?.trim();
      if (code) {
        if (takenCodes.has(code.toLowerCase())) {
          skipped.push({ index, name, reason: `code "${code}" is already used` });
          continue;
        }
      } else {
        nextSeq += 1;
        code = `CLI-${String(nextSeq).padStart(3, '0')}`;
        // Defensive: a company holding a hand-typed CLI-007 alongside the series
        // could collide. Walk forward until the code is free.
        while (takenCodes.has(code.toLowerCase())) {
          nextSeq += 1;
          code = `CLI-${String(nextSeq).padStart(3, '0')}`;
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
        contactPerson: emptyToNull(c.contactPerson),
        email: emptyToNull(c.email),
        phone: emptyToNull(c.phone),
        gstNumber: emptyToNull(c.gstNumber),
        addressLine1: emptyToNull(c.addressLine1),
        city: emptyToNull(c.city),
        state: emptyToNull(c.state),
        pincode: emptyToNull(c.pincode),
        isActive: c.isActive,
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
        await tx.insert(clients).values(values.slice(i, i + CHUNK));
      }
    }

    return { created: values.length, skipped, codes };
  });
}

export async function updateClient(
  id: string,
  input: UpdateClientInput,
  user: AuthContext,
): Promise<Client> {
  requireWriteRole(user);
  await requireFormAccess(user, 'client_create', 'edit');
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

    const updated = await tx.update(clients).set(updates).where(eq(clients.id, id)).returning();
    return updated[0] as unknown as Client;
  });
}

export async function softDeleteClient(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  await requireFormAccess(user, 'client_create', 'edit');
  await requireFormAccess(user, 'client_create', 'approve');
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
