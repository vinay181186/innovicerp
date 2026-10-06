// The GRN receipt's SHAPE and its ARITHMETIC — the one leaf every GRN surface
// points at. No JSX, no hooks, no local imports, so nothing here can pull a
// panel in behind it.
//
// It exists because the same figures are read on five surfaces that must agree
// to the decimal: the create screens' header account, the edit screen's, the
// view's, the line table's `Pending` column and that table's totals row. When
// each had its own sum they could disagree — and they DID: the view's
// `receiptAccount` withheld the account if any line lacked a PO line while the
// forms' `grnReceiptTotals` skipped those lines and rendered anyway, so one GRN
// showed an account on Edit and none on Detail. Two private `r3`s on top of
// that: the two-writers fault (CLAUDE.md §20.1) applied to a displayed number.
//
// THE ONE RULE, written once in `accountOf` below and now obeyed everywhere:
// a GRN line belongs to the receipt account only when it traces to a
// purchase-order line, and the account is shown only when EVERY line does.
// Anything less is not an account — see the note on `accountOf`.

import { type GoodsReceiptNoteLineDetail, type GrnQcStatus, qtyUomProblem } from '@innovic/shared';

/** Received / Accepted / Deviated may be decimal for KGS / MTR (3 places, 0172);
 *  NOS / SET stay whole, so a whole number still prints without a point. ONE
 *  formatter for every quantity on every GRN surface. */
export const fmtQty = (n: number): string =>
  n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Quantities are summed before they are shown, and 0.1 + 0.2 is not 0.3 in
 *  binary — round at the 3 places the column itself stores. */
export const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A `Received` box's text as a number. Blank and half-typed both read 0. */
export function num(raw: string): number {
  const n = Number(raw.trim() || '0');
  return Number.isFinite(n) ? n : 0;
}

/**
 * One line's `Received` check, in the words the user reads. Null = fine.
 *
 * ONE copy. It was written out four times — once per create type and once on
 * the edit screen — and the four had already drifted: two said "Receive Now" in
 * the unit message while the field above them said `Received`, one hand-rolled
 * its own decimal test instead of asking the UOM rule, and only the edit one
 * treated a blank box as an error. Same shape as §20.1: one rule, one writer.
 *
 * The three rules, all of which the server enforces again:
 *   - a number;
 *   - decimals follow the UNIT (whole pieces for NOS / SET, else 3 places —
 *     0172 / S9, via the shared `qtyUomProblem`);
 *   - not more than `cap`, the qty that line still has to receive.
 *
 * `blankIsZero` is the one real difference between the screens and it is
 * deliberate: on CREATE an empty box means "not receiving this line", and the
 * form drops the row on submit; on EDIT the line already exists, so an empty box
 * is a missing answer, not an opt-out.
 */
export function grnReceivedError(
  raw: string,
  opts: { uom?: string | null; cap?: number | undefined; blankIsZero?: boolean } = {},
): string | null {
  const t = String(raw ?? '').trim();
  if (t === '') return opts.blankIsZero === false ? 'Received is required.' : null;
  const n = Number(t);
  const unitProblem = qtyUomProblem(n, opts.uom ?? null, 'Received');
  if (unitProblem) return unitProblem;
  if (n < 0) return 'Received cannot be less than 0.';
  if (opts.cap !== undefined && n > opts.cap) {
    return `Received cannot be more than the ${opts.cap} still to receive.`;
  }
  return null;
}

// ─── The row the GRN line table is handed ──────────────────────────────────

/** What Incoming QC recorded against a saved line. Read-only everywhere else
 *  (ADR-189 — the GRN shows what was inspected and never sets it). It lives
 *  beside `GrnLineRow` because `GrnLineRow.qc` IS this shape; the component
 *  that renders it is `grn-line-qc-facts.tsx`. */
export interface GrnLineQcFacts {
  acceptedQty: number;
  rejectedQty: number;
  qcDate: string | null;
  inspectedBy: string | null;
  qcRemarks: string | null;
  qcReportName: string | null;
}

/** One row of the GRN line table, as every GRN screen hands it over. */
export interface GrnLineRow {
  key: string;
  /** POL — the CUSTOMER's own PO line number off the SO line behind this line. */
  clientPoLineNo: string | null;
  /** The code the row SHOWS (live master code when linked, else the snapshot),
   *  and the value the item picker edits where editing is offered. */
  itemCode: string;
  itemRevision: string | null;
  itemName: string;
  /** Resolved Item Master id, or null for an off-master line. Only read where
   *  the item is editable (`GrnLinesTableProps.item`). */
  itemId?: string | null | undefined;
  /** Validation message under the editable Item Name. */
  itemError?: string | null | undefined;
  /** The item's unit (items.uom), its own column beside the quantities. */
  uom?: string | null;
  /** `PO Qty` (a purchase GRN) or `Sent Qty` (a challan) — the ordered figure
   *  this receipt is typed against; see `qtyLabel`. Null when the row traces to
   *  no such line, which then prints as a dash and takes the whole account out
   *  (see `accountOf`). */
  qty: number | null;
  /** `Received Earlier` — what arrived on OTHER receipts against that same
   *  line. Null on the same rows as `qty`. */
  receivedEarlier: number | null;
  /** The receive cap for this row (`max` on the box). Undefined = no cap this
   *  screen can know; the server still enforces its own. */
  pendingQty?: number | undefined;
  /** `Received` on THIS GRN — the row's one editable quantity. Text, so a
   *  half-typed value never snaps to 0 under the user. */
  receiveNow: string;
  /** The line's own Vendor Challan No., behind `▸ More` (needs `challan`). */
  dcRefNo?: string | undefined;
  remarks: string;
  error: string | null;
  /** Saved QC status — the badge in the QC Status cell. Defaults to `pending`,
   *  which is what a line being typed now is. */
  qcStatus?: GrnQcStatus | undefined;
  /** Incoming QC has inspected this line (ADR-189): `Received` and the item are
   *  read-only and the row cannot be removed. */
  locked?: boolean | undefined;
  /** The read-only Quality group behind `▸ More` (edit only). */
  qc?: GrnLineQcFacts | undefined;
}

