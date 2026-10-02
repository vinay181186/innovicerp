// SO Master expand — a COMPONENT order's line items, revealed under its row.
// Moved out of routes/list.tsx (ADR-199 split). The line table with a ⋯ per
// line (Edit line · Delete line), and a line delete that re-sends the surviving
// lines through the one update mutation, carrying the SO's updatedAt so the
// server refuses it when the SO changed since this panel loaded.

import type { SalesOrderDetail, SalesOrderLine, SalesOrderLineInput } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { useSession } from '@/lib/session';
import { RowMenu } from '@/ui/data';
import { ConfirmDialog } from '@/ui/feedback';
import {
  ItemBadge,
  ItemThumbnailCell,
  ItemThumbnailHeader,
  THUMBNAIL_COL_WIDTH,
} from '@/components/shared/item-badge';
import { useUpdateSalesOrder } from '../api';
import { REASON_REQUIRED_MESSAGE, ReasonField } from './reason-field';
import { SoStatusBadge } from './so-status-badge';
import { SoLineShortClosedBadge } from './so-fulfilment-badge';

// Map a read line back to the update-input shape, preserving identity (id +
// itemId) so mergeLines updates it in place rather than recreating it.
export function lineToInput(l: SalesOrderLine): SalesOrderLineInput {
  return {
    id: l.id,
    ...(l.itemId ? { itemId: l.itemId } : {}),
    ...(l.itemCodeText ? { itemCodeText: l.itemCodeText } : {}),
    partName: l.partName,
    ...(l.material ? { material: l.material } : {}),
    ...(l.drawingNo ? { drawingNo: l.drawingNo } : {}),
    // Carried through unconditionally. Rev is compulsory on the input shape, and
    // this path is a line DELETE from the list — it re-sends the surviving lines
    // untouched, so dropping the Rev here would blank it on every line of the SO
    // as a side effect of removing one. Falls back to '0', the value every line
    // held before anyone typed one, so a line that somehow stored a blank still
    // satisfies the required field instead of failing the whole save.
    revision: l.revision || '0',
    uom: l.uom,
    orderQty: l.orderQty,
    rate: Number(l.rate) || 0,
    ...(l.dueDate ? { dueDate: l.dueDate } : {}),
    ...(l.clientPoLineNo ? { clientPoLineNo: l.clientPoLineNo } : {}),
    status: l.status,
  };
}

