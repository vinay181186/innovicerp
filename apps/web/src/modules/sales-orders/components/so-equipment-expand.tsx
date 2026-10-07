// SO Master expand — an EQUIPMENT order's line + BOM-status strip + exploded
// BOM items, revealed under its row. Moved out of routes/list.tsx (ADR-199
// split). Read-only: Edit / Delete are the row's ⋯ (they were duplicates here)
// and Plan BOM Items moved into the row's ⋯ Workflow (equipment SO with a BOM).

import type { SalesOrderDetail, SoStatusBomItem } from '@innovic/shared';
import { Panel } from '@/ui/data';
import { fmtDate } from '@/lib/date';
import { ItemBadge } from '@/components/shared/item-badge';
import { useSoStatus } from '../../so-status/api';

export function EquipmentSoExpand({ so }: { so: SalesOrderDetail }): React.JSX.Element {
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
        {so.bomMasterId ? null : (
          <span
            style={{
              marginLeft: 'auto',
              color: 'var(--amber2)',
              fontSize: 12,
              fontWeight: 600,
              alignSelf: 'center',
            }}
          >
            ⚠ No BOM linked — assign one in Edit.
          </span>
        )}
      </div>
      {so.bomMasterId ? <EquipmentBomItems soId={so.id} /> : null}
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
      <BomPartsTable items={items} />
    </div>
  );
}

/** The exploded BOM parts table — shared by the SO list ▸ expand and the SO detail
 *  panel (ADR-222). Markup moved here unchanged from EquipmentBomItems. */
function BomPartsTable({ items }: { items: SoStatusBomItem[] }): React.JSX.Element {
  // tbl-ctr — the table-alignment standard: data centred, headers untouched.
  return (
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
                <span style={{ color: typeColor, fontSize: 11, fontWeight: 700 }}>{typeLabel}</span>
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
  );
}

/** ADR-222 — the BOM's child item parts on the SO DETAIL page. Own loading and
 *  error state (§20.5): it calls the heavier /so-status endpoint, not the page's own. */
export function SoBomPartsPanel({ so }: { so: SalesOrderDetail }): React.JSX.Element | null {
  // ADR-222 — only an equipment SO has a BOM, and /so-status is a heavy
  // aggregation, so a non-equipment SO must not fire it at all (the hook is
  // still CALLED, per the hooks rule — `enabled` is what stops the request).
  // `live: false`: a parts list is static, so fetch once instead of polling
  // this endpoint every 60s on every SO detail page.
  const isEquipment = so.type === 'equipment';
  const { data, isLoading, isError } = useSoStatus(so.id, {
    enabled: isEquipment && Boolean(so.bomMasterId),
    live: false,
  });
  if (!isEquipment) return null;
  const info = data?.header.equipmentInfo;
  const items = data?.bomItems ?? [];
  const detailBits = so.bomMasterId
    ? [
        info?.bomNo,
        info?.bomName,
        info?.bomRev != null ? `BOM Rev ${info.bomRev}` : null,
        info ? `${info.bomPartsCount} parts` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const title = detailBits ? `BOM Parts — ${detailBits}` : 'BOM Parts';
  const note = (text: string, color: string): React.JSX.Element => (
    <div style={{ padding: '12px 18px', fontSize: 12, color }}>{text}</div>
  );
  return (
    <Panel title={title} bodyPadding="none">
      {!so.bomMasterId ? (
        note('No BOM linked — assign one in Edit.', 'var(--amber2)')
      ) : isLoading ? (
        note('Loading BOM parts…', 'var(--text3)')
      ) : isError ? (
        note('Could not load the BOM parts. Refresh the page.', 'var(--red2)')
      ) : items.length === 0 ? (
        note('The linked BOM has no parts.', 'var(--text3)')
      ) : (
        <BomPartsTable items={items} />
      )}
    </Panel>
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
