// Multi-Level BOM Excel import (ADR-225 phase 2) — the per-row checks and the
// master lookups behind them. One query per master for the whole file.
//
// Item codes match live items of the company ignoring case and surrounding
// spaces (items has a unique index on lower(code)). RM Grade / RM Size match
// the same Grade / Size masters the ml-bom lines store ids of, by name,
// ignoring case.

import { sql } from 'drizzle-orm';
import {
  BOM_LINE_TYPE_LABEL,
  BOM_LINE_TYPES,
  type BomLineType,
  type MlBomImportRow,
  qtyUomProblem,
} from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { tsLike } from './helpers';

export const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

export interface ImportItem {
  id: string;
  code: string;
  name: string;
  uom: string;
}

/** An item's live Default Multi-Level BOM, as the import reads it. */
export interface ExistingDefault {
  id: string;
  code: string;
  revision: number;
  /** ISO, milliseconds — handed to the revise as expectedUpdatedAt. */
  updatedAt: string;
}

/** One sheet row after its checks. Ids are null where the value did not resolve. */
export interface CheckedRow {
  rowNum: number;
  /** Grouping key of the BOM Item Code: the item id, else the typed code. */
  bomKey: string;
  /** Typed BOM Item Code, trimmed. */
  bomCode: string;
  bomItem: ImportItem | null;
  childItem: ImportItem | null;
  /** Typed child code, trimmed (for messages when the item did not resolve). */
  childCode: string;
  qty: number | null;
  bomType: BomLineType | null;
  gradeId: string | null;
  sizeId: string | null;
  remarks: string | null;
  errors: string[];
  warnings: string[];
}

const LINE_TYPE_WORDS: ReadonlyMap<string, BomLineType> = new Map([
  ...BOM_LINE_TYPES.map((t) => [t, t] as const),
  ...BOM_LINE_TYPES.map((t) => [BOM_LINE_TYPE_LABEL[t].toLowerCase(), t] as const),
  ['make', 'manufacture'],
]);

/** "Manufacture" / "Buy" / "Outsource", the stored code, or "Make" — any case. */
export function parseLineType(s: string): BomLineType | null {
  return LINE_TYPE_WORDS.get(norm(s)) ?? null;
}

const QTY_TEXT = /^(\d+(\.\d*)?|\.\d+)$/;

/** The Qty per Set problem, or null. Same rule as the ml-bom create
 *  (qtyUomProblem: whole-number unit refuses a fraction, at most 3 decimals). */
export function qtyProblem(
  text: string,
  uom: string | null,
): { qty: number | null; problem: string | null } {
  const t = text.trim();
  const n = QTY_TEXT.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return { qty: null, problem: 'Qty per Set must be a number greater than 0' };
  }
  const problem = qtyUomProblem(n, uom, 'Qty per Set');
  return { qty: problem ? null : n, problem };
}

const inList = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** Live items whose code matches, keyed by lower(trimmed code). */
export async function loadItemsByCode(
  tx: DbTransaction,
  companyId: string,
  codes: readonly string[],
): Promise<Map<string, ImportItem>> {
  const out = new Map<string, ImportItem>();
  const wanted = Array.from(new Set(codes.map(norm).filter((c) => c !== '')));
  if (wanted.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT id, code, name, uom
    FROM public.items
    WHERE company_id = ${companyId}::uuid
      AND deleted_at IS NULL
      AND lower(code) IN (${inList(wanted)})
  `)) as unknown as ImportItem[];
  for (const r of rows) out.set(norm(r.code), r);
  return out;
}

/** Live Grade / Size master rows whose name matches, keyed by lower(trimmed name). */
export async function loadMasterByName(
  tx: DbTransaction,
  companyId: string,
  table: 'material_grades' | 'material_sizes',
  names: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = Array.from(new Set(names.map(norm).filter((c) => c !== '')));
  if (wanted.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT id, name FROM ${sql.identifier('public')}.${sql.identifier(table)}
    WHERE company_id = ${companyId}::uuid
      AND deleted_at IS NULL
      AND lower(btrim(name)) IN (${inList(wanted)})
    ORDER BY name, id
  `)) as unknown as Array<{ id: string; name: string }>;
  for (const r of rows) if (!out.has(norm(r.name))) out.set(norm(r.name), r.id);
  return out;
}

