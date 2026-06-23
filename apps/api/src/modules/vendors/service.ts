import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { vendors } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  CreateVendorInput,
  ListVendorsQuery,
  ListVendorsResponse,
  UpdateVendorInput,
  Vendor,
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

export async function listVendors(
  input: ListVendorsQuery,
  user: AuthContext,
): Promise<ListVendorsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(vendors.companyId, companyId), isNull(vendors.deletedAt)];
    if (input.search) {
      const s = or(
        ilike(vendors.code, `%${input.search}%`),
        ilike(vendors.name, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (typeof input.isActive === 'boolean') {
      conditions.push(eq(vendors.isActive, input.isActive));
    }

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(vendors)
        .where(where)
        .orderBy(
          (input.sortDir === 'desc' ? desc : asc)(
            input.sortBy === 'name' ? vendors.name : vendors.code,
          ),
        )
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(vendors).where(where),
    ]);

    return {
      vendors: rows as unknown as Vendor[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getVendor(id: string, user: AuthContext): Promise<Vendor> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`Vendor ${id} not found`);
    return row as unknown as Vendor;
  });
}

/** Next VND-### code in the company series (legacy _nextVendorCode, 3-digit). */
async function nextVendorCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: vendors.code })
    .from(vendors)
    .where(eq(vendors.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = (r.code || '').match(/VND-(\d+)\s*$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `VND-${String(max + 1).padStart(3, '0')}`;
}

export async function createVendor(input: CreateVendorInput, user: AuthContext): Promise<Vendor> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on vendors_company_code_uniq (23505).
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const code = input.code?.trim() || (await nextVendorCode(tx, companyId));
      const existing = await tx
        .select({ id: vendors.id })
        .from(vendors)
        .where(
          and(eq(vendors.companyId, companyId), eq(vendors.code, code), isNull(vendors.deletedAt)),
        )
        .limit(1);
      if (existing.length > 0) {
        throw new ConflictError(`Vendor code "${code}" already exists`);
      }

      const inserted = await tx
        .insert(vendors)
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
          materialsSupplied: emptyToNull(input.materialsSupplied),
          rating: emptyToNull(input.rating),
          isActive: input.isActive,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      return inserted[0] as unknown as Vendor;
    }),
  );
}

export async function updateVendor(
  id: string,
  input: UpdateVendorInput,
  user: AuthContext,
): Promise<Vendor> {
  requireWriteRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Vendor ${id} not found`);

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
    if (input.materialsSupplied !== undefined)
      updates.materialsSupplied = emptyToNull(input.materialsSupplied);
    if (input.rating !== undefined) updates.rating = emptyToNull(input.rating);
    if (input.isActive !== undefined) updates.isActive = input.isActive;

    const updated = await tx.update(vendors).set(updates).where(eq(vendors.id, id)).returning();
    return updated[0] as unknown as Vendor;
  });
}

export async function softDeleteVendor(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, id), isNull(vendors.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Vendor ${id} not found`);
    await tx
      .update(vendors)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(vendors.id, id));
    return { ok: true };
  });
}