// ─── The account ───────────────────────────────────────────────────────────

export interface ReceiptAccount {
  poQty: number;
  earlier: number;
  received: number;
  pending: number;
}

/**
 * THE receipt account: `PO Qty − Received Earlier − Received = Pending`.
 *
 * `Pending` is the registered name for this arithmetic (NAMING.md, "Qty still
 * owed") and the name the GRN line table already used. `Balance` is banned
 * (owner decision 2026-10-06).
 *
 * **Null unless EVERY line traces to an ordered line.** One line without one
 * (a hand-added line on an edited GRN, typed against no PO line) and there is
 * no account to state: its `Received` is on screen in the column the user is
 * typing into, so leaving it out of the sum makes the `Received` cell disagree
 * with the column, and putting it in makes `PO Qty − Earlier − Received` stop
 * adding up. Both are a row presented as arithmetic that does not add, which is
 * the one thing a receipt must never do — so the account is withheld instead,
 * and the caller says why. Nothing is hidden: the per-line figures and the
 * `Received` column total are shown either way.
 *
 * Whether the account is RELEVANT at all is the screen's call, not this
 * function's — a saved DC / NC GRN carries its PO line's qty but was typed
 * against the challan's `Sent Qty`, which no read response carries.
 */
function accountOf(
  items: readonly { poQty: number | null; earlier: number | null; received: number }[],
): ReceiptAccount | null {
  if (items.length === 0) return null;
  if (items.some((i) => i.poQty === null || i.earlier === null)) return null;
  const poQty = r3(items.reduce((s, i) => s + (i.poQty ?? 0), 0));
  const earlier = r3(items.reduce((s, i) => s + (i.earlier ?? 0), 0));
  const received = r3(items.reduce((s, i) => s + i.received, 0));
  return { poQty, earlier, received, pending: r3(poQty - earlier - received) };
}

/** The account of a SAVED GRN, off the API's own line shape — the view's entry
 *  point. Same rule, same arithmetic, same rounding as the forms': they are two
 *  mappings onto one `accountOf`. */
export function receiptAccount(
  lines: readonly GoodsReceiptNoteLineDetail[],
): ReceiptAccount | null {
  return accountOf(
    lines.map((l) => ({
      poQty: l.poLineQty ?? null,
      earlier: l.poLineReceivedQty ?? null,
      received: l.receivedQty,
    })),
  );
}

/** `Pending` for one row — `PO Qty − Received Earlier − Received`, or null when
 *  the row has no ordered line behind it, so nobody can state it. */
export function grnLinePending(l: GrnLineRow): number | null {
  if (l.qty === null) return null;
  return r3(l.qty - (l.receivedEarlier ?? 0) - num(l.receiveNow));
}

export interface GrnReceiptTotals {
  /** The `Received` COLUMN total, over every row. Always knowable, so the
   *  totals row can always foot the column the user is typing into. */
  received: number;
  /** The four account figures, or null — see `accountOf`. When it is non-null
   *  its `received` and the column total above are the same number. */
  account: ReceiptAccount | null;
}

/** The figures a GRN FORM shows: the `Received` column total, plus the account
 *  when there is one. The edit screen's account and the view's now come out of
 *  the same `accountOf`, so one GRN can no longer read two ways. */
export function grnReceiptTotals(rows: readonly GrnLineRow[]): GrnReceiptTotals {
  return {
    received: r3(rows.reduce((s, l) => s + num(l.receiveNow), 0)),
    account: accountOf(
      rows.map((l) => ({
        poQty: l.qty,
        earlier: l.receivedEarlier,
        received: num(l.receiveNow),
      })),
    ),
  };
}

// ─── The view's line-table totals ──────────────────────────────────────────

export interface GrnLineTotals {
  received: number;
  accepted: number;
  deviated: number;
}

/** The view's lines table column totals, summed once. Its receipt account does
 *  NOT read `received` from here any more — `receiptAccount` owns all four of
 *  its own terms, which is what stopped three of them obeying one rule and the
 *  fourth another. */
export function grnLineTotals(lines: readonly GoodsReceiptNoteLineDetail[]): GrnLineTotals {
  return {
    received: r3(lines.reduce((s, l) => s + l.receivedQty, 0)),
    accepted: r3(lines.reduce((s, l) => s + l.qcAcceptedQty, 0)),
    deviated: r3(lines.reduce((s, l) => s + l.qcRejectedQty, 0)),
  };
}
