// ADR-235 — the plain sentences a Purchase Order Cancel answers with. Pure, so
// they are unit-tested without a database (cancel-text.unit.test.ts).

/** Screen word for a PO status (matches the web's po-labels.ts). */
export function poStatusWord(status: string): string {
  const words: Record<string, string> = {
    draft: 'Draft',
    open: 'Open',
    partial: 'Partly Received',
    qc_pending: 'QC Pending',
    closed: 'Closed',
    cancelled: 'Cancelled',
  };
  return words[status] ?? status;
}

/** "Ln 1, 3" — or null when the document names none of this PO's lines. */
function onLines(lineNos: string | null): string {
  return lineNos ? ` on Ln ${lineNos}` : '';
}

/** A live GRN against the PO. */
export function poGrnBlockReason(lineNos: string | null, qty: number): string {
  return lineNos
    ? `received ${qty}${onLines(lineNos)} — cancel that GRN first, or use Short Close`
    : 'raised against this PO — cancel that GRN first';
}

/** A live OSP Delivery Challan / JW DC Outward against the PO. */
export function poSentBlockReason(docLabel: string, lineNos: string | null, qty: number): string {
  return lineNos
    ? `sent ${qty}${onLines(lineNos)} to the vendor — cancel that ${docLabel} first`
    : `raised against this PO — cancel that ${docLabel} first`;
}

/** Received on the PO lines (by any route) — the PO can only be short closed. */
export function poPartReceivedReason(received: number, ordered: number): string {
  return `Part received (${received} of ${ordered}) — use Short Close`;
}

export const PO_CLOSED_REASON = 'already Closed — nothing left to cancel';

/** A PR line the cancel gives back. */
export function poPrReopenText(prCode: string, qty: number, poLineNo: number): string {
  return `${prCode}: ${qty} back to Pending (was PO Ln ${poLineNo})`;
}

/** One outsourced JC op the cancel releases — the state releaseJcOpsForCancelledPo leaves. */
export function poJcOpReleaseText(
  jcCode: string,
  opSr: number,
  operation: string | null,
  next: { otherPo: boolean; prCode: string | null },
): string {
  const op = `${jcCode} Op ${opSr}${operation ? ` ${operation}` : ''}`;
  if (next.otherPo) return `${op} — stays on its other purchase order`;
  if (next.prCode) return `${op} — back to PR Raised (${next.prCode}), ready for a new PO`;
  return `${op} — back to no PR; a fresh PR is needed`;
}

export function poCancelNote(poCode: string): string {
  return `${poCode} becomes Cancelled. Nothing was received or sent on it.`;
}
