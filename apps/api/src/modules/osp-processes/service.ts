// OSP Process Configuration service.
//
// CRUD over `osp_processes`. Manager/admin writes. Mirror of legacy
// Settings page OSP block (_addOspProcess L13249 / _editOspProcess
// L13269 / _delOspProcess L13288). Soft-delete on remove.

import type { ListOspProcessesResponse, OspProcess, OspProcessInput } from '@innovic/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { ospProcesses, vendors } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function rowToOsp(r: {
  id: string;
  companyId: string;
  processName: string;
  vendorId: string | null;
  vendorCode: string | null;
  vendorName: string | null;
  autoPo: boolean;
  leadDays: number;
  createdAt: Date;
  updatedAt: Date;
}): OspProcess {
  return {
    id: r.id,
    companyId: r.companyId,
    processName: r.processName,
    vendorId: r.vendorId,
    vendorCode: r.vendorCode,
    vendorName: r.vendorName,
    autoPo: r.autoPo,
    leadDays: r.leadDays,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listOspProcesses(user: AuthContext): Promise<ListOspProcessesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: ospProcesses.id,
        companyId: ospProcesses.companyId,
        processName: ospProcesses.processName,
        vendorId: ospProcesses.vendorId,
        vendorCode: vendors.code,
        vendorName: vendors.name,
        autoPo: ospProcesses.autoPo,
        leadDays: ospProcesses.leadDays,
        createdAt: ospProcesses.createdAt,
        updatedAt: ospProcesses.updatedAt,
      })
      .from(ospProcesses)
      .leftJoin(vendors, eq(vendors.id, ospProcesses.vendorId))
      .where(and(eq(ospProcesses.companyId, companyId), isNull(ospProcesses.deletedAt)))
      .orderBy(asc(ospProcesses.processName));
    return { items: rows.map(rowToOsp) };
  });
}

export async function createOspProcess(
  input: OspProcessInput,
  user: AuthContext,
): Promise<OspProcess> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Duplicate-name guard (case-insensitive) — matches partial-unique
    // index but surfaced as a user-friendly ValidationError.
    const dup = await tx
      .select({ id: ospProcesses.id })
      .from(ospProcesses)
      .where(
        and(
          eq(ospProcesses.companyId, companyId),
          sql`lower(${ospProcesses.processName}) = lower(${input.processName})`,
          isNull(ospProcesses.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) throw new ValidationError(`OSP process "${input.processName}" already exists`);

    const inserted = await tx
      .insert(ospProcesses)
      .values({
        companyId,
        processName: input.processName.trim(),
        vendorId: input.vendorId ?? null,
        autoPo: input.autoPo && !!input.vendorId,
        leadDays: input.leadDays,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();

    return getOspProcessInternal(tx, inserted[0]!.id, companyId);
  });
}

/** Read one OSP process on an EXISTING transaction. Callers that are already
 *  inside `withUserContext` MUST use this, not `getOspProcess` — nesting
 *  `withUserContext` opens a second transaction on a different pooled
 *  connection, which cannot see the outer transaction's uncommitted rows. */
async function getOspProcessInternal(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<OspProcess> {
  const rows = await tx
    .select({
      id: ospProcesses.id,
      companyId: ospProcesses.companyId,
      processName: ospProcesses.processName,
      vendorId: ospProcesses.vendorId,
      vendorCode: vendors.code,
      vendorName: vendors.name,
      autoPo: ospProcesses.autoPo,
      leadDays: ospProcesses.leadDays,
      createdAt: ospProcesses.createdAt,
      updatedAt: ospProcesses.updatedAt,
    })
    .from(ospProcesses)
    .leftJoin(vendors, eq(vendors.id, ospProcesses.vendorId))
    .where(
      and(
        eq(ospProcesses.id, id),
        eq(ospProcesses.companyId, companyId),
        isNull(ospProcesses.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`OSP process ${id} not found`);
  return rowToOsp(row);
}

export async function getOspProcess(id: string, user: AuthContext): Promise<OspProcess> {
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => getOspProcessInternal(tx, id, companyId));
}

export async function updateOspProcess(
  id: string,
  input: OspProcessInput,
  user: AuthContext,
): Promise<OspProcess> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(ospProcesses)
      .where(
        and(
          eq(ospProcesses.id, id),
          eq(ospProcesses.companyId, companyId),
          isNull(ospProcesses.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`OSP process ${id} not found`);

    // Dup check — exclude self.
    const dup = await tx
      .select({ id: ospProcesses.id })
      .from(ospProcesses)
      .where(
        and(
          eq(ospProcesses.companyId, companyId),
          sql`lower(${ospProcesses.processName}) = lower(${input.processName})`,
          sql`${ospProcesses.id} != ${id}`,
          isNull(ospProcesses.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) throw new ValidationError(`OSP process "${input.processName}" already exists`);

    await tx
      .update(ospProcesses)
      .set({
        processName: input.processName.trim(),
        vendorId: input.vendorId ?? null,
        autoPo: input.autoPo && !!input.vendorId,
        leadDays: input.leadDays,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(ospProcesses.id, id));

    return getOspProcessInternal(tx, id, companyId);
  });
}

export async function softDeleteOspProcess(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: ospProcesses.id })
      .from(ospProcesses)
      .where(
        and(
          eq(ospProcesses.id, id),
          eq(ospProcesses.companyId, companyId),
          isNull(ospProcesses.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`OSP process ${id} not found`);

    await tx
      .update(ospProcesses)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(ospProcesses.id, id));
    return { ok: true };
  });
}
