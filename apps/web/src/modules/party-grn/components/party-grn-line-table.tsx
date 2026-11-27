// The line table of the Party GRN detail page (ADR-294) — one row per received
// customer-material line with its Incoming QC split. Moved here from the old
// row-expand panel (party-grn-expand.tsx, removed with ADR-294) unchanged.

import type { PartyGrnLine } from '@innovic/shared';
import { fmtDateTime } from '@/lib/date';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { PGRN_QC_BADGE, pgrnQcLabel, pgrnQcState, qcPendingQtyOf } from '../lib/qc-state';

export function partyGrnLineColumns(): DataTableColumn<PartyGrnLine>[] {
  return [
    {
      id: 'line_no',
      header: 'Ln',
      kind: 'num',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (l) => l.lineNo,
    },
    {
      // POL — the customer's PO line number on the JWSO line (ADR-236).
      id: 'client_po_line_no',
      header: 'POL',
      kind: 'code',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--purple)' }}>{l.clientPoLineNo ?? '—'}</span>,
    },
    {
      id: 'party_material',
      header: 'Customer RM',
      kind: 'code',
      nowrap: true,
      render: (l) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {l.rmItemCode ?? l.partyMaterialCodeText}
        </span>
      ),
    },
    {
      id: 'party_material_name',
      header: 'Customer RM Name',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (l) => l.rmItemName ?? l.partyMaterialName ?? '—',
      title: (l) => l.rmItemName ?? l.partyMaterialName ?? '',
    },
    {
      id: 'jwso_line',
      header: 'JWSO Line',
      kind: 'code',
      className: 'mono',
      nowrap: true,
      render: (l) => (
        <span style={{ color: 'var(--purple)' }}>
          {l.jwLineNoText ? `L${l.jwLineNoText}` : '—'}
        </span>
      ),
    },
    {
      id: 'received_qty',
      header: 'Received Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      className: 'mono',
      nowrap: true,
      render: (l) => l.receivedQty,
    },
    {
      id: 'accepted_qty',
      header: 'Accepted Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      className: 'mono fw-700',
      nowrap: true,
      // Part QC (0233): the real figure once anything is accepted; a dash
      // only while nothing has been (an untouched line, or all deviated).
      render: (l) =>
        l.acceptedQty > 0 ? (
          <span style={{ color: 'var(--green2)' }}>{l.acceptedQty}</span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'rejected_qty',
      header: 'Deviated Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--red)',
      className: 'mono',
      nowrap: true,
      render: (l) => (
        <span style={{ color: l.rejectedQty > 0 ? 'var(--red2)' : 'var(--text3)' }}>
          {l.rejectedQty > 0 ? l.rejectedQty : '—'}
        </span>
      ),
    },
    {
      // ADR-203 (owner D3): rejected pieces already sent back to the customer.
      id: 'rejected_returned_qty',
      header: 'Deviated Returned Qty',
      kind: 'num',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (l) => (l.rejectedQty > 0 ? l.rejectedReturnedQty : '—'),
    },
    {
      // Part QC (0233): the server's qcPendingQty, still to inspect.
      id: 'qc_pending_qty',
      header: 'QC Pending',
      kind: 'num',
      align: 'right',
      headColor: 'var(--amber)',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => {
        const n = qcPendingQtyOf(l);
        return n > 0 ? n : <span className="text3">—</span>;
      },
    },
    {
      id: 'reject_reason',
      header: 'Deviation Reason',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (l) => l.rejectReason ?? '—',
      title: (l) => l.rejectReason ?? '',
    },
    {
      // What the inspector wrote at Incoming QC, on any line (NAMING.md).
      id: 'qc_remarks',
      header: 'QC Remarks',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (l) => l.qcRemarks?.trim() || '—',
      title: (l) => l.qcRemarks ?? '',
    },
    {
      // ADR-203: Incoming QC is a separate step. Who did it is in the History tab.
      // Part QC (0233): "Part QC · n pending" + the last QC date.
      id: 'qc_at',
      header: 'QC At',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      render: (l) => {
        const st = pgrnQcState(l);
        if (st === 'done') return l.qcAt ? fmtDateTime(l.qcAt) : 'QC done';
        return (
          <>
            <span className={`badge ${PGRN_QC_BADGE[st]}`}>
              {pgrnQcLabel(st, qcPendingQtyOf(l))}
            </span>
            {st === 'partial' && l.qcAt ? ` ${fmtDateTime(l.qcAt)}` : null}
          </>
        );
      },
    },
  ];
}

/** ADR-324 — which line-level undo the ⋯ of a Party GRN line opens. */
export type PartyGrnLineUndo = 'party_grn_line_qc' | 'party_grn_line';

/** ADR-324 — the ⋯ of one Party GRN line: "Reverse QC" (back to Waiting QC)
 *  and "Remove line" (off a saved GRN). The screen only greys an item out for
 *  a reason it can already see; the Cancel dialog's preview shows the
 *  server's own blockers, and the server re-checks everything. */
export function partyGrnLineMenu(
  l: PartyGrnLine,
  ctx: {
    /** Incoming QC Edit tick (effectiveFormPerms 'qc_incoming'). */
    canReverseQc: boolean;
    /** Party GRN Edit tick (effectiveFormPerms 'party_create'). */
    canRemoveLine: boolean;
    /** Live (not removed) lines on this GRN. */
    liveLineCount: number;
    open: (kind: PartyGrnLineUndo, line: PartyGrnLine) => void;
  },
): RowMenuItem[] {
  const removed = l.deletedAt != null;
  const qcTouched = l.acceptedQty + l.rejectedQty > 0;
  return [
    {
      key: 'reverse-qc',
      label: 'Reverse QC',
      icon: 'refresh-cw',
      hidden: removed || !ctx.canReverseQc,
      disabledReason: qcTouched ? undefined : 'no QC on it',
      onSelect: () => ctx.open('party_grn_line_qc', l),
    },
    {
      key: 'remove-line',
      label: 'Remove line',
      icon: 'trash-2',
      group: 'danger',
      hidden: removed || !ctx.canRemoveLine,
      disabledReason: qcTouched
        ? 'QC done — reverse QC first'
        : ctx.liveLineCount <= 1
          ? 'only line — Cancel the GRN instead'
          : undefined,
      onSelect: () => ctx.open('party_grn_line', l),
    },
  ];
}
