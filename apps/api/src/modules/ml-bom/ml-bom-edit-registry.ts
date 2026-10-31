// Multi-Level BOM entry for the edit-approval engine (ADR-202, ADR-249 Step B2).
//
// Three boxes, the smallest set that covers every save a live ML-BOM takes:
//   remarks    Remarks        — the header field, a normal box
//   lines      BOM Lines      — the WHOLE line set as ONE box, shown as a short
//                               "1. CODE × qty Type …; 2. …" text (ml-bom-edit-
//                               summary.ts). The text is built from the stored
//                               rows (before) and the proposed input (after), so
//                               it is also the freshness key: any line change
//                               after the request makes the box "superseded".
//   isDefault  Default        — Make Default. The before-text names the BOM it
//                               takes over from, so a Default that moved to a
//                               THIRD BOM meanwhile reads as superseded.
//
// The proposed payload is tagged: { op: 'revise', input } (PUT, import) or
// { op: 'makeDefault' }. applyEdit replays the REAL writers — updateMlBomTx
// (tree lock, header lock, R5, line replace, BOM Rev bump, revision snapshot,
// loop / depth guard, History) or makeDefaultMlBomTx (both Default rows moved by
// conditional UPDATEs in the same transaction, links re-pointed, History).
//
// Lock order. Every ML-BOM write takes the per-company tree lock FIRST, then
// the header row. loadForDiff runs before applyEdit in the engine's decide, so
// it takes the tree lock FIRST too — otherwise decide would hold the header and
// wait for the tree lock a direct save already holds (deadlock). The advisory
// lock is re-entrant, so the writer taking it again costs nothing.

import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { AccessFormKey, UpdateMlBomInput } from '@innovic/shared';
import { items, materialGrades, materialSizes, mlBomLines, mlBoms } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import type { DiffField } from '../../lib/audit-trail';
import { NotFoundError } from '../../lib/errors';
import { drawingRevOf } from '../../lib/drawing-rev';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { makeDefaultMlBomTx } from './default-delete';
import { lockMlBomTree } from './guards';
import { type MlBomCanonLine, describeDefault, summarizeMlBomLines } from './ml-bom-edit-summary';
import { ML_BOM_NOT_FOUND } from './reads';
import type { MlBomLineInput } from './schema';
import { updateMlBomTx } from './writes';

const FORM_KEY: AccessFormKey = 'mlbom_create';

/** `requireRev: false` = staged by the Excel import (D2): the approval replay
 *  saves a MAKE child with no Drawing Rev as null, exactly as the direct
 *  import would. Absent (PUT from the screen) = the Rev stays compulsory. */
export type MlBomEditPayload =
  | { op: 'revise'; input: UpdateMlBomInput; requireRev?: false }
  | { op: 'makeDefault' };

const FIELDS: readonly DiffField[] = [
  { key: 'remarks', label: 'Remarks' },
  { key: 'lines', label: 'BOM Lines' },
  // docs/NAMING.md registers this fact as `Default` (not "Default BOM").
  { key: 'isDefault', label: 'Default' },
];

/** The stored live lines, in line order, with the child code (one query). */
async function loadStoredLines(tx: DbTransaction, companyId: string, id: string) {
  return tx
    .select({
      childItemId: mlBomLines.childItemId,
      childCode: items.code,
      qtyPerSet: mlBomLines.qtyPerSet,
      bomType: mlBomLines.bomType,
      rawMaterialGradeId: mlBomLines.rawMaterialGradeId,
      rawMaterialGradeText: mlBomLines.rawMaterialGradeText,
      rawMaterialSizeId: mlBomLines.rawMaterialSizeId,
      rawMaterialSizeText: mlBomLines.rawMaterialSizeText,
      remarks: mlBomLines.remarks,
      // D2 — the child Drawing Rev text (scalar lookup, one row per line).
      drawingRev: drawingRevOf(mlBomLines.childItemRevisionId),
    })
    .from(mlBomLines)
    .leftJoin(items, eq(items.id, mlBomLines.childItemId))
    .where(
      and(
        eq(mlBomLines.mlBomId, id),
        eq(mlBomLines.companyId, companyId),
        isNull(mlBomLines.deletedAt),
      ),
    )
    .orderBy(asc(mlBomLines.lineNo));
}