export function ComponentSoExpand({
  so,
  canEdit,
}: {
  so: SalesOrderDetail;
  canEdit: boolean;
}): React.JSX.Element {
  const update = useUpdateSalesOrder(so.id);
  const { data: me } = useSession();
  // PATCH /sales-orders/:id is admin-only on the server (requireAdminRole) on
  // top of so_create edit, so the line ⋯ is shown only to an admin editor.
  const canEditLines = canEdit && me?.role === 'admin';
  // Line delete asks through ConfirmDialog, not window.confirm. Same update
  // call as before: re-send the surviving lines.
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);
  const [lineDeleteReason, setLineDeleteReason] = useState('');
  const onDeleteLine = (lineId: string): void => {
    setLineDeleteReason('');
    setDeletingLineId(lineId);
  };
  const deletingLine = so.lines.find((l) => l.id === deletingLineId) ?? null;
  return (
    <div style={{ padding: '8px 12px 8px 36px' }}>
      {/* Preview header. The row no longer navigates, so the preview carries its
          own way through to the full record — same route the SO code uses. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--blue)',
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            letterSpacing: '0.06em',
          }}
        >
          Line Items
        </div>
        <Link
          to="/sales-orders/$id"
          params={{ id: so.id }}
          style={{ fontSize: 11, color: 'var(--blue)' }}
          onClick={(e) => e.stopPropagation()}
        >
          Open full detail →
        </Link>
      </div>
      {/* tbl-ctr — the table-alignment standard: data centred, headers untouched.
          Fixed column widths: each expanded order draws its own lines table, and
          auto-sized columns put the Item column — and its picture box — at a
          slightly different x per order. Fixed, the box lines up down the page. */}
      <table
        className="innovic-table tbl-ctr"
        style={{ width: '100%', margin: 0, tableLayout: 'fixed' }}
      >
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: THUMBNAIL_COL_WIDTH }} />
          <col style={{ width: canEditLines ? '29%' : '33%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
          {canEditLines ? <col style={{ width: '4%' }} /> : null}
        </colgroup>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            {/* Item = thumbnail · CODE/REV · part name in one badge cell (user
                decision 2026-09-21); the old Item Code + Part Name pair folded in. */}
            <th>Ln</th>
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <ItemThumbnailHeader />
            <th style={{ textAlign: 'left' }}>Item</th>
            <th className="th-num">Order Qty</th>
            <th className="th-num">JC Qty</th>
            <th className="th-num" style={{ color: 'var(--green2)' }}>
              Dispatched
            </th>
            <th className="th-num" style={{ color: 'var(--red2)' }}>
              Pending
            </th>
            <th>Due Date</th>
            <th>SO Status</th>
            {canEditLines ? <th aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {so.lines.length === 0 ? (
            <tr>
              <td colSpan={canEditLines ? 11 : 10} className="empty-state">
                No lines yet
              </td>
            </tr>
          ) : (
            so.lines.map((l) => {
              // ADR-196 — a line closed short owes nothing more.
              const balance = l.shortClosedAt ? 0 : Math.max(0, l.orderQty - l.dispatchedQty);
              return (
                <tr key={l.id} style={{ background: 'var(--bg)' }}>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--blue)' }}>
                    {l.lineNo}
                  </td>
                  <td
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}
                  >
                    {l.clientPoLineNo ?? '—'}
                  </td>
                  {/* CODE/REV — the customer's drawing revision travels with the code
                      (the badge formats it via itemCodeWithRev). */}
                  <ItemThumbnailCell imagePath={l.itemImagePath} alt={l.partName} />
                  <td>
                    <ItemBadge
                      size="row"
                      showImage={false}
                      code={l.itemCode ?? l.itemCodeText}
                      name={l.partName}
                      revision={l.revision}
                      imagePath={l.itemImagePath}
                    />
                  </td>
                  <td className="td-num mono fw-700" style={{ fontSize: 14 }}>
                    {l.orderQty}
                  </td>
                  <td className="td-num mono" style={{ fontSize: 11 }}>
                    <span
                      style={{
                        color:
                          l.jcQty >= l.orderQty
                            ? 'var(--green)'
                            : l.jcQty > 0
                              ? 'var(--amber)'
                              : 'var(--text3)',
                      }}
                    >
                      {l.jcQty}
                    </span>
                    <span className="text3" style={{ fontSize: 11 }}>
                      {' '}
                      /{l.orderQty}
                    </span>
                  </td>
                  <td
                    className="td-num mono fw-700"
                    style={{ color: l.dispatchedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
                  >
                    {l.dispatchedQty}
                  </td>
                  <td
                    className="td-num mono fw-700"
                    style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}
                  >
                    {l.shortClosedAt ? 0 : balance <= 0 ? '✅ Dispatched' : balance}
                  </td>
                  <td className="text2" style={{ fontSize: 11 }}>
                    {fmtDate(l.dueDate)}
                  </td>
                  <td>
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        justifyContent: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <SoStatusBadge status={l.status} />
                      <SoLineShortClosedBadge
                        shortClosedAt={l.shortClosedAt}
                        shortCloseReason={l.shortCloseReason}
                      />
                    </div>
                  </td>
                  {canEditLines ? (
                    <td className="td-ctr">
                      <RowMenu
                        label={`Actions for line ${l.lineNo}`}
                        renderLink={(p) => <Link {...p} />}
                        items={[
                          {
                            key: 'edit',
                            label: 'Edit line',
                            icon: 'pencil',
                            to: `/sales-orders/${so.id}/edit`,
                          },
                          {
                            key: 'delete',
                            label: 'Delete line',
                            icon: 'trash-2',
                            group: 'danger',
                            disabledReason: update.isPending ? 'Saving…' : undefined,
                            onSelect: () => onDeleteLine(l.id),
                          },
                        ]}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <ConfirmDialog
        open={deletingLine !== null}
        title={`Delete line ${deletingLine?.lineNo ?? ''} of SO ${so.code}?`}
        message={
          <>
            The line is removed from this Sales Order.
            <ReasonField value={lineDeleteReason} onChange={setLineDeleteReason} />
          </>
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        onCancel={() => setDeletingLineId(null)}
        onConfirm={async () => {
          if (!deletingLineId) return;
          const reason = lineDeleteReason.trim();
          if (!reason) throw new Error(REASON_REQUIRED_MESSAGE);
          const surviving = so.lines.filter((l) => l.id !== deletingLineId).map(lineToInput);
          // updatedAt from the same snapshot as the surviving lines: the server
          // refuses (409 edit conflict, shown in this dialog) when the SO moved
          // on, instead of silently dropping a line someone added after this
          // panel loaded. The update schema requires the header's clientId.
          await update.mutateAsync({
            header: so.clientId ? { clientId: so.clientId } : {},
            lines: surviving,
            reason,
            expectedUpdatedAt: so.updatedAt,
          });
          setDeletingLineId(null);
        }}
      />
    </div>
  );
}
