// "Rev changes" — every Drawing Rev change on an SO / JWSO's lines: from ABC/1
// to ABC/2, which open documents moved to the new Rev, which closed Job Cards
// kept the old one, who and when. Shown under the order's history tab.

import type { ItemRevisionChange } from '@innovic/shared';
import { fmtDateTime } from '@/lib/date';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { type ItemRevisionChangesQuery, useItemRevisionChanges } from '../api';
import { ItemRevLink } from './item-rev-link';

const COLUMNS: DataTableColumn<ItemRevisionChange>[] = [
  {
    id: 'line_no',
    header: 'Line No.',
    className: 'mono',
    nowrap: true,
    render: (c) => c.lineNo ?? '—',
  },
  {
    id: 'from',
    header: 'From Drawing Rev',
    nowrap: true,
    render: (c) =>
      c.fromLabel ? <ItemRevLink itemRevisionId={c.fromItemRevisionId} label={c.fromLabel} /> : '—',
    filterValue: (c) => c.fromLabel,
  },
  {
    id: 'to',
    header: 'To Drawing Rev',
    nowrap: true,
    render: (c) => <ItemRevLink itemRevisionId={c.toItemRevisionId} label={c.toLabel} />,
    filterValue: (c) => c.toLabel,
  },
  {
    id: 'moved',
    header: 'Moved Documents',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    className: 'mono',
    title: (c) => c.movedDocs.join(', '),
    render: (c) => (c.movedDocs.length ? c.movedDocs.join(', ') : '—'),
  },
  {
    id: 'kept',
    header: 'Kept (Closed) Job Cards',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    className: 'mono',
    title: (c) => c.keptDocs.join(', '),
    render: (c) => (c.keptDocs.length ? c.keptDocs.join(', ') : '—'),
  },
  {
    id: 'by',
    header: 'Changed By',
    nowrap: true,
    render: (c) => c.createdByName ?? '—',
  },
  {
    id: 'at',
    header: 'Changed At',
    kind: 'date',
    className: 'mono text2',
    nowrap: true,
    render: (c) => fmtDateTime(c.createdAt),
    filterValue: (c) => c.createdAt,
  },
];

/** Count for the tab badge — same query the section reads. */
export function useRevChangeCount(q: ItemRevisionChangesQuery): number {
  return useItemRevisionChanges(q).data?.length ?? 0;
}

export function RevChangesSection({ query }: { query: ItemRevisionChangesQuery }): React.JSX.Element {
  const { data, isLoading, isError, error } = useItemRevisionChanges(query);
  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <div className="section-hdr">Rev Changes</div>
      {isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load Rev changes.'}
        </div>
      ) : (
        <DataTable
          tableKey={TABLE_KEYS.itemRevisionChanges}
          columns={COLUMNS}
          rows={data ?? []}
          loading={isLoading}
          empty="No Drawing Rev changes on this order."
        />
      )}
    </div>
  );
}
