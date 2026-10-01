// Level 1 of SO/JWSO Planning (PL-4b): the list of open orders, on the shared
// FIT table (ADR-199, TABLE_KEYS.planningList). The rows are fetched whole (a
// master that scrolls, not a server page), so they sort in memory via
// useClientSort — the Plan Status column sorts by its label, not the raw enum.
// Split out of routes/workflow.tsx so that file stays under the 400-line rule.

import type { PlanningSoListItem } from '@innovic/shared';
import { useMemo } from 'react';
import { DataTable, Panel, useClientSort } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { PageState } from '@/ui/layout';
import { orderListColumns, orderRowTint } from './order-list-columns';
import { ORDER_STATUS_LABEL, type Source } from './planning-shared';

export function OrderList({
  src,
  items,
  loading,
  error,
  onOpen,
}: {
  src: Source;
  items: PlanningSoListItem[];
  loading: boolean;
  error: string | null;
  onOpen: (soId: string) => void;
}): JSX.Element {
  const columns = useMemo(() => orderListColumns(src), [src]);
  // Plan Status sorts by the shown label; everything else sorts off the field.
  const { rows, sortBy, sortDir, onSort } = useClientSort(items, {
    accessors: { planningStatus: (r) => ORDER_STATUS_LABEL[r.planningStatus] },
  });

  if (error) {
    return <PageState state="error" message={error} />;
  }

  return (
    <Panel bodyPadding="none">
      <DataTable
        tableKey={TABLE_KEYS.planningList}
        columns={columns}
        rows={rows}
        loading={loading}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={onSort}
        emptyText={`No open ${src === 'jw' ? 'JWSOs' : 'SOs'} to plan`}
        onRowClick={(so) => onOpen(so.soId)}
        rowClassName={(so) => orderRowTint(so.planningStatus)}
      />
    </Panel>
  );
}
