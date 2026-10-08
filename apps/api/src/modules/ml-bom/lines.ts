// Multi-Level BOM (ADR-225) — turning the submitted lines into stored rows:
// raw material resolved from the masters, the sub-assembly link resolved to
// the child item's Default, and the revision snapshot.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { materialGrades, materialSizes, type mlBomLines } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import type { ItemsLookup } from './helpers';
import type { MlBomLineInput } from './schema';

interface RawMaterialLookup {
  gradeNames: Map<string, string>;
  sizeNames: Map<string, string>;
}

/** RM Grade / RM Size are kept on manufacture lines only — a Buy or Outsource
 *  line buys or sends out the part whole, so it has no raw material. */
const keepsRawMaterial = (l: MlBomLineInput): boolean => l.bomType === 'manufacture';

/**
 * Grade / size names keyed by id for every manufacture line, ONE query per
 * master (as BOM Master). A stale or foreign id is refused rather than stored.
 */
export async function loadRawMaterialNames(
  tx: DbTransaction,
  lines: readonly MlBomLineInput[],
  companyId: string,
): Promise<RawMaterialLookup> {
  const kept = lines.filter(keepsRawMaterial);
  const gradeIds = [
    ...new Set(kept.map((l) => l.rawMaterialGradeId).filter((v): v is string => !!v)),
  ];
  const sizeIds = [
    ...new Set(kept.map((l) => l.rawMaterialSizeId).filter((v): v is string => !!v)),
  ];

  const gradeNames = new Map<string, string>();
  if (gradeIds.length > 0) {
    const rows = await tx
      .select({ id: materialGrades.id, name: materialGrades.name })
      .from(materialGrades)
      .where(
        and(
          eq(materialGrades.companyId, companyId),
          inArray(materialGrades.id, gradeIds),
          isNull(materialGrades.deletedAt),
        ),
      );
    for (const r of rows) gradeNames.set(r.id, r.name);
    if (gradeIds.some((id) => !gradeNames.has(id))) {
      throw new ValidationError('An RM Grade on this BOM was not found in the Grade master');
    }
  }

  const sizeNames = new Map<string, string>();
  if (sizeIds.length > 0) {
    const rows = await tx
      .select({ id: materialSizes.id, name: materialSizes.name })
      .from(materialSizes)
      .where(
        and(
          eq(materialSizes.companyId, companyId),
          inArray(materialSizes.id, sizeIds),
          isNull(materialSizes.deletedAt),
        ),
      );
    for (const r of rows) sizeNames.set(r.id, r.name);
    if (sizeIds.some((id) => !sizeNames.has(id))) {
      throw new ValidationError('An RM Size on this BOM was not found in the Size master');
    }
  }
  return { gradeNames, sizeNames };
}

/** The stored rows for one BOM's lines. `defaults` = child item → its Default
 *  Multi-Level BOM (resolveDefaultBoms); only a manufacture line links it. */
export function buildLineValues(
  lines: readonly MlBomLineInput[],
  mlBomId: string,
  companyId: string,
  userId: string,
  rawMaterial: RawMaterialLookup,
  defaults: ReadonlyMap<string, string>,
): Array<typeof mlBomLines.$inferInsert> {
  return lines.map((l, i) => {
    const rm = keepsRawMaterial(l);
    const gradeId = rm ? (l.rawMaterialGradeId ?? null) : null;
    const sizeId = rm ? (l.rawMaterialSizeId ?? null) : null;
    return {
      companyId,
      mlBomId,
      lineNo: i + 1,
      childItemId: l.childItemId,
      qtyPerSet: l.qtyPerSet.toFixed(3),
      bomType: l.bomType,
      childMlBomId: l.bomType === 'manufacture' ? (defaults.get(l.childItemId) ?? null) : null,
      rawMaterialGradeId: gradeId,
      rawMaterialGradeText: !rm
        ? null
        : gradeId
          ? (rawMaterial.gradeNames.get(gradeId) ?? null)
          : l.rawMaterialGradeText?.trim() || null,
      rawMaterialSizeId: sizeId,
      rawMaterialSizeText: !rm
        ? null
        : sizeId
          ? (rawMaterial.sizeNames.get(sizeId) ?? null)
          : l.rawMaterialSizeText?.trim() || null,
      remarks: l.remarks?.trim() || null,
      createdBy: userId,
      updatedBy: userId,
    };
  });
}

/** The revision snapshot (shape = mlBomRevisionSchema.linesSnapshot). */
export function buildLinesSnapshot(
  values: ReadonlyArray<typeof mlBomLines.$inferInsert>,
  lookup: ItemsLookup,
): Array<{
  childItemId: string;
  childItemCode: string | null;
  qtyPerSet: string;
  bomType: string;
  childMlBomId: string | null;
}> {
  return values.map((v) => ({
    childItemId: v.childItemId,
    childItemCode: lookup.get(v.childItemId)?.code ?? null,
    qtyPerSet: v.qtyPerSet,
    bomType: v.bomType,
    childMlBomId: v.childMlBomId ?? null,
  }));
}
