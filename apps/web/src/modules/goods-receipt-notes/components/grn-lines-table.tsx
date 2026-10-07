// THE one GRN line table — create AND edit, all three inward types.
//
// Owner's layout rule 9 names this screen as its own bad example: "Line items
// are ALWAYS a table — never a stack of cards, one per line (GRN edit had 12
// fields in a bordered card per line)." So there is exactly ONE table and both
// screens render it, with the same columns in the same order (rule 8).
//
// Visible: Ln · POL · Item Code · Item Name · UOM · PO Qty · Received Earlier ·
// Received★ · To Receive · QC Status · ▸ · ✕. The per-line paperwork and the
// read-only quality facts sit behind `▸ More` (<GrnLineMore>), so the row never
// grows. Arithmetic and the row shape come from `grn-receipt-figures.ts`, the
// one leaf this file, the header's account and the view all read, so no two
// surfaces can state the same receipt differently.
//
// Two props vary the row by screen, and ONLY by screen.
//
// `showAccount` turns on the three account columns (PO Qty / Sent Qty ·
// Received Earlier · To Receive). It is on wherever the screen HAS the ordered
// figure this receipt was typed against, and off where it does not:
//
//   create, every type   ON. The figure is on the rows the form has just built
//                        from the picked source document — the PO line's qty on
//                        Against PO, the challan line's `Sent Qty` on the other
//                        two. Without it a clerk types `Received` blind and
//                        learns the limit only from the cap error.
//   edit, Against PO     ON, off the two read-only joins `poLineQty` and
//                        `poLineReceivedQty`.
//   edit / view, DC+NC   OFF. Those lines DO carry a `purchase_order_line_id`,
//                        so both joins come back populated — but the figure the
//                        clerk typed against was the CHALLAN line's `Sent Qty`,
//                        which no read response carries, and the PO line's qty
//                        is a different fact. Printing it under either label
//                        would contradict what was typed against. On a
//                        replacement (NC) GRN it is also wrong arithmetic: the
//                        API deliberately leaves that GRN's own receipt out of
//                        the PO line's received column until QC clears it, so
//                        `PO Qty − Received Earlier − Received` would understate
//                        by exactly that line's own Received.
//
// `item` turns the Item Code / Item Name cells into the shared LineItemPicker.
// It is passed by the EDIT screen on an Against-PO GRN only, because edit is
// where a mis-keyed receipt gets corrected. CREATE never passes it (its lines
// are built from the picked source document, and one editable control per row
// is the whole point there), and neither do the DC / NC types even on edit:
// those lines mirror a challan or an NC line, so the item is not the
// storekeeper's to retype.

import { Fragment, useState } from 'react';
import { LineItemPicker } from '@/components/shared/line-item-picker';
import { itemCodeWithRev } from '@/lib/item-code';
import { Cluster, ClusterFact } from '@/ui/forms';
import { GrnLineMore } from './grn-line-qc-facts';
import {
  type GrnLineRow,
  type ReceiptAccount,
  fmtQty,
  grnLinePending,
  grnReceiptTotals,
} from './grn-receipt-figures';
import { QcStatusBadge } from './qc-status-badge';

export interface GrnLinesTableProps {
  rows: GrnLineRow[];
  /** Header of the ordered-qty column: `PO Qty` on a purchase receipt, `Sent
   *  Qty` on a challan, where the figure is what WE sent out and calling it
   *  PO Qty would put one name over two facts (CLAUDE.md §18). Only read while
   *  `showAccount` is on. */
  qtyLabel?: string;
  /** Show the three account columns — the ordered qty, Received Earlier and
   *  To Receive. See the per-screen table at the top of this file. */
  showAccount?: boolean;
  emptyText: string;
  onReceiveNow: (idx: number, value: string) => void;
  onRemarks: (idx: number, value: string) => void;
  /** Make the item cells editable (edit screen, Against PO only). */
  item?: {
    onChange: (idx: number, next: { code: string; itemId: string | null; name: string }) => void;
  };
  /** The per-line Vendor Challan No. behind `▸ More`. The header's own number
   *  shows as the placeholder and is what the line saves with while its box is
   *  empty. Omitted on the challan types — their receive payload has no
   *  per-line challan field, so a box there would be typed and dropped. */
  challan?: { headerValue: string; onChange: (idx: number, value: string) => void };
  /** Take a line off this GRN (the source document is untouched). */
  onRemove?: (idx: number) => void;
  /** `Received` may be decimal (KGS / MTR, 3 places — 0172). */
  decimal?: boolean;
  /** Show the read-only Quality group behind `▸ More`. Edit only: a GRN being
   *  created has not been inspected yet, so there is nothing to show. */
  showQc?: boolean;
}