/** item id → its live Default Multi-Level BOM. */
export async function loadExistingDefaults(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Map<string, ExistingDefault>> {
  const out = new Map<string, ExistingDefault>();
  const unique = Array.from(new Set(itemIds));
  if (unique.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT id, code, revision, updated_at, item_id
    FROM public.ml_boms
    WHERE company_id = ${companyId}::uuid
      AND is_default
      AND deleted_at IS NULL
      AND item_id IN (${sql.join(
        unique.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
  `)) as unknown as Array<{
    id: string;
    code: string;
    revision: number;
    updated_at: unknown;
    item_id: string;
  }>;
  for (const r of rows) {
    out.set(r.item_id, {
      id: r.id,
      code: r.code,
      revision: Number(r.revision),
      updatedAt: tsLike(r.updated_at),
    });
  }
  return out;
}

const blank = (s: string | null | undefined): boolean => norm(s) === '';

/**
 * The checks one row can fail on its own (blank columns, unknown item, Qty,
 * Line Type, RM Grade / Size, own item). Cross-row checks (same child twice,
 * Buy over a BOM, revise, loops) are added by the caller.
 */
export function checkRow(
  row: MlBomImportRow,
  itemsByCode: ReadonlyMap<string, ImportItem>,
  grades: ReadonlyMap<string, string>,
  sizes: ReadonlyMap<string, string>,
): CheckedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bomCode = row.bomItemCode.trim();
  const childCode = row.childItemCode.trim();

  if (blank(bomCode)) errors.push('BOM Item Code is blank');
  if (blank(childCode)) errors.push('Child Item Code is blank');
  if (blank(row.qtyPerSet)) errors.push('Qty per Set is blank');
  if (blank(row.lineType)) errors.push('Line Type is blank');

  const bomItem = bomCode ? (itemsByCode.get(norm(bomCode)) ?? null) : null;
  if (bomCode && !bomItem) errors.push(`Item ${bomCode} is not in Item Master`);
  const childItem = childCode ? (itemsByCode.get(norm(childCode)) ?? null) : null;
  if (childCode && !childItem) errors.push(`Item ${childCode} is not in Item Master`);
  if (bomItem && childItem && bomItem.id === childItem.id) {
    errors.push('A BOM cannot contain its own item');
  }

  let qty: number | null = null;
  if (!blank(row.qtyPerSet)) {
    const q = qtyProblem(row.qtyPerSet, childItem?.uom ?? null);
    if (q.problem) errors.push(q.problem);
    qty = q.qty;
  }

  let bomType: BomLineType | null = null;
  if (!blank(row.lineType)) {
    bomType = parseLineType(row.lineType);
    if (!bomType) errors.push('Line Type must be Manufacture, Buy or Outsource');
  }

  let gradeId: string | null = null;
  let sizeId: string | null = null;
  const gradeText = (row.rawMaterialGrade ?? '').trim();
  const sizeText = (row.rawMaterialSize ?? '').trim();
  if (bomType && bomType !== 'manufacture') {
    if (gradeText || sizeText) {
      warnings.push(`RM Grade / RM Size ignored on a ${BOM_LINE_TYPE_LABEL[bomType]} line`);
    }
  } else {
    if (gradeText) {
      gradeId = grades.get(norm(gradeText)) ?? null;
      if (!gradeId) errors.push(`RM Grade ${gradeText} is not in the Grade master`);
    }
    if (sizeText) {
      sizeId = sizes.get(norm(sizeText)) ?? null;
      if (!sizeId) errors.push(`RM Size ${sizeText} is not in the Size master`);
    }
  }

  return {
    rowNum: row.rowNum,
    bomKey: bomItem ? bomItem.id : `?${norm(bomCode)}`,
    bomCode,
    bomItem,
    childItem,
    childCode,
    qty,
    bomType,
    gradeId,
    sizeId,
    remarks: row.remarks?.trim() || null,
    errors,
    warnings,
  };
}
