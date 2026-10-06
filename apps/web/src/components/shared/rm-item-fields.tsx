// Raw-material ITEM + qty per piece (ADR-193 phase 3a) — the SHAPE and the
// write converter only. ADR-217 removed the picker component that used to live
// here: raw material is authored on the Route Card and the BOM line, and the
// Route Card form carries its own control. The Plan was this component's only
// other caller and now displays the value instead of offering a picker.

export interface RmItemValue {
  rawMaterialItemId: string | null;
  rawMaterialItemCode: string | null;
  /** Kept as typed text while editing; converted by rmItemToInput. */
  rmQtyPerPiece: string;
}

export function rmItemToInput(v: RmItemValue): {
  rawMaterialItemId: string | null;
  rmQtyPerPiece: number | null;
} {
  const q = Number(v.rmQtyPerPiece);
  return {
    rawMaterialItemId: v.rawMaterialItemId,
    rmQtyPerPiece: v.rawMaterialItemId && v.rmQtyPerPiece.trim() !== '' && q > 0 ? q : null,
  };
}
