// Multi-Level BOM (ADR-225) — Make Default and soft delete. Same rules as
// writes.ts: caller's transaction, per-company tree lock FIRST, header row
// locked FOR UPDATE, status-like flags moved by conditional UPDATE (§20.2).

import { and, eq, isNull, sql } from 'drizzle-orm';
import { ActivityAction } from '@innovic/shared';
import { mlBoms } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields, softDeleteStamp } from '../../lib/audit-trail';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { ConflictError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { lockMlBomTree, relinkLinesToDefault } from './guards';
import { tsLike } from './helpers';
import { loadMlBomDetail } from './reads';
import type { MakeDefaultMlBomInput, MlBom, MlBomDetail } from './schema';
import { ENTITY, HEADER_FIELDS, guardAll, lockHeader } from './writes';

// ─── Make Default ────────────────────────────────────────────────────────

export async function makeDefaultMlBomTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  input: MakeDefaultMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail> {
  await lockMlBomTree(tx, companyId);
  const target = await lockHeader(tx, companyId, id);
  assertUnchangedSinceOpened(target.updatedAt, input.expectedUpdatedAt);
  if (target.isDefault) return loadMlBomDetail(tx, id, companyId); // already — nothing to move

  // Lock the current Default of the same item too, then move the flag with
  // conditional UPDATEs (§20.2): demote first, so the one-Default index holds.
  const oldRows = await tx
    .select({ id: mlBoms.id, code: mlBoms.code })
    .from(mlBoms)
    .where(
      and(
        eq(mlBoms.companyId, companyId),
        eq(mlBoms.itemId, target.itemId),
        eq(mlBoms.isDefault, true),
        isNull(mlBoms.deletedAt),
      ),
    )
    .for('update');
  const old = oldRows[0] ?? null;
  if (old) {
    const demoted = await tx
      .update(mlBoms)
      .set({ isDefault: false, updatedBy: user.id })
      .where(and(eq(mlBoms.id, old.id), eq(mlBoms.isDefault, true), isNull(mlBoms.deletedAt)))
      .returning({ id: mlBoms.id });
    if (demoted.length !== 1) {
      throw new ConflictError(`${old.code} is no longer the Default BOM — reload and try again.`);
    }
  }
  const promoted = await tx
    .update(mlBoms)
    .set({ isDefault: true, updatedBy: user.id })
    .where(and(eq(mlBoms.id, id), eq(mlBoms.isDefault, false), isNull(mlBoms.deletedAt)))
    .returning({ id: mlBoms.id });
  if (promoted.length !== 1) {
    throw new ConflictError(`${target.code} was changed by someone else — reload and try again.`);
  }

  // Re-point every live manufacture line of this item (on the old Default, or
  // not linked yet) at the new Default, then guard each parent that moved.
  const relinked = await relinkLinesToDefault(tx, companyId, id, target.itemId, user);
  await guardAll(tx, companyId, [id, ...relinked]);

  const changes = diffFields({ isDefault: false }, { isDefault: true }, HEADER_FIELDS);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: ENTITY,
      entityId: id,
      refId: target.code,
      changes,
      detail:
        `${target.code} made Default${old ? ` (was ${old.code})` : ''}` +
        (relinked.length > 0 ? ` · ${relinked.length} BOM(s) re-linked` : ''),
    },
    companyId,
    user,
  );
  if (old) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: ENTITY,
        entityId: old.id,
        refId: old.code,
        changes: diffFields({ isDefault: true }, { isDefault: false }, HEADER_FIELDS),
        detail: `${old.code} no longer Default — ${target.code} is`,
      },
      companyId,
      user,
    );
  }
  return loadMlBomDetail(tx, id, companyId);
}

// ─── Delete (soft) ───────────────────────────────────────────────────────

export async function softDeleteMlBomTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  user: AuthContext,
  reason: string | null,
): Promise<MlBom> {
  await lockMlBomTree(tx, companyId);
  const header = await lockHeader(tx, companyId, id);

  const usedBy = (await tx.execute(sql`
    SELECT DISTINCT p.code
    FROM public.ml_bom_lines l
    JOIN public.ml_boms p ON p.id = l.ml_bom_id AND p.deleted_at IS NULL
    WHERE l.child_ml_bom_id = ${id}::uuid
      AND l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
      AND l.ml_bom_id <> ${id}::uuid
    ORDER BY p.code
  `)) as unknown as Array<{ code: string }>;
  if (usedBy.length > 0) {
    throw new ConflictError(
      `Cannot delete ${header.code} — used in ${usedBy.map((u) => u.code).join(', ')}. ` +
        `Remove it from those BOMs first.`,
    );
  }

  // The Default flag is cleared with the delete (no other BOM becomes Default
  // automatically), so a later restore can never meet a second Default.
  const stamp = softDeleteStamp(user);
  await tx
    .update(mlBoms)
    .set({ ...stamp, isDefault: false, updatedBy: user.id, updatedAt: stamp.deletedAt })
    .where(and(eq(mlBoms.id, id), eq(mlBoms.companyId, companyId)));
  // Lines are NOT stamped (as BOM Master): every read joins the header's
  // deleted_at, so they are unreachable while the header is deleted.

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Delete,
      entity: ENTITY,
      entityId: id,
      refId: header.code,
      detail: `${header.code}${header.isDefault ? ' (was Default)' : ''}`,
      reason,
    },
    companyId,
    user,
  );

  return {
    id: header.id,
    companyId: header.companyId,
    code: header.code,
    itemId: header.itemId,
    itemCode: null,
    itemName: null,
    revision: header.revision,
    isDefault: false,
    remarks: header.remarks,
    createdAt: tsLike(header.createdAt),
    createdBy: header.createdBy,
    updatedAt: tsLike(stamp.deletedAt),
    updatedBy: user.id,
    deletedAt: tsLike(stamp.deletedAt),
  };
}
