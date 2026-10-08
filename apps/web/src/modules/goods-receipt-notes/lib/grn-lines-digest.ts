// ADR-225 / §20.4 — the GRN's received lines as ONE comparable value.
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
// would be dropped as "nothing changed". It therefore carries the item, the
// quantity, the vendor's challan reference and the line note for every line, in
// order. It opens with a plain-English count because it is also the value the
// 3-second notice prints when two people change the lines of one GRN.
//
// `itemName` is deliberately NOT in it. The screen has no Item Name box — a name
// only ever arrives with a picked item, which changes the code too — and the
// form seeds the name from the item master (`masterItemName`), so including it
// would report a change nobody made on every GRN whose master name has since
// been edited.

/** Both the SAVED line (GoodsReceiptNoteLineDetail) and the OUTGOING line
 *  (GoodsReceiptNoteLineInput) satisfy this, so one function digests both. */
export interface GrnDigestLine {
  itemId?: string | null | undefined;
  itemCodeText?: string | null | undefined;
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
    const parts = [`${Number(l.receivedQty)} × ${item}`];
    if (text(l.dcRefNo)) parts.push(`chln ${text(l.dcRefNo)}`);
    if (text(l.remarks)) parts.push(text(l.remarks));
    return parts.join(' ');
  });
  return `${rows.length} line${rows.length === 1 ? '' : 's'} · ${rows.join(' · ')}`;
}
