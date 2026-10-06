// The close ledger (ADR-179): every partial close and every reversal, newest
// first. Each real close can be REVERSED — that writes a compensating stock-out
// and a reversal row (never deletes). A reversal row is shown as "Reversal of …"
// and cannot itself be reversed; a close already undone by a reversal offers no
// Reverse close item. Reverse close is the red ⋯ item; it opens
// ReverseReasonDialog, where the reason is REQUIRED (the server refuses a blank
// one, ADR-197) and is sent as `remarks`. A server refusal (pieces already
// dispatched, plan over-cover) shows inside that dialog.

import type { ProductionOrderClose, ProductionOrderDetail } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { RowMenu } from '@/ui/data';
import { useReverseProductionOrderClose } from '../api';
import { ReverseReasonDialog } from './reverse-reason-dialog';

interface PoCloseLedgerProps {
  po: ProductionOrderDetail;
  /** True when the user may reverse a close: edit right AND the order is not
   *  short closed (the server's rule). False → no ⋯ column at all. */
  canReverse: boolean;
  /** Inside a filling tab panel (the Production Order detail page): the table's
   *  `.tbl-wrap` is handed straight to the panel body so it takes the height
   *  left on screen and scrolls inside it, and the POL · CODE/REV band is left
   *  out — that page already says both in its identity line. The Close page
   *  leaves this off and keeps the band. */
  fill?: boolean | undefined;
}

export function PoCloseLedger({
  po,
  canReverse,
  fill = false,
}: PoCloseLedgerProps): React.JSX.Element {
  const reverseMut = useReverseProductionOrderClose();
  // The close whose "Reverse close?" dialog is open.
  const [askClose, setAskClose] = useState<ProductionOrderClose | null>(null);

  // Which original closes have already been undone → no Reverse close item for them.
  const reversedIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of po.closes) if (c.isReversal && c.reversesCloseId) s.add(c.reversesCloseId);
    return s;
  }, [po.closes]);

  // For a reversal row, describe the close it undoes.
  const byId = useMemo(() => {
    const m = new Map<string, ProductionOrderClose>();
    for (const c of po.closes) m.set(c.id, c);
    return m;
  }, [po.closes]);

  if (po.closes.length === 0) {
    return (
      <div className="empty-state" style={{ fontSize: 12 }}>
        Nothing closed yet.
      </div>
    );
  }

  // Meta band — whose pieces these closes belong to. POL is the line number
  // printed on the CUSTOMER's own purchase order, shown before the item code;
  // '—' when no sales order sits behind this order.
  const band = fill ? null : (
    <div
      className="mono"
      style={{
        fontSize: 11,
        color: 'var(--text3)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        marginBottom: 8,
      }}
    >
      <span>
        POL{' '}
        <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{po.clientPoLineNo ?? '—'}</span>
      </span>
      <span>·</span>
      <span className="td-code" style={{ color: 'var(--text)' }}>
        {itemCodeWithRev(po.itemCodeText, po.itemRevision)}
      </span>
    </div>
  );

  const body = (
    <>
      {band}
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Close Date</th>
              <th className="th-num">Close Qty</th>
              <th>Closed By</th>
              <th>Remarks</th>
              <th>Reversed</th>
              {canReverse ? <th style={{ width: 48 }} aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {po.closes.map((c) => {
              const reversedOriginal =
                c.isReversal && c.reversesCloseId ? byId.get(c.reversesCloseId) : undefined;
              const alreadyReversed = reversedIds.has(c.id);
              const showReverse = canReverse && !c.isReversal && !alreadyReversed;
              return (
                <tr key={c.id}>
                  <td className="mono">{fmtDate(c.closedAt)}</td>
                  <td className="mono fw-700 td-num" style={{ color: 'var(--text)' }}>
                    {c.isReversal ? `−${c.qty}` : c.qty}
                    {c.lostQty ? (
                      <span className="text3" style={{ fontSize: 11 }}>
                        {' '}
                        (+{c.lostQty} lost)
                      </span>
                    ) : null}
                  </td>
                  <td>{c.closedByName ?? '—'}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span title={c.remarks ?? undefined}>{c.remarks ?? '—'}</span>
                  </td>
                  <td>
                    {c.isReversal ? (
                      <span className="badge b-red" title="Reverses an earlier close">
                        Reversal
                        {reversedOriginal ? ` of ${reversedOriginal.qty}` : ''}
                      </span>
                    ) : alreadyReversed ? (
                      <span className="badge b-grey">Reversed</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  {canReverse ? (
                    <td className="td-ctr">
                      <RowMenu
                        items={[
                          {
                            key: 'reverse',
                            label: 'Reverse close',
                            icon: 'refresh-cw',
                            group: 'danger',
                            hidden: !showReverse,
                            disabledReason: reverseMut.isPending ? 'Reversing…' : undefined,
                            onSelect: () => setAskClose(c),
                          },
                        ]}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {askClose ? (
        <ReverseReasonDialog
          title={`Reverse close of ${askClose.qty} on ${fmtDate(askClose.closedAt)}?`}
          onCancel={() => setAskClose(null)}
          onConfirm={async (remarks) => {
            await reverseMut.mutateAsync({ id: po.id, input: { closeId: askClose.id, remarks } });
            setAskClose(null);
          }}
        />
      ) : null}
    </>
  );

  // `fill`: a fragment, so `.tbl-wrap` is a direct child of the panel body —
  // the fill chain (innovic-theme.css "LIST FILL") only reaches it there.
  return fill ? body : <div>{body}</div>;
}
