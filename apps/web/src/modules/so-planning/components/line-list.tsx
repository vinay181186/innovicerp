// Level 1 of SO/JWSO Planning (ADR-268): one row per SO / JWSO line, on the shared
// FIT table (TABLE_KEYS.planningLineList). The server sends one 25-row page
// already filtered and sorted, so the table draws the rows as given and its
// Sort & Filter (▾) runs on the server (`sf`).

import type { PlanningLineListItem } from '@innovic/shared';
import { useMemo } from 'react';
import { DataTable, Panel } from '@/ui/data';
import type { ServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { PageState } from '@/ui/layout';
import { LINE_LIST_PINNED_IDS, lineListColumns, lineRowTint } from './line-list-columns';
import type { SourceFilter } from './planning-shared';

export function LineList({
  src,
  items,
  firstRowNo,
  loading,
  error,
  searching,
  onOpen,
  sf,
}: {
  src: SourceFilter;
  items: PlanningLineListItem[];
  /** Sr No of this page's first row (server offset + 1). */
  firstRowNo: number;
  loading: boolean;
  error: string | null;
  /** A search term is set — an empty page means "no match", not "nothing to plan". */
  searching: boolean;
  onOpen: (soId: string) => void;
  sf: ServerSortFilter;
}): JSX.Element {
  const columns = useMemo(() => lineListColumns(src, firstRowNo), [src, firstRowNo]);

  if (error) {
    return <PageState state="error" message={error} />;
  }

  return (
    // `fill` (ADR-202/203): the list takes the rest of the screen and is the
    // page's one scrollbar, so its column header stays frozen.
    <Panel fill bodyPadding="none">
      <DataTable
        tableKey={TABLE_KEYS.planningLineList}
        columns={columns}
        rows={items}
        rowKey={(r) => r.soLineId}
        loading={loading}
        defaultPinned={LINE_LIST_PINNED_IDS}
        sortFilterServer={sf}
        emptyText={
          sf.filtering || searching
            ? 'No lines match.'
            : `No open ${src === 'jw' ? 'JWSO' : src === 'so' ? 'SO' : 'SO / JWSO'} lines to plan yet.`
        }
        onRowClick={(r) => onOpen(r.soId)}
        rowClassName={lineRowTint}
      />
    </Panel>
  );
}
