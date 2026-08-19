import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { qcProcesses } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { DEFAULT_FINAL_QC_OP } from '../../lib/jc-default-qc';
import type {
  CreateQcProcessInput,
  ListQcProcessesQuery,
  ListQcProcessesResponse,
  QcProcess,
  UpdateQcProcessInput,
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

export async function listQcProcesses(
  input: ListQcProcessesQuery,
  user: AuthContext,
): Promise<ListQcProcessesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(qcProcesses.companyId, companyId), isNull(qcProcesses.deletedAt)];
    if (input.search) {
      const s = or(
        ilike(qcProcesses.code, `%${input.search}%`),
        ilike(qcProcesses.description, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (input.isActive !== undefined) conditions.push(eq(qcProcesses.isActive, input.isActive));

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(qcProcesses)
        .where(where)
        .orderBy(asc(qcProcesses.code))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(qcProcesses).where(where),
    ]);

    return {
      items: rows as unknown as QcProcess[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getQcProcess(id: string, user: AuthContext): Promise<QcProcess> {
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(qcProcesses)
      .where(and(eq(qcProcesses.id, id), isNull(qcProcesses.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`QC process ${id} not found`);
    return row as unknown as QcProcess;
  });
}

export async function createQcProcess(
  input: CreateQcProcessInput,
  user: AuthContext,
): Promise<QcProcess> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: qcProcesses.id })
      .from(qcProcesses)
      .where(
        and(
          eq(qcProcesses.companyId, companyId),
          eq(qcProcesses.code, input.code),
          isNull(qcProcesses.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictError(`QC process "${input.code}" already exists`);
    }

    const inserted = await tx
      .insert(qcProcesses)
      .values({
        companyId,
        code: input.code.trim(),
        description: emptyToNull(input.description),
        defaultCycleTimeMin: String(input.defaultCycleTimeMin ?? 0),
        isActive: input.isActive,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return inserted[0] as unknown as QcProcess;
  });
}

export async function updateQcProcess(
  id: string,
  input: UpdateQcProcessInput,
  user: AuthContext,
): Promise<QcProcess> {
  requireWriteRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: qcProcesses.id })
      .from(qcProcesses)
      .where(and(eq(qcProcesses.id, id), isNull(qcProcesses.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`QC process ${id} not found`);

    const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
    if (input.description !== undefined) updates.description = emptyToNull(input.description);
    if (input.defaultCycleTimeMin !== undefined)
      updates.defaultCycleTimeMin = String(input.defaultCycleTimeMin);
    if (input.isActive !== undefined) updates.isActive = input.isActive;

    const updated = await tx
      .update(qcProcesses)
      .set(updates)
      .where(eq(qcProcesses.id, id))
      .returning();
    return updated[0] as unknown as QcProcess;
  });
}

// Deleting a QC process is guarded, because nothing else links the master to the
// documents that use it. A QC step is stored as the free-text `operation` column
// on jc_ops / plan_ops / route_card_ops — there is no `qc_process_id` FK, so the
// database cannot refuse the delete on our behalf. Removing a row that is in use
// leaves those documents holding a name the master can no longer explain, and
// makes the name unpickable for anything new.
//
// The name itself is already immutable (updateQcProcess never writes `code`), so
// delete-and-recreate is the only way a name can change — which is exactly the
// path this guard has to cover.
export async function softDeleteQcProcess(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: qcProcesses.id, code: qcProcesses.code })
      .from(qcProcesses)
      .where(and(eq(qcProcesses.id, id), isNull(qcProcesses.deletedAt)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new NotFoundError(`QC process ${id} not found`);

    // The server itself writes this name. ADR-069 Rule B appends a terminal QC
    // op called DIR to every JC that would otherwise never credit finished
    // stock (lib/jc-default-qc.ts). That happens whether or not the master
    // still has the row, so deleting it would put the system in the permanent
    // position of generating a QC step whose name nothing defines.
    if (row.code === DEFAULT_FINAL_QC_OP) {
      throw new ConflictError(
        `"${row.code}" cannot be deleted — the system adds it automatically as the final QC step on job cards that need one (ADR-069). Set it to Inactive instead.`,
      );
    }

    // Counted per company. All three tables carry company_id, and a QC process
    // name is unique per company, so a same-named row in another company must
    // not hold this one hostage.
    const used = await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM jc_ops
          WHERE company_id = ${companyId}::uuid AND op_type = 'qc' AND operation = ${row.code})::int
          AS "jcOps",
        (SELECT count(*) FROM plan_ops
          WHERE company_id = ${companyId}::uuid AND op_type = 'qc' AND operation = ${row.code})::int
          AS "planOps",
        (SELECT count(*) FROM route_card_ops
          WHERE company_id = ${companyId}::uuid AND op_type = 'qc' AND operation = ${row.code})::int
          AS "routeCardOps"
    `);
    const counts = (used as unknown as Record<string, number>[])[0];
    const jcOpsUsed = Number(counts?.['jcOps'] ?? 0);
    const planOpsUsed = Number(counts?.['planOps'] ?? 0);
    const routeCardOpsUsed = Number(counts?.['routeCardOps'] ?? 0);
    const total = jcOpsUsed + planOpsUsed + routeCardOpsUsed;
    if (total > 0) {
      const where = [
        jcOpsUsed > 0 ? `${jcOpsUsed} job card op${jcOpsUsed === 1 ? '' : 's'}` : null,
        planOpsUsed > 0 ? `${planOpsUsed} plan op${planOpsUsed === 1 ? '' : 's'}` : null,
        routeCardOpsUsed > 0
          ? `${routeCardOpsUsed} route card op${routeCardOpsUsed === 1 ? '' : 's'}`
          : null,
      ]
        .filter((s): s is string => s !== null)
        .join(', ');
      throw new ConflictError(
        `QC process "${row.code}" is in use by ${where} and cannot be deleted. Set it to Inactive instead — it will stop appearing in the pickers while the existing documents keep working.`,
      );
    }

    await tx
      .update(qcProcesses)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(qcProcesses.id, id));
    return { ok: true };
  });
}
