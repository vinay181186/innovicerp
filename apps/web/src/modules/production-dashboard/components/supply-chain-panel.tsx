// Supply Snapshot tab (legacy Supply Chain Snapshot, L3804-3838). ADR-203
// frozen header: the four whole-master tiles stay as chrome on top and the
// "Below Reorder" chips are now ONE table filling the rest of the screen (Item
// Code · In Stock · Reorder Level). Figures come pre-computed on the dashboard
// payload. Legacy hid the whole panel when every figure is zero; as a tab it
// shows an empty state instead.

import { TABLE_KEYS } from '@/ui/data/table-keys';
import type { ProductionDashboardSupplyChain } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { DataTable, Panel } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';

type LowStockRow = ProductionDashboardSupplyChain['lowStockItems'][number];

const COLUMNS: DataTableColumn<LowStockRow>[] = [
  {
    id: 'item_code',
    header: 'Item Code',
    kind: 'code',
    className: 'mono fw-700',
    nowrap: true,
    render: (i) => <span style={{ color: 'var(--text)' }}>{i.code}</span>,
  },
  {
    id: 'in_stock',
    header: 'In Stock',
    align: 'right',
    className: 'mono fw-700',
    nowrap: true,
    render: (i) => <span style={{ color: 'var(--red2)' }}>{i.inStock}</span>,
  },
  {
    id: 'reorder_level',
    header: 'Reorder Level',
    align: 'right',
    className: 'mono',
    nowrap: true,
    render: (i) => i.minQty,
  },
];

export function SupplyChainPanel({
  data,
}: {
  data: ProductionDashboardSupplyChain | undefined;
}): React.JSX.Element {
  const lowStockCount = data?.lowStockCount ?? 0;
  const zeroStockCount = data?.zeroStockCount ?? 0;
  const openPos = data?.openPos ?? 0;
  const todayGrn = data?.todayGrn ?? 0;
  const allZero = openPos === 0 && todayGrn === 0 && lowStockCount === 0 && zeroStockCount === 0;
  const low = lowStockCount > 0;
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          marginBottom: 'var(--panel-gap)',
        }}
      >
        <ScTile
          label="Below Reorder"
          value={lowStockCount}
          bg={low ? 'var(--red3)' : 'var(--bg3)'}
          border={low ? 'var(--red)' : 'var(--border)'}
          color={low ? 'var(--red)' : 'var(--text3)'}
        />
        <ScTile
          label="Zero Stock Items"
          value={zeroStockCount}
          bg="var(--amber3)"
          border="var(--amber)"
          color="var(--amber)"
        />
        <ScTile
          label="Open Purchase Orders"
          value={openPos}
          bg="var(--blue3)"
          border="var(--blue)"
          color="var(--blue)"
        />
        <ScTile
          label="Today's GRN"
          value={todayGrn}
          bg="var(--green3)"
          border="var(--green)"
          color="var(--green)"
        />
      </div>
      <Panel
        fill
        bodyPadding="none"
        title="Below Reorder"
        actions={
          <Link to="/store-inventory" className="btn btn-ghost btn-sm">
            Store →
          </Link>
        }
      >
        <DataTable<LowStockRow>
          tableKey={TABLE_KEYS.prodDashboardBelowReorder}
          columns={COLUMNS}
          rows={data?.lowStockItems ?? []}
          rowKey={(i) => i.itemId}
          loading={!data}
          emptyText={
            allZero ? 'Nothing to report in the supply chain.' : 'No items below reorder level.'
          }
          frozen
        />
      </Panel>
    </>
  );
}

function ScTile({
  label,
  value,
  bg,
  border,
  color,
}: {
  label: string;
  value: number;
  bg: string;
  border: string;
  color: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 10,
        background: bg,
        borderRadius: 8,
        border: `1px solid ${border}`,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
      <div className="mono fw-700" style={{ fontSize: 22, color }}>
        {value}
      </div>
    </div>
  );
}
