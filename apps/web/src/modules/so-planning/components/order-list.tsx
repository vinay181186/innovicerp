// Level 1 of SO/JWSO Planning (PL-4b): the list of open orders, on the shared
// FIT table (ADR-199, TABLE_KEYS.planningList). ADR-201: the server sends one
// 25-row page already filtered and sorted, so the table draws the rows as
// given and its Sort & Filter (▾) runs on the server (`sf`).
// Split out of routes/workflow.tsx so that file stays under the 400-line rule.

import type { PlanningSoListItem } from '@innovic/shared';
import { useMemo } from 'react';
import { DataTable, Panel } from '@/ui/data';
import type { ServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { PageState } from '@/ui/layout';
import { orderListColumns, orderRowTint } from './order-list-columns';
import type { Source } from './planning-shared';

export function OrderList({
  src,
  items,
  loading,
  error,
  onOpen,
  sf,
}: {
  src: Source;
  items: PlanningSoListItem[];
  loading: boolean;
  error: string | null;
  onOpen: (soId: string) => void;
  sf: ServerSortFilter;
}): JSX.Element {
  const columns = useMemo(() => orderListColumns(src), [src]);

  if (error) {
    return <PageState state="error" message={error} />;
  }

  return (
    // `fill` (ADR-202/203): the order list takes the rest of the screen and is
    // the page's one scrollbar, so its column header stays frozen.
    <Panel fill bodyPadding="none">
      <DataTable
        tableKey={TABLE_KEYS.planningList}
        columns={columns}
        rows={items}
        loading={loading}
        sortFilterServer={sf}
        emptyText={
          sf.filtering ? 'No orders match.' : `No open ${src === 'jw' ? 'JWSOs' : 'SOs'} to plan`
        }
        onRowClick={(so) => onOpen(so.soId)}
        rowClassName={(so) => orderRowTint(so.planningStatus)}
      />
    </Panel>
  );
}
