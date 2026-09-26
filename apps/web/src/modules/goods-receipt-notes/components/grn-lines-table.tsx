// The line table shared by the three GRN create types (Against PO, Against
// JW PO / DC, Against NC). Before this file each form carried its own copy of
// the same 9–10 column table; the create-page layout (ERPNext gap report
// 2026-09-26) caps a line table at 8 visible data columns, so the less-used
// per-line text (Vendor Challan No., Remarks) moves into a "▸ More" detail row
// under the line — the way ERPNext's grid opens a row for editing.
//
// Visible: Ln · POL · Item Code · Item Name · Qty · Received · Pending ·
// Receive Now — with a totals row underneath. Numbers are right-aligned
// (th-num / td-num).

import { Fragment, useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';

export interface GrnLineRow {
  key: string;
  clientPoLineNo: string | null;
  itemCode: string;
  itemRevision: string | null;
  itemName: string;
  /** PO qty (Against PO) or sent qty (challan types). */
  qty: number;
  receivedSoFar: number;
  balance: number;
  receiveNow: string;
  remarks: string;
  error: string | null;
  /** Against PO only — the line's own Vendor Challan No. */
  dcRefNo?: string;
}

export interface GrnLinesTableProps {
  rows: GrnLineRow[];
  /** Header of the ordered/sent qty column: "Qty" or "Sent Qty". */
  qtyLabel: string;
  emptyText: string;
  onReceiveNow: (idx: number, value: string) => void;
  onRemarks: (idx: number, value: string) => void;
  /** Against PO only: the per-line Vendor Challan No. field in "▸ More". The
   *  header's Vendor Challan No. shows as the placeholder and is what the line
   *  saves with while its own box stays empty. */
  challan?: { headerValue: string; onChange: (idx: number, value: string) => void };
  /** Against PO only: take a line off this GRN (the PO is untouched). */
  onRemove?: (idx: number) => void;
}

function num(raw: string): number {
  const n = Number(raw.trim() || '0');
  return Number.isFinite(n) ? n : 0;
}

export function GrnLinesTable({
  rows,
  qtyLabel,
  emptyText,
  onReceiveNow,
  onRemarks,
  challan,
  onRemove,
}: GrnLinesTableProps): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 8 data columns + the ▸ More toggle (+ Delete on Against PO).
  const colCount = 9 + (onRemove ? 1 : 0);
  const totals = rows.reduce(
    (t, r) => ({
      qty: t.qty + r.qty,
      received: t.received + r.receivedSoFar,
      balance: t.balance + r.balance,
      now: t.now + num(r.receiveNow),
    }),
    { qty: 0, received: 0, balance: 0, now: 0 },
  );

  return (
    <div className="tbl-wrap">
      <table className="innovic-table" style={{ width: '100%', minWidth: 900 }}>
        <thead>
          <tr>
            <th>Ln</th>
            {/* POL = the CUSTOMER's own PO line number off the SO line behind
                this line. */}
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th className="th-num">{qtyLabel}</th>
            <th className="th-num">Received</th>
            <th className="th-num">Pending</th>
            <th className="th-num">
              Receive Now<span className="req">★</span>
            </th>
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
              return (
                <Fragment key={l.key}>
                  <tr>
                    <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {idx + 1}
                    </td>
                    {/* '—' when this line has no sales order behind it. */}
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {l.clientPoLineNo ?? '—'}
                    </td>
                    <td
                      className="mono fw-700"
                      style={{
                        color: 'var(--text)',
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={itemCodeWithRev(l.itemCode, l.itemRevision)}
                    >
                      {itemCodeWithRev(l.itemCode, l.itemRevision)}
                    </td>
                    <td
                      style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={l.itemName}
                    >
                      {l.itemName || '—'}
                    </td>
                    <td className="mono td-num">{l.qty}</td>
                    <td className="mono td-num">{l.receivedSoFar}</td>
                    <td className="mono td-num fw-700">{l.balance}</td>
                    <td className="td-num">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={l.balance}
                        step={1}
                        className="innovic-input fw-700"
                        style={{ color: 'var(--cyan)', minWidth: 90 }}
                        value={l.receiveNow}
                        onChange={(e) => onReceiveNow(idx, e.target.value)}
                        aria-label={`Receive now, line ${idx + 1}`}
                      />
                      {l.error ? <div className="form-error">{l.error}</div> : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-expanded={isOpen}
                        onClick={() => toggle(l.key)}
                        title={
                          challan
                            ? 'Vendor Challan No. and Remarks for this line'
                            : 'Remarks for this line'
                        }
                      >
                        {isOpen ? '▾ Less' : '▸ More'}
                      </button>
                    </td>
                    {onRemove ? (
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red2)' }}
                          onClick={() => onRemove(idx)}
                          aria-label={`Remove line ${idx + 1}`}
                        >
                          Delete
                        </button>
                      </td>
                    ) : null}
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={colCount} style={{ background: 'var(--bg2)' }}>
                        <div className="form-grid-12" style={{ textAlign: 'left' }}>
                          {challan ? (
                            <div className="form-grp f-lg">
                              <label className="form-label" htmlFor={`dcRef-${l.key}`}>
                                Vendor Challan No.
                              </label>
                              <input
                                id={`dcRef-${l.key}`}
                                className="innovic-input"
                                autoComplete="off"
                                value={l.dcRefNo ?? ''}
                                placeholder={challan.headerValue || undefined}
                                onChange={(e) => challan.onChange(idx, e.target.value)}
                              />
                              {challan.headerValue && !(l.dcRefNo ?? '').trim() ? (
                                <div className="form-help">
                                  Saves as the header&apos;s {challan.headerValue} unless changed.
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className={`form-grp ${challan ? 'f-lg' : 'f-full'}`}>
                            <label className="form-label" htmlFor={`remarks-${l.key}`}>
                              Remarks
                            </label>
                            <input
                              id={`remarks-${l.key}`}
                              className="innovic-input"
                              autoComplete="off"
                              value={l.remarks}
                              onChange={(e) => onRemarks(idx, e.target.value)}
                            />
                          </div>
                        </div>
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
            <tr className="fw-700">
              <td colSpan={4}>Total</td>
              <td className="mono td-num">{totals.qty}</td>
              <td className="mono td-num">{totals.received}</td>
              <td className="mono td-num">{totals.balance}</td>
              <td className="mono td-num" style={{ color: 'var(--cyan)' }}>
                {totals.now}
              </td>
              <td colSpan={onRemove ? 2 : 1} />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
