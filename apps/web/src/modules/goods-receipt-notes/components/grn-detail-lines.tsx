// The GRN detail page's "Line Items" panel — the lines table, the per-line ▸
// and the totals row. Split out of `routes/detail.tsx` (2026-10-06) because
// that route had grown to 785 lines and CLAUDE.md §12 caps a file at 400: long
// files are unreviewable, and the header grid and the lines table are two
// separate things that happen to share a page.
//
// The table is the hand-rolled `innovic-table tbl-grid`, deliberately NOT the
// shared DataTable — converting it is a larger change of its own.
//
// What the ▸ holds is the point of the panel: `Inspected By`, `QC Remarks`,
// `QC Report`, the line's own `Remarks` and its `Vendor Challan No.` are
// returned by the API on every GRN and, before this, appeared on NO read-only
// surface anywhere — not this page, not the GRN list's expanded row, not the
// print. Three of them were visible on the edit screen only, greyed out. They
// are one-line facts on the same four-cell ClusterGrid the header uses, so
// reading them costs no columns.
//
// Quantities are formatted and totalled by `grn-receipt-figures.ts`, shared with
// the header panel so the account and this foot cannot round one number two
// ways.

import type { GoodsReceiptNoteLineDetail } from '@innovic/shared';
import { useState } from 'react';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { Cluster, ClusterFact, ClusterGrid } from '@/ui/forms';
import { fmtQty, grnLineTotals } from './grn-receipt-figures';
import { QcStatusBadge } from './qc-status-badge';

