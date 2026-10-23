// Multi-Level BOM edit-approval (ADR-249 Step B2) — the pure half: the one
// readable text a staged "BOM Lines" box shows, and the "Default" box text.
// No database here, so the unit test can pin both exactly.
//
// The "BOM Lines" text is ALSO the freshness key: the engine marks the box
// superseded when the text built from the CURRENT stored lines no longer
// equals the text captured at request time (document-edits/service.ts compares
// the stored `before`). So every fact a line save writes and a user can type is
// in it — order, child item, Qty per Set, Line Type, RM Grade, RM Size, Line
// Remarks. The sub-assembly link is NOT: the server resolves it from the child
// item's Default on every save, nobody types it.

import { BOM_LINE_TYPE_LABEL, type BomLineType } from '@innovic/shared';

/** One line in canonical form — stored row or proposed input, same shape. */
export interface MlBomCanonLine {
  childCode: string;
  /** Qty per Set as stored: 3 decimals (buildLineValues writes toFixed(3)). */
  qtyPerSet: string;
  bomType: string;
  rmGrade: string | null;
  rmSize: string | null;
  remarks: string | null;
}

const blank = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** "2.000" / 2 / "2" → "2"; "0.125" → "0.125". Same rounding the save uses. */
export function canonQty(v: string | number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(Number(n.toFixed(3)));
}

/** RM is kept on Manufacture lines only (lines.ts keepsRawMaterial). */
export function canonLine(l: MlBomCanonLine): MlBomCanonLine {
  const rm = l.bomType === 'manufacture';
  return {
    childCode: l.childCode,
    qtyPerSet: canonQty(l.qtyPerSet),
    bomType: l.bomType,
    rmGrade: rm ? blank(l.rmGrade) : null,
    rmSize: rm ? blank(l.rmSize) : null,
    remarks: blank(l.remarks),
  };
}

/**
 * "1. SHAFT-10 × 2 Manufacture [RM EN8 / 25 DIA]; 2. BRG-6204 × 4 Buy"
 * One entry per line, in line order (the order is saved, so it is compared).
 */
export function summarizeMlBomLines(lines: readonly MlBomCanonLine[]): string {
  if (lines.length === 0) return '(no lines)';
  return lines
    .map((raw, i) => {
      const l = canonLine(raw);
      const type = BOM_LINE_TYPE_LABEL[l.bomType as BomLineType] ?? l.bomType;
      const rm =
        l.rmGrade || l.rmSize ? ` [RM ${[l.rmGrade ?? '—', l.rmSize ?? '—'].join(' / ')}]` : '';
      const note = l.remarks ? ` "${l.remarks}"` : '';
      return `${i + 1}. ${l.childCode} × ${l.qtyPerSet} ${type}${rm}${note}`;
    })
    .join('; ');
}

/** The "Default" box: this BOM's flag, naming the BOM it would take over from,
 *  so a Default that moved to a THIRD BOM meanwhile reads as superseded. */
export function describeDefault(isDefault: boolean, otherDefaultCode: string | null): string {
  if (isDefault) return 'Yes';
  return otherDefaultCode ? `No — ${otherDefaultCode} is the Default` : 'No — no Default yet';
}
