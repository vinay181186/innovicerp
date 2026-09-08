// How much of a Purchase Request is still to order (ADR-152, Phase 1 + 2).
//
// A PR for 100 that gets a PO for 10 has 90 LEFT. Every screen used to ask the
// BOOLEAN question "does this PR have a PO?" (`poId !== null` / `status ===
// 'po_created'`), which answered "yes" after that first PO and hid the other 90
// from the buyer for good. The balance replaces that question everywhere.
//
// The two numbers are the server's (`orderedQty` / `balanceQty` on
// PurchaseRequest — a SUM over live purchase order lines that the browser
// cannot compute for itself). They are read through this helper rather than off
// the row for one reason: web and API deploy separately, so a browser can hold
// a build newer than the API for a few minutes and get rows without the fields.
// Reading them raw would print "undefined" and turn every subtraction into NaN;
// here a missing field falls back to "nothing ordered yet", which is exactly
// what those rows meant before the fields existed.
//
// Phase 2 adds the CLOSED state. A buyer who ordered 10 of 100 and knows the
// other 90 is not coming short-closes the balance: the request still records
// that 100 was asked for, because that is what happened, and separately that 90
// was abandoned and why. That is deliberately NOT an edit of `qty` down, and it
// is not "fully ordered" either — a closed PR must read as finished ON PURPOSE.

/** Read shape this helper needs — the list row and the detail row both satisfy
 *  it. The fields are optional HERE only to survive an API that has not been
 *  deployed yet; the contract has them required. */
export interface PrBalanceSource {
  qty: number;
  orderedQty?: number | undefined;
  balanceQty?: number | undefined;
  /** Set when the remaining balance was short-closed (0117). */
  balanceClosedAt?: string | null | undefined;
  balanceClosedReason?: string | null | undefined;
}

/** open  — nothing on a purchase order yet.
 *  partial — some ordered, some still to order.
 *  full  — the whole requested qty is on a purchase order.
 *  closed — the buyer stopped expecting the rest. Some was ordered, the
 *          remainder was formally abandoned with a reason.
 *  over  — MORE is on order than was requested. Never normal; the screens shout
 *          about it instead of clamping the balance to zero and hiding it. */
export type PrBalanceState = 'open' | 'partial' | 'full' | 'over' | 'closed';

export interface PrOrderBalance {
  qty: number;
  ordered: number;
  /** qty − ordered. Zero once the balance is short-closed (the server reports
   *  it as 0 too). Negative when the PR has been over-ordered. */
  balance: number;
  state: PrBalanceState;
  /** Plain-English wording used on the card, the list and the detail page. */
  label: string;
  /** True once the remainder was formally abandoned. */
  closed: boolean;
  /** How much was abandoned by the short-close — qty − ordered at that moment.
   *  0 when the PR is not closed. This is the number the buyer needs to see:
   *  "90 not ordered" is the whole point of the state. */
  closedQty: number;
  closedAt: string | null;
  closedReason: string | null;
}

function toNum(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function prOrderBalance(pr: PrBalanceSource): PrOrderBalance {
  const qty = toNum(pr.qty, 0);
  const ordered = toNum(pr.orderedQty, 0);
  const closedAt = pr.balanceClosedAt ?? null;
  const closed = closedAt !== null;
  // What WOULD still be outstanding if nothing had been closed. Used for the
  // over-ordered test and for the abandoned quantity, because the server
  // deliberately reports `balanceQty` as 0 on a closed PR.
  const rawBalance = qty - ordered;
  // A closed PR has nothing left to order, whatever an older API sends back.
  // The min() keeps an over-ordered PR negative so it still shouts.
  const balance = closed ? Math.min(0, rawBalance) : toNum(pr.balanceQty, rawBalance);
  // Over-ordering is a data problem that has to be visible even on a closed
  // PR, so it outranks every other state.
  const state: PrBalanceState =
    rawBalance < 0
      ? 'over'
      : closed
        ? 'closed'
        : ordered <= 0
          ? 'open'
          : balance <= 0
            ? 'full'
            : 'partial';
  const label =
    state === 'over'
      ? 'Over-ordered'
      : state === 'closed'
        ? 'Balance closed'
        : state === 'full'
          ? 'Fully ordered'
          : state === 'partial'
            ? 'Partly ordered'
            : 'Open';
  return {
    qty,
    ordered,
    balance,
    state,
    label,
    closed,
    closedQty: closed ? Math.max(0, rawBalance) : 0,
    closedAt,
    closedReason: pr.balanceClosedReason ?? null,
  };
}

/** Token colour per state — amber waiting, blue part-done, green done, red
 *  wrong, grey deliberately finished. Same meanings the status badge already
 *  carries elsewhere on these screens. */
export function prBalanceColor(state: PrBalanceState): string {
  if (state === 'full') return 'var(--green)';
  if (state === 'partial') return 'var(--blue)';
  if (state === 'over') return 'var(--red)';
  // Grey, NOT green: a short-closed request was not completed, it was stopped.
  if (state === 'closed') return 'var(--text3)';
  return 'var(--amber)';
}

/** Pill class for the shared `.badge` — same five colours as prBalanceColor. */
export function prBalanceBadgeClass(state: PrBalanceState): string {
  if (state === 'full') return 'b-green';
  if (state === 'partial') return 'b-blue';
  if (state === 'over') return 'b-red';
  if (state === 'closed') return 'b-grey';
  return 'b-amber';
}

/** "Balance closed — 90 not ordered". The one phrasing for a short-closed PR,
 *  used on the card and the detail page so both read the same. */
export function prBalanceClosedText(bal: PrOrderBalance): string {
  return `Balance closed — ${bal.closedQty} of ${bal.qty} not ordered`;
}

/** "90 of 100 left" — the one phrasing used in the PR picker's dropdown and
 *  anywhere else a single line has to say how much may still be ordered. */
export function prBalanceText(pr: PrBalanceSource): string {
  const bal = prOrderBalance(pr);
  if (bal.closed) return prBalanceClosedText(bal);
  return `${bal.balance} of ${bal.qty} left`;
}
