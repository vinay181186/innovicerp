// Multi-Level BOM (ADR-225) — writes. Each runs inside the caller's
// transaction (service.ts opens it after the access checks) and takes the
// per-company tree lock FIRST (guards.ts), so no two link-changing saves of
// one company interleave (CLAUDE.md §20.3).

import { and, eq, isNull, sql } from 'drizzle-orm';
import { ActivityAction } from '@innovic/shared';
import { mlBomLines, mlBomRevisions, mlBoms } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields, softDeleteStamp } from '../../lib/audit-trail';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { type BomAuditLine, bomLineAuditRows } from '../bom-master/audit';
import { computeBomDiffNote } from '../bom-master/service';
import { assertTreeSound, lockMlBomTree, relinkLinesToDefault, resolveDefaultBoms } from './guards';
import { validateItemAndLines } from './helpers';
import { buildLineValues, buildLinesSnapshot, loadRawMaterialNames } from './lines';
import { ML_BOM_NOT_FOUND, loadMlBomDetail, nextMlBomCode } from './reads';
import type { CreateMlBomInput, MlBomDetail, UpdateMlBomInput } from './schema';

export const ENTITY = 'MlBom';
const yesNo = (v: unknown): string | null => (v == null ? null : v ? 'Yes' : 'No');
export const HEADER_FIELDS = [
  { key: 'remarks', label: 'Remarks' },
  { key: 'revision', label: 'BOM Rev' },
  { key: 'isDefault', label: 'Default', format: yesNo },
];

/** The live header, row-locked (FOR UPDATE) for the rest of the transaction. */
export async function lockHeader(tx: DbTransaction, companyId: string, id: string) {
  const rows = await tx
    .select()
    .from(mlBoms)
    .where(and(eq(mlBoms.id, id), eq(mlBoms.companyId, companyId), isNull(mlBoms.deletedAt)))
    .for('update')
    .limit(1);
  const header = rows[0];
  if (!header) throw new NotFoundError(ML_BOM_NOT_FOUND);
  return header;
}

/** Run the loop / depth guard on every BOM a write touched (deduplicated). */
export async function guardAll(tx: DbTransaction, companyId: string, ids: string[]): Promise<void> {
  for (const id of new Set(ids)) await assertTreeSound(tx, companyId, id);
}

// ─── Create ──────────────────────────────────────────────────────────────