export function GrnLinesTable({
  rows,
  qtyLabel = 'PO Qty',
  showAccount = false,
  emptyText,
  onReceiveNow,
  onRemarks,
  item,
  challan,
  onRemove,
  decimal = false,
  showQc = false,
}: GrnLinesTableProps): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Ln · POL · Item Code · Item Name · UOM [· PO Qty · Received Earlier] ·
  // Received [· To Receive] · QC Status · ▸  (+ ✕ where a line can be removed).
  // The three bracketed columns are `showAccount`'s.
  const colCount = (showAccount ? 11 : 8) + (onRemove ? 1 : 0);
  // `received` is the COLUMN total, over every row — always knowable, so the
  // totals row can always foot the column the user is typing into. `account` is
  // null unless EVERY row has an ordered line behind it, and when it is not null
  // its own `received` is that same number. So the totals row foots `Received`
  // either way and states the other three only when the four of them are an
  // account that adds up (see `accountOf` in grn-receipt-figures.ts).
  const { received: receivedTotal, account } = grnReceiptTotals(rows);

  return (
    <div className="tbl-wrap">
      <table
        className="innovic-table tbl-grid tbl-edit"
        style={{ minWidth: showAccount ? 1000 : 760 }}
      >
        <thead>
          <tr>
            <th>Ln</th>
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <th>Item Code</th>
            <th className="th-left">Item Name</th>
            <th>UOM</th>
            {showAccount ? (
              <>
                <th className="th-num">{qtyLabel}</th>
                <th className="th-num">Received Earlier</th>
              </>
            ) : null}
            <th className="th-num">
              Received<span className="req">★</span>
            </th>
            {/* `To Receive`, not `Pending`. This column is what the line still
                has to ARRIVE: PO Qty − Received Earlier − Received. The PO
                screens' `Pending` is a different fact — PO Qty − Accepted (QC
                passed) — so a line can be 3 short on the PO and have nothing
                left to receive here. One fact, one name (NAMING.md). */}
            {showAccount ? <th className="th-num">To Receive</th> : null}
            <th>QC Status</th>
            <th aria-label="More" />
            {onRemove ? <th aria-label="Remove" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="empty-state">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((l, idx) => {
              const isOpen = open.has(l.key);
              const code = itemCodeWithRev(l.itemCode, l.itemRevision);
              const pending = grnLinePending(l);
              // Today's rule, kept exactly: the line's own challan no. and
              // remarks stay editable until QC is CLEARED (not merely started)
              // — the server accepts those two edits while `Received` is
              // already frozen.
              const paperLocked = l.qcStatus === 'completed';
              // The item is editable only where the screen offers it AND the
              // line is not frozen — the same condition as `Received` and the
              // ✕, so the three can never disagree (ADR-189).
              const itemEditable = Boolean(item) && l.locked !== true;
              return (
                <Fragment key={l.key}>
                  <tr>
                    <td className="mono fw-700">{idx + 1}</td>
                    {/* '—' when this line has no sales order behind it. */}
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {l.clientPoLineNo ?? '—'}
                    </td>
                    {/* The picker renders Item Code AND Item Name as one unit
                        (a code on the master auto-fills the name and locks it),
                        so where it is offered it takes both columns in one
                        cell. The <th>s above are unchanged either way. */}
                    {itemEditable && item ? (
                      <td colSpan={2} className="td-left td-ctl">
                        {/* A GRID, not a flex row: `.innovic-input` is
                            `width: 100%`, so each `.form-grp` must be given a
                            track to fill or the two boxes shrink to the width
                            of their own labels. */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(110px, 1fr) minmax(150px, 2fr)',
                            gap: 'var(--sp-2)',
                          }}
                        >
                          <LineItemPicker
                            code={l.itemCode}
                            itemId={l.itemId ?? null}
                            itemName={l.itemName}
                            {...(l.itemError ? { nameError: l.itemError } : {})}
                            onChange={(next) => item.onChange(idx, next)}
                          />
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="td-code" title={code}>
                          {code || '—'}
                        </td>
                        <td
                          className="td-left"
                          style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={l.itemName}
                        >
                          {l.itemName || '—'}
                        </td>
                      </>
                    )}
                    <td>{l.uom ? l.uom : <span className="text3">—</span>}</td>
                    {showAccount ? (
                      <>
                        <td className="mono td-num">
                          {l.qty === null ? <span className="text3">—</span> : fmtQty(l.qty)}
                        </td>
                        <td className="mono td-num">
                          {l.receivedEarlier === null ? (
                            <span className="text3">—</span>
                          ) : (
                            fmtQty(l.receivedEarlier)
                          )}
                        </td>
                      </>
                    ) : null}
                    <td className="td-num">
                      <input
                        type="number"
                        inputMode={decimal ? 'decimal' : 'numeric'}
                        min={0}
                        {...(l.pendingQty === undefined ? {} : { max: l.pendingQty })}
                        step={decimal ? 'any' : 1}
                        className="innovic-input cl-num"
                        style={{ minWidth: 88 }}
                        readOnly={l.locked === true}
                        value={l.receiveNow}
                        onChange={(e) => onReceiveNow(idx, e.target.value)}
                        aria-label={`Received, line ${idx + 1}`}
                      />
                      {l.error ? <div className="form-error">{l.error}</div> : null}
                    </td>
                    {showAccount ? (
                      <td className="mono td-num fw-700 green">
                        {pending === null ? <span className="text3">—</span> : fmtQty(pending)}
                      </td>
                    ) : null}
                    {/* The lock badge lives HERE, in the status cell, instead of
                        as a caption over the row (it was a card header before). */}
                    <td>
                      <QcStatusBadge status={l.qcStatus ?? 'pending'} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-expanded={isOpen}
                        onClick={() => toggle(l.key)}
                        title={
                          showQc
                            ? 'Line paperwork and what Incoming QC recorded'
                            : challan
                              ? 'Vendor Challan No. and Remarks for this line'
                              : 'Remarks for this line'
                        }
                      >
                        {isOpen ? '▾ Less' : '▸ More'}
                      </button>
                    </td>
                    {onRemove ? (
                      <td>
                        {/* A line Incoming QC has touched cannot be removed
                            (ADR-189) — the server refuses it, so the button is
                            not offered. */}
                        {l.locked === true ? null : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm red"
                            onClick={() => onRemove(idx)}
                            aria-label={`Remove line ${idx + 1}`}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td />
                      <td colSpan={colCount - 1} className="td-left">
                        <GrnLineMore
                          lineKey={l.key}
                          idx={idx}
                          remarks={l.remarks}
                          onRemarks={onRemarks}
                          dcRefNo={l.dcRefNo}
                          challan={challan}
                          paperLocked={paperLocked}
                          {...(showQc && l.qc ? { qc: l.qc } : {})}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
        {rows.length > 0 ? (
          <tfoot>
            <tr className="row-total fw-700">
              <td colSpan={5} className="td-left">
                Total — {rows.length} line{rows.length === 1 ? '' : 's'}
              </td>
              {showAccount ? (
                <>
                  <td className="mono td-num">
                    {account ? fmtQty(account.poQty) : <span className="text3">—</span>}
                  </td>
                  <td className="mono td-num">
                    {account ? fmtQty(account.earlier) : <span className="text3">—</span>}
                  </td>
                </>
              ) : null}
              <td className="mono td-num">{fmtQty(receivedTotal)}</td>
              {showAccount ? (
                <td className="mono td-num green">
                  {account ? fmtQty(account.pending) : <span className="text3">—</span>}
                </td>
              ) : null}
              <td colSpan={onRemove ? 3 : 2} />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** The header grid's `This receipt` row — THE account. It reads left to right
 *  and ends on the result, which carries the 3px green rule (`lead`). All four
 *  cells are read-only facts: the numbers are the lines' own, and the only way
 *  to change them is to type in the lines. The caller recomputes `account` from
 *  the live rows on every render, so the result never goes stale under the user
 *  (ClusterGrid pitfall 4).
 *
 *  The caller renders this ONLY where the screen has the ordered figure (see the
 *  per-screen table at the top of this file) and only when `grnReceiptTotals`
 *  returned a non-null account. So the four cells here always add up, and a
 *  screen that cannot state them shows one grid row fewer rather than a row of
 *  four dashes dressed up as an account.
 *
 *  The third cell is `Received` — the same word as the column header in the
 *  table below and as the view page's equivalent cell. `Receiving Now` was my
 *  invention and NAMING.md bans it. */
export function GrnReceiptAccount({
  account,
  qtyLabel = 'PO Qty',
}: {
  account: ReceiptAccount;
  qtyLabel?: string;
}): React.JSX.Element {
  return (
    <Cluster name="This receipt">
      <ClusterFact label={qtyLabel} num value={fmtQty(account.poQty)} />
      <ClusterFact label="Received Earlier" num value={fmtQty(account.earlier)} />
      <ClusterFact label="Received" num value={fmtQty(account.received)} />
      <ClusterFact label="To Receive" num lead value={fmtQty(account.pending)} />
    </Cluster>
  );
}
