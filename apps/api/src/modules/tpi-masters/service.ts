import { and, asc, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { tpiMasters } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  CreateTpiMasterInput,
  ListTpiMastersQuery,
  ListTpiMastersResponse,
  TpiMaster,
  UpdateTpiMasterInput,
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

// Named column list rather than a bare select(): house rule 6 forbids SELECT *,
// and spelling the columns out means a column added to tpi_masters later cannot
// silently start travelling to the browser.
const tpiMasterColumns = {
  id: tpiMasters.id,
  companyId: tpiMasters.companyId,
  code: tpiMasters.code,
  organization: tpiMasters.organization,
  contactNo: tpiMasters.contactNo,
  email: tpiMasters.email,
  remarks: tpiMasters.remarks,
  isActive: tpiMasters.isActive,
  createdAt: tpiMasters.createdAt,
  createdBy: tpiMasters.createdBy,
  updatedAt: tpiMasters.updatedAt,
  updatedBy: tpiMasters.updatedBy,
  deletedAt: tpiMasters.deletedAt,
};

export async function listTpiMasters(
  input: ListTpiMastersQuery,
  user: AuthContext,
): Promise<ListTpiMastersResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(tpiMasters.companyId, companyId), isNull(tpiMasters.deletedAt)];
    if (input.search) {
      // Both halves of the picker label are searchable: users look an inspector
      // up by person ("Sharma") as often as by the firm they inspect for.
      const s = or(
        ilike(tpiMasters.code, `%${input.search}%`),
        ilike(tpiMasters.organization, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (input.isActive !== undefined) conditions.push(eq(tpiMasters.isActive, input.isActive));

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select(tpiMasterColumns)
        .from(tpiMasters)
        .where(where)
        .orderBy(asc(tpiMasters.code))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(tpiMasters).where(where),
    ]);

    return {
      items: rows as unknown as TpiMaster[],
      total: totals[0]?.value ?? 0,
    };
  });
}

export async function getTpiMaster(id: string, user: AuthContext): Promise<TpiMaster> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select(tpiMasterColumns)
      .from(tpiMasters)
      .where(and(eq(tpiMasters.id, id), isNull(tpiMasters.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`TPI inspector ${id} not found`);
    return row as unknown as TpiMaster;
  });
}

export async function createTpiMaster(
  input: CreateTpiMasterInput,
  user: AuthContext,
): Promise<TpiMaster> {
  // Creating a master record is `entry`, so L2 Data Entry and above in QC.
  await requireFormAccess(user, 'tpimaster_create', 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Checked up front so a repeated name comes back as a sentence the shop
    // floor can act on. The unique index stays the real guard — two
    // simultaneous creates raise 23505, which the error handler maps to 409.
    const existing = await tx
      .select({ id: tpiMasters.id })
      .from(tpiMasters)
      .where(
        and(
          eq(tpiMasters.companyId, companyId),
          eq(tpiMasters.code, input.code),
          isNull(tpiMasters.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`An inspector named "${input.code}" already exists`);
    }

    const inserted = await tx
      .insert(tpiMasters)
      .values({
        companyId,
        code: input.code.trim(),
        organization: emptyToNull(input.organization),
        contactNo: emptyToNull(input.contactNo),
        // The shared schema lets email through as '' (the box is optional on
        // the form). Blank is stored as null so "no email" reads the same way
        // whether the box was skipped or cleared.
        email: emptyToNull(input.email),
        remarks: emptyToNull(input.remarks),
        isActive: input.isActive,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning(tpiMasterColumns);
    return inserted[0] as unknown as TpiMaster;
  });
}

export async function updateTpiMaster(
  id: string,
  input: UpdateTpiMasterInput,
  user: AuthContext,
): Promise<TpiMaster> {
  // Changing a saved record is `edit`, which L2 Data Entry deliberately does
  // not have — it may create, not alter.
  await requireFormAccess(user, 'tpimaster_create', 'edit');
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: tpiMasters.id })
      .from(tpiMasters)
      .where(and(eq(tpiMasters.id, id), isNull(tpiMasters.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`TPI inspector ${id} not found`);

    // `code` is absent from UpdateTpiMasterInput and is never written here: the
    // TPI logs already signed off under that name have to keep agreeing with
    // the master. An inspector is retired with isActive, not renamed.
    const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
    if (input.organization !== undefined) updates.organization = emptyToNull(input.organization);
    if (input.contactNo !== undefined) updates.contactNo = emptyToNull(input.contactNo);
    if (input.email !== undefined) updates.email = emptyToNull(input.email);
    if (input.remarks !== undefined) updates.remarks = emptyToNull(input.remarks);
    if (input.isActive !== undefined) updates.isActive = input.isActive;

    const updated = await tx
      .update(tpiMasters)
      .set(updates)
      .where(eq(tpiMasters.id, id))
      .returning(tpiMasterColumns);
    return updated[0] as unknown as TpiMaster;
  });
}

export async function softDeleteTpiMaster(id: string, user: AuthContext): Promise<{ ok: true }> {
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // that only L5 Department Admin and above hold: edit AND approve. L3 Editor
  // has edit but not approve; L4 Approver has approve but not edit.
  await requireFormAccess(user, 'tpimaster_create', 'edit');
  await requireFormAccess(user, 'tpimaster_create', 'approve');
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: tpiMasters.id })
      .from(tpiMasters)
      .where(and(eq(tpiMasters.id, id), isNull(tpiMasters.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`TPI inspector ${id} not found`);

    // Soft delete only. A TPI log stores the inspector's name as text, so
    // removing the master row never rewrites an inspection already signed off —
    // it only takes the name out of the pickers.
    await tx
      .update(tpiMasters)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(tpiMasters.id, id));
    return { ok: true };
  });
}
