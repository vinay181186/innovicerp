// ADR-235 — the plain sentences a Purchase Request Cancel answers with. Pure,
// so they are unit-tested without a database (cancel-text.unit.test.ts).

/** Why a live PO line blocks cancelling the PR it was raised from. A
 *  short-closed PO still holds what it RECEIVED (ADR-189), so it is named with
 *  that figure; the PO itself can no longer be cancelled then. */
export function prOrderedBlockReason(lineNo: number, qty: number, poShortClosed: boolean): string {
  return poShortClosed
    ? `Ln ${lineNo} received ${qty} before the PO was short closed — use Close Balance`
    : `Ln ${lineNo} ordered ${qty} — cancel that PO first, or use Close Balance`;
}

/** An older PR (before 0103) linked to its PO on the header only: the system
 *  reads it as fully ordered (purchase-requests deriveOrderedQty). */
export function prHeaderLinkBlockReason(qty: number): string {
  return `ordered ${qty} (older PR, linked on the PO header) — use Close Balance`;
}

/** A PR whose balance was short closed is already ended. */
export const PR_BALANCE_CLOSED_REASON = 'balance already Short Closed — nothing left to cancel';

/** One JC op the cancel hands back (ADR-101 release). */
export function prJcOpReleaseText(jcCode: string, opSr: number, operation: string | null): string {
  const op = operation ? ` ${operation}` : '';
  return `${jcCode} Op ${opSr}${op} — freed from this PR; it can take a fresh PR or be changed`;
}

export function prCancelNote(prCode: string): string {
  return `${prCode} becomes Cancelled and leaves the PO form's PR list. Nothing was ordered on it.`;
}

/** Screen word for a PR status (matches the web's pr-labels.ts). */
export function prStatusWord(status: string): string {
  const words: Record<string, string> = {
    open: 'Open',
    approved: 'Approved',
    po_created: 'PO Created',
    cancelled: 'Cancelled',
  };
  return words[status] ?? status;
}
