// BOM Master audit rows (ADR-197) — the before → after lists an Edit writes.
//
// An edit replaces the BOM's lines wholesale, so the lines are matched by
// child item (a BOM lists each part once — assertNoDuplicateChildItems):
//   - a part only in the new list  → CREATE, `Line N` (its new line no.)
//   - a part only in the old list  → EDIT,   `Line N` (its old line no.), every
//                                     field going to empty ("line removed")
//   - a part in both, fields moved → EDIT,   `Line N`, only the moved fields
// The header row carries the header fields plus the BOM Rev bump. Labels are
// the BOM screen's own (docs/NAMING.md: `Qty per Set`, `BOM Rev`).

import { ActivityAction, type ActivityChange } from '@innovic/shared';
import { type DiffField, diffFields } from '../../lib/audit-trail';

export const BOM_TYPE_WORD: Record<string, string> = {
  manufacture: 'Manufacture',
  purchase: 'Buy',
  outsource: 'Outsource',
};

/** One BOM line as the log compares it (raw material by its printed text). */
export interface BomAuditLine {
  lineNo: number;
  childItemId: string;
  qtyPerSet: string | number;
  bomType: string;
  rawMaterialGradeText: string | null;
  rawMaterialSizeText: string | null;
}

export interface BomAuditHeader {
  bomNo: string;
  bomName: string;
  parentItemId: string | null;
  status: string;
  revision: number;
}

export interface BomLineAuditRow {
  action: typeof ActivityAction.Create | typeof ActivityAction.Edit;
  lineRef: string;
  changes: ActivityChange[];
  detail: string;
}

function codeFormatter(codeById: ReadonlyMap<string, string>) {
  return (v: unknown): string | null => (v ? (codeById.get(String(v)) ?? String(v)) : null);
}

function headerFields(codeById: ReadonlyMap<string, string>): DiffField[] {
  return [
    { key: 'bomNo', label: 'BOM No.' },
    { key: 'bomName', label: 'BOM Name' },
    { key: 'parentItemId', label: 'Parent Item', format: codeFormatter(codeById) },
    { key: 'status', label: 'BOM Status' },
    { key: 'revision', label: 'BOM Rev' },
  ];
}

function lineFields(codeById: ReadonlyMap<string, string>): DiffField[] {
  return [
    { key: 'childItemId', label: 'Item Code', format: codeFormatter(codeById) },
    { key: 'qtyPerSet', label: 'Qty per Set' },
    {
      key: 'bomType',
      label: 'BOM Type',
      format: (v) => (v ? (BOM_TYPE_WORD[String(v)] ?? String(v)) : null),
    },
    { key: 'rawMaterialGradeText', label: 'RM Grade' },
    { key: 'rawMaterialSizeText', label: 'RM Size' },
  ];
}

/** Header before → after, including the BOM Rev bump. */
export function bomHeaderChanges(
  before: BomAuditHeader,
  after: BomAuditHeader,
  codeById: ReadonlyMap<string, string>,
): ActivityChange[] {
  return diffFields(before, after, headerFields(codeById));
}

const EMPTY_LINE = {
  childItemId: null,
  qtyPerSet: null,
  bomType: null,
  rawMaterialGradeText: null,
  rawMaterialSizeText: null,
};

/** One row per added / removed / changed line. `null` in `after` is a real
 *  value to diffFields (only undefined is skipped), so EMPTY_LINE turns every
 *  filled field into "x → —". */
export function bomLineAuditRows(
  oldLines: readonly BomAuditLine[],
  newLines: readonly BomAuditLine[],
  codeById: ReadonlyMap<string, string>,
): BomLineAuditRow[] {
  const fields = lineFields(codeById);
  const oldByItem = new Map(oldLines.map((l) => [l.childItemId, l]));
  const newItems = new Set(newLines.map((l) => l.childItemId));
  const code = codeFormatter(codeById);
  const out: BomLineAuditRow[] = [];

  for (const nl of newLines) {
    const ol = oldByItem.get(nl.childItemId);
    if (!ol) {
      out.push({
        action: ActivityAction.Create,
        lineRef: `Line ${nl.lineNo}`,
        changes: diffFields(EMPTY_LINE, nl, fields),
        detail: `Line added: ${code(nl.childItemId) ?? ''}`,
      });
      continue;
    }
    const changes = diffFields(ol, nl, fields);
    if (changes.length > 0) {
      out.push({
        action: ActivityAction.Edit,
        lineRef: `Line ${nl.lineNo}`,
        changes,
        detail: `Line edited: ${code(nl.childItemId) ?? ''}`,
      });
    }
  }
  for (const ol of oldLines) {
    if (newItems.has(ol.childItemId)) continue;
    out.push({
      action: ActivityAction.Edit,
      lineRef: `Line ${ol.lineNo}`,
      changes: diffFields(ol, EMPTY_LINE, fields),
      detail: `Line removed: ${code(ol.childItemId) ?? ''}`,
    });
  }
  return out;
}
