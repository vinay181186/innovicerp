// Multi-Level BOM Excel import (ADR-225 phase 2) — THE rule set. One
// function, validateImport, answers both the Preview (dryRun: true) and the
// Import (dryRun: false, re-run inside the save transaction under the tree
// lock). Every problem of every row is collected; nothing stops at the first.

import {
  BOM_LINE_TYPE_LABEL,
  type MlBomImportBom,
  type MlBomImportInput,
  type MlBomImportResult,
  type MlBomImportRowResult,
  type MlBomLineInput,
} from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { type GraphLine, checkFileGraph } from './import-graph';
import {
  type CheckedRow,
  type ExistingDefault,
  type ImportItem,
  checkRow,
  loadExistingDefaults,
  loadItemsByCode,
  loadMasterByName,
  norm,
} from './import-rows';
import { type TreeLine, buildImportTree } from './import-tree';

/** One BOM the save will write — only built when the whole file is ok. */
export interface BomPlan {
  item: ImportItem;
  existing: ExistingDefault | null;
  lines: MlBomLineInput[];
}

export interface ImportValidation {
  result: MlBomImportResult;
  /** Sheet order (first appearance of the BOM Item Code). Empty unless ok. */
  plans: BomPlan[];
}

/** The same child twice under one BOM Item Code → an error on EVERY such row. */
function markDuplicateChildren(checked: CheckedRow[]): void {
  const groups = new Map<string, CheckedRow[]>();
  for (const c of checked) {
    if (!c.bomCode || !c.childCode) continue;
    const key = `${c.bomKey}|${c.childItem?.id ?? `?${norm(c.childCode)}`}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    for (const c of g) {
      const others = g.filter((o) => o !== c).map((o) => o.rowNum);
      const child = c.childItem?.code ?? c.childCode;
      const bom = c.bomItem?.code ?? c.bomCode;
      c.errors.push(
        `${child} is also on row ${others.join(', ')} under ${bom} — a BOM lists a part only once`,
      );
    }
  }
}

export async function validateImport(
  tx: DbTransaction,
  companyId: string,
  input: MlBomImportInput,
): Promise<ImportValidation> {
  const rows = input.rows;
  const itemsByCode = await loadItemsByCode(
    tx,
    companyId,
    rows.flatMap((r) => [r.bomItemCode, r.childItemCode]),
  );
  const grades = await loadMasterByName(
    tx,
    companyId,
    'material_grades',
    rows.map((r) => r.rawMaterialGrade ?? ''),
  );
  const sizes = await loadMasterByName(
    tx,
    companyId,
    'material_sizes',
    rows.map((r) => r.rawMaterialSize ?? ''),
  );
  const checked = rows.map((r) => checkRow(r, itemsByCode, grades, sizes));

  const itemsById = new Map<string, ImportItem>();
  for (const it of itemsByCode.values()) itemsById.set(it.id, it);
  const defaults = await loadExistingDefaults(tx, companyId, [...itemsById.keys()]);

  markDuplicateChildren(checked);

  // The file's BOMs, in sheet order, and the links the loop / depth check walks.
  const graph = new Map<string, GraphLine[]>();
  for (const c of checked) {
    if (!c.bomItem) continue;
    const lines = graph.get(c.bomItem.id) ?? [];
    graph.set(c.bomItem.id, lines);
    if (c.childItem && c.bomType && c.childItem.id !== c.bomItem.id) {
      lines.push({ childItemId: c.childItem.id, bomType: c.bomType });
    }
  }
  const hasBom = (itemId: string): boolean => graph.has(itemId) || defaults.has(itemId);

  for (const c of checked) {
    // Decision 9: a Buy / Outsource line ignores the child's own BOM.
    if (c.bomType && c.bomType !== 'manufacture' && c.childItem && hasBom(c.childItem.id)) {
      c.warnings.push(
        `${c.childItem.code} has its own BOM — ignored because the line says ` +
          BOM_LINE_TYPE_LABEL[c.bomType],
      );
    }
    // Decision 7: an item with a live Default gets a new revision of it.
    const d = c.bomItem ? defaults.get(c.bomItem.id) : undefined;
    if (c.bomItem && d) {
      c.warnings.push(
        `${c.bomItem.code} already has ${d.code} — import makes BOM Rev ${d.revision + 1}`,
      );
    }
  }

  const codeOf = new Map<string, string>();
  for (const it of itemsById.values()) codeOf.set(it.id, it.code);
  const fileErrors = await checkFileGraph(tx, companyId, graph, defaults, codeOf);

  // Tree preview from the rows that passed every check.
  const treeFile = new Map<string, TreeLine[]>();
  for (const itemId of graph.keys()) treeFile.set(itemId, []);
  for (const c of checked) {
    if (c.errors.length > 0 || !c.bomItem || !c.childItem || !c.bomType || c.qty === null) {
      continue;
    }
    treeFile.get(c.bomItem.id)?.push({ child: c.childItem, qty: c.qty, bomType: c.bomType });
  }
  const { tree, levels } = await buildImportTree(tx, companyId, {
    fileBoms: treeFile,
    itemsById,
    defaults,
  });

  const boms: MlBomImportBom[] = [];
  for (const itemId of graph.keys()) {
    const item = itemsById.get(itemId)!;
    const existing = defaults.get(itemId) ?? null;
    const own = checked.filter((c) => c.bomItem?.id === itemId);
    boms.push({
      itemCode: item.code,
      itemName: item.name,
      action: existing ? 'revise' : 'create',
      code: existing?.code ?? null,
      revision: existing ? existing.revision + 1 : 1,
      lineCount: own.length,
      subAssemblyCount: own.filter(
        (c) => c.bomType === 'manufacture' && c.childItem && hasBom(c.childItem.id),
      ).length,
    });
  }

  const rowResults: MlBomImportRowResult[] = checked.map((c) => ({
    rowNum: c.rowNum,
    status: c.errors.length > 0 ? 'error' : c.warnings.length > 0 ? 'warning' : 'ok',
    messages: [...c.errors, ...c.warnings],
  }));
  const ok = fileErrors.length === 0 && checked.every((c) => c.errors.length === 0);

  const plans: BomPlan[] = [];
  if (ok) {
    for (const itemId of graph.keys()) {
      plans.push({
        item: itemsById.get(itemId)!,
        existing: defaults.get(itemId) ?? null,
        lines: checked
          .filter((c) => c.bomItem?.id === itemId)
          .map((c) => ({
            childItemId: c.childItem!.id,
            qtyPerSet: c.qty!,
            bomType: c.bomType!,
            rawMaterialGradeId: c.gradeId,
            rawMaterialSizeId: c.sizeId,
            remarks: c.remarks,
          })),
      });
    }
  }

  return {
    result: {
      dryRun: input.dryRun,
      ok,
      saved: false,
      rows: rowResults,
      fileErrors,
      boms,
      tree,
      levels,
    },
    plans,
  };
}