/** Proposed lines → canonical form, WITHOUT throwing (afterSnapshot also runs
 *  at decide time, where a throw would block even a Reject). Names resolved
 *  the way buildLineValues stores them: master name for an id, else the text. */
async function canonProposedLines(
  tx: DbTransaction,
  companyId: string,
  lines: readonly MlBomLineInput[],
  /** D2 — stored Rev per child item: a line that does not send a Rev keeps it. */
  storedRevs: Readonly<Record<string, string | null>> = {},
): Promise<MlBomCanonLine[]> {
  const ids = (pick: (l: MlBomLineInput) => string | null | undefined) => [
    ...new Set(lines.map(pick).filter((v): v is string => !!v)),
  ];
  const itemIds = ids((l) => l.childItemId);
  const gradeIds = ids((l) => l.rawMaterialGradeId);
  const sizeIds = ids((l) => l.rawMaterialSizeId);
  const codes = new Map<string, string>();
  const grades = new Map<string, string>();
  const sizes = new Map<string, string>();
  if (itemIds.length > 0) {
    const rows = await tx
      .select({ id: items.id, code: items.code })
      .from(items)
      .where(and(eq(items.companyId, companyId), inArray(items.id, itemIds)));
    for (const r of rows) codes.set(r.id, r.code);
  }
  if (gradeIds.length > 0) {
    const rows = await tx
      .select({ id: materialGrades.id, name: materialGrades.name })
      .from(materialGrades)
      .where(and(eq(materialGrades.companyId, companyId), inArray(materialGrades.id, gradeIds)));
    for (const r of rows) grades.set(r.id, r.name);
  }
  if (sizeIds.length > 0) {
    const rows = await tx
      .select({ id: materialSizes.id, name: materialSizes.name })
      .from(materialSizes)
      .where(and(eq(materialSizes.companyId, companyId), inArray(materialSizes.id, sizeIds)));
    for (const r of rows) sizes.set(r.id, r.name);
  }
  return lines.map((l) => ({
    childCode: codes.get(l.childItemId) ?? `(unknown item ${l.childItemId.slice(0, 8)})`,
    qtyPerSet: String(l.qtyPerSet),
    bomType: l.bomType,
    rmGrade: l.rawMaterialGradeId
      ? (grades.get(l.rawMaterialGradeId) ?? null)
      : (l.rawMaterialGradeText ?? null),
    rmSize: l.rawMaterialSizeId
      ? (sizes.get(l.rawMaterialSizeId) ?? null)
      : (l.rawMaterialSizeText ?? null),
    remarks: l.remarks ?? null,
    drawingRev:
      l.childDrawingRev === undefined
        ? (storedRevs[l.childItemId] ?? null)
        : l.childDrawingRev?.trim() || null,
  }));
}

