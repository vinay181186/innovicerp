// SO Master expand — what the row's ▸ reveals: Raised By + Remarks (moved off
// the retired card / the main table, which now carries only the 12 standard
// columns), then the order's line items (component) or its BOM-status strip and
// exploded BOM (equipment). Fetches the SO detail only for a row that is open,
// so the list endpoint stays one request.

import type { SalesOrderListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useSalesOrder } from '../api';
import { ComponentSoExpand } from './so-component-expand';
import { EquipmentSoExpand } from './so-equipment-expand';

export function SoExpandedPanel({
  so,
  canEdit,
}: {
  so: SalesOrderListItem;
  canEdit: boolean;
}): React.JSX.Element {
  const { data, isLoading, isError, error } = useSalesOrder(so.id);
  return (
    <div>
      {/* Raised By · Remarks — the two facts the retired card showed that the
          12-column table no longer has room for. */}
      <div
        className="mono"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '8px 14px 0 36px',
          fontSize: 11,
          color: 'var(--text3)',
        }}
      >
        <span>
          Raised By <span className="text2">{so.createdByName ?? '—'}</span>
        </span>
        <span>·</span>
        <span title={so.remarks ?? ''}>
          Remarks <span className="text2">{so.remarks || '—'}</span>
        </span>
      </div>
      {isLoading ? (
        <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>
          <Loader2 size={12} className="inline animate-spin" /> Loading lines…
        </div>
      ) : isError || !data ? (
        <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load SO detail. Try again.'}
        </div>
      ) : so.type === 'equipment' ? (
        <EquipmentSoExpand so={data} />
      ) : (
        <ComponentSoExpand so={data} canEdit={canEdit} />
      )}
    </div>
  );
}
