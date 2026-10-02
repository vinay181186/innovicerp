// SO Master expand — an EQUIPMENT order's line + BOM-status strip + exploded
// BOM items, revealed under its row. Moved out of routes/list.tsx (ADR-199
// split). Behaviour unchanged.

import type { SalesOrderDetail } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { ConfirmDialog } from '@/ui/feedback';
import { ItemBadge } from '@/components/shared/item-badge';
import { useSoStatus } from '../../so-status/api';
import { useSoftDeleteSalesOrder } from '../api';
import { REASON_REQUIRED_MESSAGE, ReasonField } from './reason-field';

export function EquipmentSoExpand({
  so,
  canEdit,
  canDelete,
}: {
  so: SalesOrderDetail;
  canEdit: boolean;
  canDelete: boolean;
}): React.JSX.Element {
  const softDelete = useSoftDeleteSalesOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const line = so.lines[0];
  if (!line)
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>
        No lines yet — add an item to this SO.
      </div>
    );
  const bomStatus = so.bomStatus ?? 'BOM Pending';
  return (
    <div>
      <div
        style={{
          padding: '10px 18px 8px 36px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 18,
          alignItems: 'center',
        }}
      >
        {/* Same label band as <Fact>, but the value is the item badge (thumbnail ·
            code · name) rather than a string. The equipment line is an SO line
            like any other, so its drawing revision renders as CODE/REV (ADR-177). */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Equipment</div>
          <ItemBadge
            size="row"
            code={line.itemCode ?? line.itemCodeText}
            name={line.partName}
            revision={line.revision}
            imagePath={line.itemImagePath}
          />
        </div>
        <Fact label="Order Qty" value={String(line.orderQty)} big />
        <Fact label="Due Date" value={fmtDate(line.dueDate)} />
        <div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>BOM Status</div>
          <div
            style={{
              fontWeight: 700,
              color:
                bomStatus === 'BOM Pending'
                  ? 'var(--amber)'
                  : bomStatus === 'BOM Planned'
                    ? 'var(--green)'
                    : 'var(--cyan)',
            }}
          >
            {bomStatus === 'BOM Pending'
              ? '⚠ BOM Pending'
              : bomStatus === 'BOM Planned'
                ? '✅ BOM Planned'
                : `📦 ${bomStatus}`}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {canEdit ? (
            <Link
              to="/sales-orders/$id/edit"
              params={{ id: so.id }}
              className="btn btn-ghost btn-sm"
            >
              ✏ Edit
            </Link>
          ) : null}
          {so.bomMasterId ? (
            <Link
              to="/planning"
              search={{ soId: so.id }}
              className="btn btn-ghost btn-sm cyan fw-700"
            >
              📦 Plan BOM Items
            </Link>
          ) : (
            <span
              style={{ color: 'var(--amber2)', fontSize: 12, fontWeight: 600, alignSelf: 'center' }}
            >
              ⚠ No BOM linked — assign one in Edit.
            </span>
          )}
          {canDelete ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                setDeleteReason('');
                setConfirmDelete(true);
              }}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
      {so.bomMasterId ? <EquipmentBomItems soId={so.id} /> : null}
      <ConfirmDialog
        open={confirmDelete}
        title={`Move SO ${so.code} to Trash?`}
        message={
          <>
            You can restore it from Trash.
            <ReasonField value={deleteReason} onChange={setDeleteReason} />
          </>
        }
        confirmLabel="Move to Trash"
        pendingLabel="Moving to Trash…"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const reason = deleteReason.trim();
          if (!reason) throw new Error(REASON_REQUIRED_MESSAGE);
          await softDelete.mutateAsync({ id: so.id, reason });
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}

function EquipmentBomItems({ soId }: { soId: string }): React.JSX.Element | null {
  const { data } = useSoStatus(soId);
  const items = data?.bomItems ?? [];
  if (items.length === 0) return null;
  return (
    <div style={{ padding: '4px 12px 8px 32px' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--cyan)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          marginBottom: 4,
        }}
      >
        BOM Items — {data?.header.equipmentInfo?.bomNo ?? ''} ×{' '}
        {data?.header.equipmentInfo?.equipmentQty ?? 0} sets
      </div>
      {/* tbl-ctr — the table-alignment standard: data centred, headers untouched. */}
      <table className="innovic-table tbl-ctr" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>Sr No</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th className="th-num">Qty per Set</th>
            <th className="th-num" style={{ color: 'var(--cyan)' }}>
              Total Need
            </th>
            <th>BOM Type</th>
            <th className="th-num" style={{ color: 'var(--green2)' }}>
              Physical
            </th>
            <th className="th-num" style={{ color: 'var(--red2)' }}>
              Short
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((c, idx) => {
            const typeLabel =
              c.bomType === 'manufacture' ? 'Make' : c.bomType === 'purchase' ? 'Buy' : 'Outsource';
            const typeColor =
              c.bomType === 'manufacture'
                ? 'var(--cyan)'
                : c.bomType === 'purchase'
                  ? 'var(--green)'
                  : 'var(--amber)';
            return (
              <tr
                key={c.childItemId}
                style={{
                  background: c.shortfall > 0 ? 'var(--red3)' : 'var(--green3)',
                }}
              >
                <td className="td-ctr mono fw-700">{idx + 1}</td>
                <td className="td-code" style={{ color: 'var(--purple)' }}>
                  {c.childItemCode}
                </td>
                <td>{c.childItemName}</td>
                <td className="td-num mono fw-700">{c.qtyPerSet}</td>
                <td className="td-num mono fw-700" style={{ fontSize: 14, color: 'var(--cyan)' }}>
                  {c.totalNeed}
                </td>
                <td>
                  <span style={{ color: typeColor, fontSize: 11, fontWeight: 700 }}>
                    {typeLabel}
                  </span>
                </td>
                <td
                  className="td-num mono fw-700"
                  style={{ color: c.stockQty > 0 ? 'var(--green)' : 'var(--text3)' }}
                >
                  {c.stockQty}
                </td>
                <td
                  className="td-num mono fw-700"
                  style={{ color: c.shortfall > 0 ? 'var(--red)' : 'var(--green)' }}
                >
                  {c.shortfall}
                  {c.shortfall <= 0 ? ' ✅' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Fact({
  label,
  value,
  color,
  big,
}: {
  label: string;
  value: string;
  color?: string | undefined;
  big?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontWeight: 700, color, fontSize: big ? 16 : undefined }}>{value}</div>
    </div>
  );
}
