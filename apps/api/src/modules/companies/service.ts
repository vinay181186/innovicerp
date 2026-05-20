import { and, eq, isNull } from 'drizzle-orm';
import { companies } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import type { Company, UpdateCompanyInput } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function getMyCompany(user: AuthContext): Promise<Company> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Company not found');
    return row as unknown as Company;
  });
}

export async function updateMyCompany(
  input: UpdateCompanyInput,
  user: AuthContext,
): Promise<Company> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError('Company not found');

    const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.gstNumber !== undefined) updates.gstNumber = emptyToNull(input.gstNumber);
    if (input.phone !== undefined) updates.phone = emptyToNull(input.phone);
    if (input.addressLine1 !== undefined) updates.addressLine1 = emptyToNull(input.addressLine1);
    if (input.addressLine2 !== undefined) updates.addressLine2 = emptyToNull(input.addressLine2);
    if (input.city !== undefined) updates.city = emptyToNull(input.city);
    if (input.state !== undefined) updates.state = emptyToNull(input.state);
    if (input.pincode !== undefined) updates.pincode = emptyToNull(input.pincode);

    const updated = await tx
      .update(companies)
      .set(updates)
      .where(eq(companies.id, companyId))
      .returning();
    return updated[0] as unknown as Company;
  });
}