export const mlBomEditRegistryEntry: DocEditRegistryEntry = {
  formKey: FORM_KEY,

  diffFields() {
    return FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    await lockMlBomTree(tx, companyId); // FIRST — see the lock-order note above
    const rows = await tx
      .select()
      .from(mlBoms)
      .where(and(eq(mlBoms.id, id), eq(mlBoms.companyId, companyId), isNull(mlBoms.deletedAt)))
      .for('update')
      .limit(1);
    const header = rows[0];
    if (!header) return null;

    // The item's OTHER live Default, locked as makeDefaultMlBomTx locks it
    // (target first, then the old Default) — the Default box reads both rows.
    const others = await tx
      .select({ id: mlBoms.id, code: mlBoms.code })
      .from(mlBoms)
      .where(
        and(
          eq(mlBoms.companyId, companyId),
          eq(mlBoms.itemId, header.itemId),
          eq(mlBoms.isDefault, true),
          ne(mlBoms.id, id),
          isNull(mlBoms.deletedAt),
        ),
      )
      .for('update');

    // Lines are replaced only under the tree lock held above, so no row lock.
    const stored = await loadStoredLines(tx, companyId, id);
    const lines: MlBomCanonLine[] = stored.map((l) => ({
      childCode: l.childCode ?? `(unknown item ${l.childItemId.slice(0, 8)})`,
      qtyPerSet: l.qtyPerSet,
      bomType: l.bomType,
      rmGrade: l.rawMaterialGradeText,
      rmSize: l.rawMaterialSizeText,
      remarks: l.remarks,
      drawingRev: l.drawingRev ?? null,
    }));
    const storedRevs: Record<string, string | null> = {};
    for (const l of stored) storedRevs[l.childItemId] = l.drawingRev ?? null;

    return {
      doc: { ...header, lines, storedRevs, otherDefaultCode: others[0]?.code ?? null },
      updatedAt: header.updatedAt,
      docCode: header.code,
      // Any existing (not-deleted) ML-BOM is live; loadForDiff is null otherwise.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      remarks: d['remarks'] ?? null,
      lines: summarizeMlBomLines((d['lines'] as MlBomCanonLine[] | undefined) ?? []),
      isDefault: describeDefault(
        d['isDefault'] === true,
        (d['otherDefaultCode'] as string | null) ?? null,
      ),
    };
  },

  async afterSnapshot(tx, companyId, payload, _user, target) {
    const p = payload as MlBomEditPayload;
    if (p.op === 'makeDefault') return { isDefault: describeDefault(true, null) };
    const storedRevs =
      (target?.doc['storedRevs'] as Record<string, string | null> | undefined) ?? {};
    const out: Record<string, unknown> = {
      lines: summarizeMlBomLines(
        await canonProposedLines(tx, companyId, p.input.lines, storedRevs),
      ),
    };
    // Omitted remarks = not touched (reviseMlBomCore keeps the stored ones).
    if (p.input.remarks !== undefined) out['remarks'] = p.input.remarks?.trim() || null;
    return out;
  },

  buildFilteredInput(proposedPayload, approved, ctx) {
    const p = proposedPayload as MlBomEditPayload;
    if (p.op === 'makeDefault') return approved.has('isDefault') ? p : null;
    const remarks = approved.has('remarks');
    const lines = approved.has('lines');
    if (!remarks && !lines) return null;
    return {
      op: 'revise',
      remarks,
      lines,
      input: p.input,
      ...(p.requireRev === false ? { requireRev: false } : {}),
      // The requester's note rides with the FIRST applying decide only.
      revisionNote: ctx?.firstApply === false ? null : (p.input.revisionNote ?? null),
    };
  },

  async applyEdit(tx, companyId, id, filteredInput, expectedUpdatedAt, user) {
    const f = filteredInput as
      | { op: 'makeDefault' }
      | {
          op: 'revise';
          remarks: boolean;
          lines: boolean;
          input: UpdateMlBomInput;
          revisionNote: string | null;
          requireRev?: false;
        };
    // The engine resolved freshness under the locks loadForDiff took, so the
    // writer's own updated_at check must see the CURRENT token (a no-op match).
    const token = expectedUpdatedAt ?? undefined;
    if (f.op === 'makeDefault') {
      await makeDefaultMlBomTx(tx, companyId, id, { expectedUpdatedAt: token }, user);
      return;
    }

    const header = (
      await tx
        .select({ itemId: mlBoms.itemId })
        .from(mlBoms)
        .where(and(eq(mlBoms.id, id), eq(mlBoms.companyId, companyId), isNull(mlBoms.deletedAt)))
        .limit(1)
    )[0];
    if (!header) throw new NotFoundError(ML_BOM_NOT_FOUND);

    // Lines not approved → resubmit the CURRENT stored lines unchanged.
    const lines: MlBomLineInput[] = f.lines
      ? f.input.lines
      : (await loadStoredLines(tx, companyId, id)).map((l) => ({
          childItemId: l.childItemId,
          qtyPerSet: Number(l.qtyPerSet),
          bomType: l.bomType as MlBomLineInput['bomType'],
          rawMaterialGradeId: l.rawMaterialGradeId,
          rawMaterialGradeText: l.rawMaterialGradeText,
          rawMaterialSizeId: l.rawMaterialSizeId,
          rawMaterialSizeText: l.rawMaterialSizeText,
          remarks: l.remarks,
        }));

    const input: UpdateMlBomInput = {
      itemId: header.itemId,
      lines,
      revisionNote: f.revisionNote,
      expectedUpdatedAt: token,
    };
    if (f.remarks) input.remarks = f.input.remarks ?? null;
    await updateMlBomTx(tx, companyId, id, input, user, {
      requireRev: f.requireRev !== false,
    });
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: mlBoms.id, updatedAt: mlBoms.updatedAt })
      .from(mlBoms)
      .where(and(inArray(mlBoms.id, ids), eq(mlBoms.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
