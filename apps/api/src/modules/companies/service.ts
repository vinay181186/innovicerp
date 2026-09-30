import { and, eq, isNull } from 'drizzle-orm';
import { ActivityAction, MASTER_RULES_MODE_LABEL, type MasterRulesMode } from '@innovic/shared';
import { companies } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { type DiffField, diffFields } from '../../lib/audit-trail';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import type { Company, UpdateCompanyInput } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** Company settings logged Before → After on EDIT (ADR-197). The master-rule
 *  settings (migration 0183) change how every Customer / Vendor / Item save
 *  behaves, so who switched them, and when, must be on record. */
const COMPANY_FIELDS: readonly DiffField[] = [
  { key: 'name', label: 'Company Name' },
  { key: 'gstNumber', label: 'GSTIN' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'E-mail' },
  { key: 'addressLine1', label: 'Address Line 1' },
  { key: 'addressLine2', label: 'Address Line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'PIN Code' },
  {
    key: 'masterRulesMode',
    label: 'Master Rules Mode',
    format: (v) =>
      typeof v === 'string' ? (MASTER_RULES_MODE_LABEL[v as MasterRulesMode] ?? v) : null,
  },
  {
    key: 'checkHsn',
    label: 'Check HSN',
    format: (v) => (v === true ? 'On' : v === false ? 'Off' : null),
  },
  { key: 'hsnMinDigits', label: 'HSN Min Digits' },
];

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
    // The whole row, read BEFORE the update — the "before" of Before → After.
    const existing = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
      .limit(1);
    const before = existing[0];
    if (!before) throw new NotFoundError('Company not found');

    const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.gstNumber !== undefined) updates.gstNumber = emptyToNull(input.gstNumber);
    if (input.phone !== undefined) updates.phone = emptyToNull(input.phone);
    if (input.email !== undefined) updates.email = emptyToNull(input.email);
    if (input.addressLine1 !== undefined) updates.addressLine1 = emptyToNull(input.addressLine1);
    if (input.addressLine2 !== undefined) updates.addressLine2 = emptyToNull(input.addressLine2);
    if (input.city !== undefined) updates.city = emptyToNull(input.city);
    if (input.state !== undefined) updates.state = emptyToNull(input.state);
    if (input.pincode !== undefined) updates.pincode = emptyToNull(input.pincode);
    if (input.masterRulesMode !== undefined) updates.masterRulesMode = input.masterRulesMode;
    if (input.checkHsn !== undefined) updates.checkHsn = input.checkHsn;
    if (input.hsnMinDigits !== undefined) updates.hsnMinDigits = input.hsnMinDigits;

    const changes = diffFields(before, updates, COMPANY_FIELDS);
    const updated = await tx
      .update(companies)
      .set(updates)
      .where(eq(companies.id, companyId))
      .returning();
    const row = updated[0] as unknown as Company;
    if (changes.length > 0) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Edit,
          entity: 'Company',
          entityId: companyId,
          refId: row.name,
          changes,
          detail: `Company Settings edited — ${changes.map((c) => c.label).join(', ')}`,
        },
        companyId,
        user,
      );
    }
    return row;
  });
}
