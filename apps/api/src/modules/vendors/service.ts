import { and, asc, count, desc, eq, ilike, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { vendors } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  BulkCreateVendorsInput,
  BulkCreateVendorsResponse,
  BulkVendorSkip,
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
    .where(and(eq(vendors.companyId, companyId), like(vendors.code, 'VND-%')))
    .orderBy(sql`length(${vendors.code}) desc`, sql`${vendors.code} desc`)
    .limit(1);
  const last = rows[0]?.code ?? null;
  let next = 1;
  if (last) {
    const m = last.match(/^VND-(\d+)$/i);
    if (m) next = Number(m[1]) + 1;
  }
  return `VND-${String(next).padStart(3, '0')}`;
}

/** Preview the next VND-### for the create form (visible before save). Reuses
 *  the insert-path generator so the preview matches the assigned code. */
export async function getNextVendorCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextVendorCode(tx, companyId) }));
}

export async function createVendor(input: CreateVendorInput, user: AuthContext): Promise<Vendor> {
  // Tier gate (was requireWriteRole, which only knew admin/manager). L2 Data
  // Entry can add a vendor; L1 Viewer and L4 Approver cannot.
  await requireFormAccess(user, 'vendor_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on vendors_company_code_uniq (23505).
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const code = input.code?.trim() || (await nextVendorCode(tx, companyId));
      const existing = await tx
        .select({ id: vendors.id, deletedAt: vendors.deletedAt })
        .from(vendors)
        .where(and(eq(vendors.companyId, companyId), eq(vendors.code, code)))
        .limit(1);
      const dup = existing[0];
      if (dup) {
        if (dup.deletedAt) {
          throw new ConflictError(
            `Vendor code "${code}" belongs to a deleted vendor — restore it instead of re-creating`,
          );
        }
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

/**
 * Create many vendors in ONE transaction — the Excel importer's whole sheet.
 *
 * Why this exists: the importer used to call createVendor once per row and wait
 * for each round trip, and every success invalidated the on-screen vendor list,
 * so the browser re-downloaded the whole master after every row. Measured on the
 * live system, that ran at ~1 vendor/second and got slower as the list grew.
 *
 * What makes this fast is not batching the HTTP call alone — it is doing the
 * per-row work ONCE:
 *   - one access check, one transaction, one RLS context set;
 *   - existing codes and names read in a single query instead of two per row;
 *   - the VND-### series continued in memory instead of re-scanning the table
 *     for every row;
 *   - one multi-row INSERT instead of N.
 *
 * Tolerant, not all-or-nothing: a bad row is reported and left out, the rest go
 * in. A sheet with one duplicate should not cost the operator the other 499.
 */
export async function createVendorsBulk(
  input: BulkCreateVendorsInput,
  user: AuthContext,
): Promise<BulkCreateVendorsResponse> {
  // Same gate as a single create — this raises vendors, so it is `entry`.
  await requireFormAccess(user, 'vendor_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // One read of what already exists, rather than a duplicate-check per row.
    // Deleted rows are included on purpose: their CODE is still taken (the
    // single create refuses to reuse it), so the series must skip past them.
    const existingRows = await tx
      .select({ code: vendors.code, name: vendors.name, deletedAt: vendors.deletedAt })
      .from(vendors)
      .where(eq(vendors.companyId, companyId));

    const takenCodes = new Set(existingRows.map((r) => r.code.trim().toLowerCase()));
    // Name match is how the importer has always de-duplicated a re-run of the
    // same sheet (the template carries no Code column). Live rows only — a
    // deleted vendor's name is free to use again.
    const takenNames = new Set(
      existingRows.filter((r) => !r.deletedAt).map((r) => r.name.trim().toLowerCase()),
    );

    // Continue the VND-### series in memory. nextVendorCode() scans the table
    // for the highest code; doing that per row is one query per vendor.
    let nextSeq = 0;
    for (const r of existingRows) {
      const m = /^VND-(\d+)$/i.exec(r.code.trim());
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const skipped: BulkVendorSkip[] = [];
    const values: Array<typeof vendors.$inferInsert> = [];
    const codes: string[] = [];

    for (const [i, v] of input.vendors.entries()) {
      const index = i + 1;
      const name = v.name.trim();
      const nameKey = name.toLowerCase();
      if (takenNames.has(nameKey)) {
        skipped.push({ index, name, reason: 'a vendor with this name already exists' });
        continue;
      }

      let code = v.code?.trim();
      if (code) {
        if (takenCodes.has(code.toLowerCase())) {
          skipped.push({ index, name, reason: `code "${code}" is already used` });
          continue;
        }
      } else {
        nextSeq += 1;
        code = `VND-${String(nextSeq).padStart(3, '0')}`;
        // Defensive: a company holding a hand-typed VND-007 alongside the series
        // could collide. Walk forward until the code is free.
        while (takenCodes.has(code.toLowerCase())) {
          nextSeq += 1;
          code = `VND-${String(nextSeq).padStart(3, '0')}`;
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
        contactPerson: emptyToNull(v.contactPerson),
        email: emptyToNull(v.email),
        phone: emptyToNull(v.phone),
        gstNumber: emptyToNull(v.gstNumber),
        addressLine1: emptyToNull(v.addressLine1),
        city: emptyToNull(v.city),
        state: emptyToNull(v.state),
        pincode: emptyToNull(v.pincode),
        materialsSupplied: emptyToNull(v.materialsSupplied),
        rating: emptyToNull(v.rating),
        isActive: v.isActive,
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
        await tx.insert(vendors).values(values.slice(i, i + CHUNK));
      }
    }

    return { created: values.length, skipped, codes };
  });
}

export async function updateVendor(
  id: string,
  input: UpdateVendorInput,
  user: AuthContext,
): Promise<Vendor> {
  // Changing a saved record is `edit`, so L2 (create-only) is correctly refused.
  await requireFormAccess(user, 'vendor_create', 'edit');
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
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // that only L5 Department Admin and above hold: edit AND approve. L3 Editor
  // has edit but not approve; L4 Approver has approve but not edit. The screen
  // above this used to hide Delete behind admin-only, which locked out the very
  // tier meant to run the department — the owner decided L5 gets delete rights.
  await requireFormAccess(user, 'vendor_create', 'edit');
  await requireFormAccess(user, 'vendor_create', 'approve');
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
