// ADR-226 / §20.4 — the GRN's received lines as ONE comparable value.
//
// Why a single value and not a per-field diff: the GRN update treats an ABSENT
// `lines` key as "leave the lines alone" (service.ts: `if (input.lines !==
// undefined) await mergeLines(...)`), and `mergeLines` soft-deletes any saved
// line the payload omits. So the lines are all-or-nothing — a line can be added
// with `+ Add Line` and removed with the row's ✕, so there is no stable partial
// payload to send. They therefore behave like one field: either this user
// touched the lines or they did not.
//
// That is also exactly what `useEditConflict` needs. The hook refuses a save
// whose diff is empty ("Nothing changed on this GRN"), and the most ordinary GRN
// edit of all — correcting a Received Qty, with no header change — would hit
// that and never save. Putting this one value under the record's `lines` key
// makes a lines-only edit a real change, while a header-only edit leaves the
// lines out of the request entirely.
//
// The digest must move whenever anything the screen can edit moves, or an edit
// would be dropped as "nothing changed". It therefore carries the line's own
// identity, the item, the NAME, the quantity, the vendor's challan reference and
// the line note for every line, in order. It opens with a plain-English count
// because it is also the value the 3-second notice prints when two people change
// the lines of one GRN.
//
// `itemName` IS in it, and the first version of this file was wrong to leave it
// out. The claim was "the screen has no Item Name box". It has one: the shared
// LineItemPicker renders the name read-only ONLY while the typed code is on the
// Item Master, and as a REAL INPUT otherwise — which is every hand-added line
// (`+ Add Line`) and every unlocked line of an Against-PO GRN. The payload
// carries the name, the service writes it (`if (u.data.itemName !== undefined)`)
// and the service's own change test compares it unconditionally, so a
// storekeeper fixing "Mild Steeel Bar" to "MS Round Bar 20mm" was told "Nothing
// changed on this GRN" and the wrong name stayed on the document and its print.
//
// The false-change risk the old comment worried about is real but is handled by
// reading the name the way the FORM seeds it — `masterItemName ?? itemName`
// (goods-receipt-note-form.tsx `detailToFormValues`). On an on-master line the
// master's live name is both what the box shows and what the digest holds, so a
// master rename cannot report a change nobody made; on an off-master line there
// is no master name and both sides read the line's own.

/** Both the SAVED line (GoodsReceiptNoteLineDetail) and the OUTGOING line
 *  (GoodsReceiptNoteLineInput) satisfy this, so one function digests both. */
export interface GrnDigestLine {
  /** The saved line's row id. Absent on a line the user has just added. */
  id?: string | null | undefined;
  itemId?: string | null | undefined;
  itemCodeText?: string | null | undefined;
  /** The line's saved name copy. The OUTGOING line always carries it. */
  itemName?: string | null | undefined;
  /** The item master's live name, present on the SAVED line only — exactly what
   *  the form seeds the Item Name box from. */
  masterItemName?: string | null | undefined;
  receivedQty: number | string;
  dcRefNo?: string | null | undefined;
  remarks?: string | null | undefined;
}

function text(v: string | null | undefined): string {
  return v?.trim() ?? '';
}

export function grnLinesDigest(lines: readonly GrnDigestLine[]): string {
  const rows = lines.map((l) => {
    // The form sends a code when it has one and an id otherwise — read them in
    // that order so the two shapes digest the same way.
    const item = text(l.itemCodeText) || text(l.itemId) || '—';
    // LINE IDENTITY, same rule as jc-ops-digest's `o.id ?? 'new'`: without it,
    // removing one line and adding another with the same item, qty, challan and
    // note digests identically, so the save is refused as "nothing changed"
    // while the GRN really does hold a different set of lines.
    const parts = [`${l.id ?? 'new'} ${Number(l.receivedQty)} × ${item}`];
    // Read as the form seeds it, so the live master name is on both sides.
    const name = text(l.masterItemName ?? l.itemName);
    if (name) parts.push(name);
    if (text(l.dcRefNo)) parts.push(`chln ${text(l.dcRefNo)}`);
    if (text(l.remarks)) parts.push(text(l.remarks));
    return parts.join(' ');
  });
  return `${rows.length} line${rows.length === 1 ? '' : 's'} · ${rows.join(' · ')}`;
}
