import { ActivityAction } from '@innovic/shared';
// Machine GROUP master (migration 0116). The second tab of the Machine Master
// screen; the first is ../machines. The two are one screen in the user's head,
// so everything here is gated on the SAME form key the machines module uses —
// `machine_create` (Production) — not a key of its own.
//
// Shaped on ../material-grades: same list / create / update / soft-delete
// shape, same tier gate, same typed errors. Two deliberate differences:
//   - NO auto code series and NO bulk import. `code` is the word the shop floor
//     already uses ('VMC'), so the user types it and there is nothing sensible
//     to generate. A group master is a handful of rows, not a spreadsheet.
//   - soft-delete REFUSES while a live machine still points at the group,
//     rather than cascading, so no machine is left holding a dangling FK or
//     silently un-grouped behind the user's back.

import { and, asc, count, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { machineGroups, machines } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import type {
  CreateMachineGroupInput,
  ListMachineGroupsQuery,
  ListMachineGroupsResponse,
  MachineGroup,
  UpdateMachineGroupInput,
} from './schema';
import { softDeleteStamp } from '../../lib/audit-trail';
import { emitActivityLog } from '../activity-log/service';
import { MACHINE_GROUP_SF_COLUMNS } from './sf-columns';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function listMachineGroups(
  input: ListMachineGroupsQuery,
  user: AuthContext,
): Promise<ListMachineGroupsResponse> {
  await requireFormAccess(user, 'machine_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [
      eq(machineGroups.companyId, companyId),
      isNull(machineGroups.deletedAt),
    ];
    if (input.search) {
      const pat = `%${likeEscape(input.search)}%`;
      const s = or(
        sql`${machineGroups.code} ILIKE ${pat} ESCAPE '\\'`,
        sql`${machineGroups.description} ILIKE ${pat} ESCAPE '\\'`,
      );
      if (s) conditions.push(s);
    }
    if (typeof input.isActive === 'boolean') {
      conditions.push(eq(machineGroups.isActive, input.isActive));
    }
    // Sort & Filter (ADR-200), list AND count; code then id keeps paging stable.
    const sf = readSf(input.sf);
    conditions.push(sql`TRUE ${sfWhere(MACHINE_GROUP_SF_COLUMNS, sf)}`);

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(machineGroups)
        .where(where)
        .orderBy(
          sfOrderBy(
            MACHINE_GROUP_SF_COLUMNS,
            sf,
            sql`${asc(machineGroups.code)}, ${asc(machineGroups.id)}`,
          ),
        )
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(machineGroups).where(where),
    ]);

    return {
      groups: rows as unknown as MachineGroup[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getMachineGroup(id: string, user: AuthContext): Promise<MachineGroup> {
  await requireFormAccess(user, 'machine_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(machineGroups)
      .where(
        and(
          eq(machineGroups.id, id),
          eq(machineGroups.companyId, companyId),
          isNull(machineGroups.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Machine Group not found. Refresh the page.');
    return row as unknown as MachineGroup;
  });
}

export async function createMachineGroup(
  input: CreateMachineGroupInput,
  user: AuthContext,
): Promise<MachineGroup> {
  // L2 Data Entry and up in Production can add a group; L1 Viewer cannot.
  await requireFormAccess(user, 'machine_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry for the same reason as material-grades: two concurrent
  // creates of the same code collide on machine_groups_company_code_uniq
  // (23505), which aborts the transaction. The retry re-runs in a fresh one and
  // the loser then sees the row and gets a clean ConflictError instead of a 500.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const code = input.code.trim();
      const existing = await tx
        .select({ id: machineGroups.id, deletedAt: machineGroups.deletedAt })
        .from(machineGroups)
        .where(and(eq(machineGroups.companyId, companyId), eq(machineGroups.code, code)))
        .limit(1);
      const dup = existing[0];
      if (dup) {
        if (dup.deletedAt) {
          throw new ConflictError(
            `Machine group "${code}" belongs to a deleted group — restore it instead of re-creating`,
          );
        }
        throw new ConflictError(`Machine group "${code}" already exists`);
      }

      const inserted = await tx
        .insert(machineGroups)
        .values({
          companyId,
          code,
          description: emptyToNull(input.description),
          isActive: input.isActive,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      return inserted[0] as unknown as MachineGroup;
    }),
  );
}

export async function updateMachineGroup(
  id: string,
  input: UpdateMachineGroupInput,
  user: AuthContext,
): Promise<MachineGroup> {
  // Changing a saved group is `edit`, so L2 (create-only) is correctly refused.
  await requireFormAccess(user, 'machine_create', 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: machineGroups.id })
      .from(machineGroups)
      .where(
        and(
          eq(machineGroups.id, id),
          eq(machineGroups.companyId, companyId),
          isNull(machineGroups.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0)
      throw new NotFoundError('Machine Group not found. Refresh the page.');

    // `code` is not updatable (omitted from the shared input schema): it is the
    // word the shop floor reads and screens quote, so a rename would make the
    // master disagree with what is already on paper. Retire with isActive.
    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.description !== undefined) updates.description = emptyToNull(input.description);
    if (input.isActive !== undefined) updates.isActive = input.isActive;

    const updated = await tx
      .update(machineGroups)
      .set(updates)
      .where(eq(machineGroups.id, id))
      .returning();
    return updated[0] as unknown as MachineGroup;
  });
}

export async function softDeleteMachineGroup(id: string, user: AuthContext): Promise<{ ok: true }> {
  // Delete = the edit+approve pair only L5 Department Admin and above hold.
  await requireFormAccess(user, 'machine_create', 'edit');
  await requireFormAccess(user, 'machine_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: machineGroups.id, code: machineGroups.code })
      .from(machineGroups)
      .where(
        and(
          eq(machineGroups.id, id),
          eq(machineGroups.companyId, companyId),
          isNull(machineGroups.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0)
      throw new NotFoundError('Machine Group not found. Refresh the page.');

    // Refuse while live machines still point here. No cascade: silently
    // un-grouping someone's machines is not a delete the user asked for. They
    // retire the group with Active = No, or move the machines first.
    const inUse = await tx
      .select({ value: count() })
      .from(machines)
      .where(
        and(
          eq(machines.companyId, companyId),
          eq(machines.machineGroupId, id),
          isNull(machines.deletedAt),
        ),
      );
    const used = inUse[0]?.value ?? 0;
    if (used > 0) {
      throw new ConflictError(
        `This machine group is used by ${used} machine${used === 1 ? '' : 's'} — change those machines first, or set the group to inactive instead`,
      );
    }

    await tx
      .update(machineGroups)
      .set({ ...softDeleteStamp(user), updatedBy: user.id })
      .where(eq(machineGroups.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'MachineGroup',
        entityId: id,
        refId: existing[0]?.code ?? null,
        detail: `Deleted Machine Group ${existing[0]?.code ?? id}`,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