export function GrnDetailLines(props: {
  lines: readonly GoodsReceiptNoteLineDetail[];
  /** Against PO only: the `PO Qty` column. On an Against JW PO / DC or Against
   *  NC receipt the figure the clerk typed against is the challan's `Sent Qty`,
   *  not the purchase-order line's qty, and this response does not carry it —
   *  so the column is dropped rather than filled with the wrong fact. The page
   *  decides this (see its `againstPo`); the panel only obeys. */
  againstPo: boolean;
  /** Σ `PO Qty`, or null when the account is withheld although the column is
   *  shown (an Against-PO GRN with a hand-added line that traces to no PO
   *  line). Null prints `—` in the foot; the column still exists. */
  poQtyTotal: number | null;
}): React.JSX.Element {
  const { lines, againstPo, poQtyTotal } = props;
  // Which lines have their ▸ open. Ids, so adding or removing a line cannot
  // leave an index pointing at the wrong row.
  const [openLines, setOpenLines] = useState<ReadonlySet<string>>(() => new Set());

  const totals = grnLineTotals(lines);
  // 12 columns Against PO, 11 without `PO Qty`. Every colSpan below is counted
  // off this, so the two shapes cannot drift.
  const cols = againstPo ? 12 : 11;
  const allOpen = lines.length > 0 && openLines.size === lines.length;

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">Line Items ({lines.length})</div>
        {lines.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setOpenLines(allOpen ? new Set() : new Set(lines.map((l) => l.id)))}
          >
            {allOpen ? '▾ Collapse all' : '▸ Expand all'}
          </button>
        ) : null}
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Ln</th>
              {/* POL = the CUSTOMER's own PO line number, carried down from the
                  Sales Order line behind this receipt. */}
              <th style={{ color: 'var(--purple)' }}>POL</th>
              <th>Item Code</th>
              <th className="th-left">Item Name</th>
              <th>UOM</th>
              {againstPo ? <th className="th-num">PO Qty</th> : null}
              <th className="th-num">Received</th>
              <th>QC Status</th>
              <th className="th-num">Accepted</th>
              <th className="th-num">Deviated</th>
              <th>QC Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={cols} className="empty-state">
                  No lines on this GRN yet.
                </td>
              </tr>
            ) : (
              lines.map((l) => (
                <LineRow
                  key={l.id}
                  line={l}
                  showPoQty={againstPo}
                  cols={cols}
                  open={openLines.has(l.id)}
                  onToggle={() =>
                    setOpenLines((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(l.id)) next.add(l.id);
                      return next;
                    })
                  }
                />
              ))
            )}
          </tbody>
          {lines.length > 0 ? (
            <tfoot>
              <tr style={{ background: 'var(--bg4)' }}>
                <td colSpan={5} className="td-left" style={{ fontWeight: 700 }}>
                  Total — {lines.length} {lines.length === 1 ? 'line' : 'lines'}
                </td>
                {/* Keyed off `againstPo`, not off `poQtyTotal`: the column can be
                    rendered while the total is withheld, and the foot must have
                    as many cells as the head. */}
                {againstPo ? (
                  <td className="mono td-num fw-700">
                    {poQtyTotal == null ? <span className="text3">—</span> : fmtQty(poQtyTotal)}
                  </td>
                ) : null}
                <td className="mono td-num fw-700">{fmtQty(totals.received)}</td>
                <td />
                <td className="mono td-num fw-700" style={{ color: 'var(--green2)' }}>
                  {fmtQty(totals.accepted)}
                </td>
                <td className="mono td-num fw-700" style={{ color: 'var(--red2)' }}>
                  {fmtQty(totals.deviated)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function LineRow(props: {
  line: GoodsReceiptNoteLineDetail;
  showPoQty: boolean;
  /** Columns in the table, so the ▸ row spans exactly the row above it. */
  cols: number;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const { line: l, showPoQty, cols, open, onToggle } = props;
  return (
    <>
      <tr>
        <td className="mono">{l.lineNo}</td>
        {/* POL — the CUSTOMER's PO line number off the SO line behind this row. */}
        <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {l.clientPoLineNo ?? '—'}
        </td>
        {/* Item code is THE main thing — strong; CODE/REV (ADR-177). */}
        <td className="td-code">{itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision)}</td>
        {/* The item master's name; the saved copy is the print's (plan v3 Step 4). */}
        <td className="td-left">{l.masterItemName ?? l.itemName}</td>
        {/* UOM off the item master (A26); blank when the line has no item. */}
        <td className="mono">{l.uom ?? '—'}</td>
        {/* Ordered qty on the PO line behind this row. Against PO only: on a
            challan or NC receipt the clerk's figure is the challan's Sent Qty,
            not this. */}
        {showPoQty ? (
          <td className="mono td-num">
            {l.poLineQty == null ? <span className="text3">—</span> : fmtQty(l.poLineQty)}
          </td>
        ) : null}
        <td className="mono td-num fw-700">{fmtQty(l.receivedQty)}</td>
        <td>
          <QcStatusBadge status={l.qcStatus} />
        </td>
        <td className="mono td-num" style={{ color: 'var(--green2)' }}>
          {fmtQty(l.qcAcceptedQty)}
        </td>
        <td className="mono td-num" style={{ color: 'var(--red2)' }}>
          {fmtQty(l.qcRejectedQty)}
        </td>
        <td className="mono">{fmtDate(l.qcDate)}</td>
        <td>
          <button
            type="button"
            className="dt-exp"
            aria-expanded={open}
            title={open ? 'Hide this line’s QC detail' : 'Show this line’s QC detail'}
            onClick={onToggle}
          >
            {open ? '▾' : '▸'}
          </button>
        </td>
      </tr>
      {open ? <LineDetailRow line={l} cols={cols} /> : null}
    </>
  );
}

/** The five facts behind the ▸ — see the note at the top of this file for why
 *  they are the point of the panel. */
function LineDetailRow({
  line: l,
  cols,
}: {
  line: GoodsReceiptNoteLineDetail;
  cols: number;
}): React.JSX.Element {
  return (
    <tr>
      <td
        colSpan={cols}
        className="td-left"
        style={{ background: 'var(--bg3)', padding: 'var(--sp-1) var(--sp-3)' }}
      >
        <ClusterGrid>
          <Cluster>
            {/* The VENDOR's delivery paper for this line. Never `DC No.` — that
                name belongs to our own outward challan in the page header. */}
            <ClusterFact label="Vendor Challan No." empty={!l.dcRefNo} value={l.dcRefNo ?? '—'} />
            {/* The inspector's name as recorded on the day (the snapshot is the
                only name in this response; the link is a user id). */}
            <ClusterFact
              label="Inspected By"
              empty={!l.qcInspectedByText}
              title={l.qcInspectedByText ?? undefined}
              value={l.qcInspectedByText ?? '—'}
            />
            <ClusterFact
              label="QC Report"
              empty={!l.qcReportPath}
              value={
                l.qcReportPath ? <QcReportLink path={l.qcReportPath} name={l.qcReportName} /> : '—'
              }
            />
            <ClusterFact label="Remarks" wrap empty={!l.remarks} value={l.remarks ?? '—'} />
          </Cluster>
          <Cluster>
            <ClusterFact
              span={4}
              wrap
              label="QC Remarks"
              empty={!l.qcRemarks}
              value={l.qcRemarks ?? '—'}
            />
          </Cluster>
        </ClusterGrid>
      </td>
    </tr>
  );
}