export async function createMlBomTx(
  tx: DbTransaction,
  companyId: string,
  input: CreateMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail> {
  await lockMlBomTree(tx, companyId);
  const lookup = await validateItemAndLines(tx, companyId, input.itemId, input.lines);
  const defaults = await resolveDefaultBoms(tx, companyId, [
    input.itemId,
    ...input.lines.map((l) => l.childItemId),
  ]);

  // Omitted → Default when the item has none yet. Asked for while another is
  // Default → refused: moving the Default is the explicit Make Default action.
  const currentDefault = defaults.get(input.itemId);
  if (input.isDefault === true && currentDefault) {
    const other = await tx
      .select({ code: mlBoms.code })
      .from(mlBoms)
      .where(eq(mlBoms.id, currentDefault))
      .limit(1);
    throw new ConflictError(
      `${other[0]?.code ?? 'Another BOM'} is already the Default BOM for ` +
        `${lookup.get(input.itemId)?.code ?? 'this item'}. Save this one without Default, ` +
        `then use Make Default on it.`,
    );
  }
  const isDefault = input.isDefault ?? !currentDefault;

  const code = await nextMlBomCode(tx, companyId);
  const inserted = await tx
    .insert(mlBoms)
    .values({
      companyId,
      code,
      itemId: input.itemId,
      revision: 1,
      isDefault,
      remarks: input.remarks?.trim() || null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  const header = inserted[0]!;

  const rawMaterial = await loadRawMaterialNames(tx, input.lines, companyId);
  const values = buildLineValues(input.lines, header.id, companyId, user.id, rawMaterial, defaults);
  await tx.insert(mlBomLines).values(values);

  await tx.insert(mlBomRevisions).values({
    companyId,
    mlBomId: header.id,
    revision: 1,
    changedByText: user.email ?? user.id,
    notes: 'Initial creation',
    linesSnapshot: buildLinesSnapshot(values, lookup),
    createdBy: user.id,
    updatedBy: user.id,
  });

  // A new Default: other BOMs' manufacture lines of this item that had no
  // sub-assembly link now link it — same transaction, then each is guarded.
  const relinked = isDefault
    ? await relinkLinesToDefault(tx, companyId, header.id, input.itemId, user)
    : [];
  await guardAll(tx, companyId, [header.id, ...relinked]);

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Create,
      entity: ENTITY,
      entityId: header.id,
      refId: header.code,
      detail:
        `${header.code} — ${lookup.get(input.itemId)?.code ?? ''}` +
        (isDefault ? ' (Default)' : '') +
        (relinked.length > 0 ? ` · linked into ${relinked.length} BOM(s)` : ''),
    },
    companyId,
    user,
  );
  return loadMlBomDetail(tx, header.id, companyId);
}

// ─── Update ──────────────────────────────────────────────────────────────

export async function updateMlBomTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  input: UpdateMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail> {
  // Edit-approval gate (ADR-202) NOT wired in ADR-225 Phase 1 — the gate ships
  // OFF; the registry entry for MlBom comes in a later phase.
  await lockMlBomTree(tx, companyId);
  const header = await lockHeader(tx, companyId, id);
  // R5 (§20.4): refuse if someone else saved this BOM after the form opened it.
  assertUnchangedSinceOpened(header.updatedAt, input.expectedUpdatedAt);
  if (input.itemId !== header.itemId) {
    throw new ConflictError(
      `${header.code}: the BOM item cannot be changed after save. Make a new ` +
        `Multi-Level BOM for the other item.`,
    );
  }

  const lookup = await validateItemAndLines(tx, companyId, header.itemId, input.lines);
  const oldLines = await tx
    .select()
    .from(mlBomLines)
    .where(and(eq(mlBomLines.mlBomId, id), isNull(mlBomLines.deletedAt)));
  const oldCodes = await codesForAudit(tx, companyId, oldLines, lookup);

  const defaults = await resolveDefaultBoms(
    tx,
    companyId,
    input.lines.map((l) => l.childItemId),
  );
  const rawMaterial = await loadRawMaterialNames(tx, input.lines, companyId);
  const values = buildLineValues(input.lines, id, companyId, user.id, rawMaterial, defaults);

  // Replace the lines: the old live ones are SOFT-deleted (CLAUDE.md rule 8 —
  // no hard deletes) and the new set inserted. The one-live-line-per-item
  // index only counts live rows, so the same item can come straight back.
  await tx
    .update(mlBomLines)
    .set({ ...softDeleteStamp(user), updatedBy: user.id })
    .where(
      and(
        eq(mlBomLines.mlBomId, id),
        eq(mlBomLines.companyId, companyId),
        isNull(mlBomLines.deletedAt),
      ),
    );
  await tx.insert(mlBomLines).values(values);

  const newRevision = header.revision + 1;
  const remarks = input.remarks === undefined ? header.remarks : input.remarks?.trim() || null;
  await tx
    .update(mlBoms)
    .set({ remarks, revision: newRevision, updatedBy: user.id, updatedAt: new Date() })
    .where(and(eq(mlBoms.id, id), eq(mlBoms.companyId, companyId)));

  const snapshot = buildLinesSnapshot(values, lookup);
  const autoNote = computeBomDiffNote(
    oldLines.map((l) => ({
      childItemId: l.childItemId,
      childItemCode: oldCodes.get(l.childItemId) ?? null,
      qtyPerSet: l.qtyPerSet,
      bomType: l.bomType,
    })),
    snapshot,
  );
  await tx.insert(mlBomRevisions).values({
    companyId,
    mlBomId: id,
    revision: newRevision,
    changedByText: user.email ?? user.id,
    notes: input.revisionNote?.trim() || autoNote,
    linesSnapshot: snapshot,
    createdBy: user.id,
    updatedBy: user.id,
  });

  await guardAll(tx, companyId, [id]);

  // Audit (ADR-197): header row (Remarks + BOM Rev), then one row per line.
  const toAudit = (l: {
    lineNo: number;
    childItemId: string;
    qtyPerSet: string;
    bomType: string;
    rawMaterialGradeText?: string | null | undefined;
    rawMaterialSizeText?: string | null | undefined;
  }): BomAuditLine => ({
    lineNo: l.lineNo,
    childItemId: l.childItemId,
    qtyPerSet: l.qtyPerSet,
    bomType: l.bomType,
    rawMaterialGradeText: l.rawMaterialGradeText ?? null,
    rawMaterialSizeText: l.rawMaterialSizeText ?? null,
  });
  const lineRows = bomLineAuditRows(oldLines.map(toAudit), values.map(toAudit), oldCodes);
  const headerChanges = diffFields(
    { remarks: header.remarks, revision: header.revision },
    { remarks, revision: newRevision },
    HEADER_FIELDS,
  );
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: ENTITY,
      entityId: id,
      refId: header.code,
      changes: headerChanges,
      detail: `Edited ${header.code}${input.revisionNote?.trim() ? ` — ${input.revisionNote.trim()}` : ''}`,
    },
    companyId,
    user,
  );
  for (const row of lineRows) {
    await emitActivityLog(
      tx,
      {
        action: row.action,
        entity: ENTITY,
        entityId: id,
        refId: header.code,
        lineRef: row.lineRef,
        changes: row.changes,
        detail: `${header.code} ${row.detail}`,
      },
      companyId,
      user,
    );
  }
  return loadMlBomDetail(tx, id, companyId);
}

/** item id → code for the old AND new lines (the audit names both). */
async function codesForAudit(
  tx: DbTransaction,
  companyId: string,
  oldLines: ReadonlyArray<{ childItemId: string }>,
  lookup: ReadonlyMap<string, { code: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [itemId, it] of lookup) out.set(itemId, it.code);
  const missing = oldLines.map((l) => l.childItemId).filter((i) => !out.has(i));
  if (missing.length > 0) {
    const rows = (await tx.execute(sql`
      SELECT id, code FROM public.items
      WHERE company_id = ${companyId}::uuid
        AND id IN (${sql.join(
          missing.map((i) => sql`${i}::uuid`),
          sql`, `,
        )})
    `)) as unknown as Array<{ id: string; code: string }>;
    for (const r of rows) out.set(r.id, r.code);
  }
  return out;
}
