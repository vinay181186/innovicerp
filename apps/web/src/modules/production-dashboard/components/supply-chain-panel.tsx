// Supply Chain Snapshot (legacy L3804-3838). Four whole-master tiles + the
// low-stock item chips. Figures come pre-computed on the dashboard payload.
//
// Kept as a look-only WIDGET under ADR-199 ("widgets are look-only exceptions").
// Split out of routes/index.tsx (file-size rule); no behaviour change.

import type { ProductionDashboardLowStockItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

export function SupplyChainPanel({
  data,
}: {
  data:
    | {
        lowStockCount: number;
        zeroStockCount: number;
        openPos: number;
        todayGrn: number;
        lowStockItems: ProductionDashboardLowStockItem[];
      }
    | undefined;
}): React.JSX.Element | null {
  if (!data) return null;
  const { lowStockCount, zeroStockCount, openPos, todayGrn, lowStockItems } = data;
  // Legacy L3809 — hide the whole panel when everything is zero.
  if (openPos === 0 && todayGrn === 0 && lowStockCount === 0 && zeroStockCount === 0) return null;

  const low = lowStockCount > 0;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">Supply Chain Snapshot</span>
        <Link to="/store-inventory" className="btn btn-ghost btn-sm">
          Store →
        </Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          padding: 14,
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
      {lowStockItems.length > 0 ? (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--red2)', fontWeight: 700, marginBottom: 6 }}>
            Below Reorder:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {lowStockItems.map((i) => (
              <span
                key={i.itemId}
                style={{
                  fontSize: 11,
                  background: 'var(--red3)',
                  border: '1px solid var(--red)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  color: 'var(--red2)',
                }}
              >
                {i.code} ({i.inStock} / Reorder Level {i.minQty})
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
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
