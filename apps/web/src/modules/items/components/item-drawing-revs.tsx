// Item detail (ADR-290) — the item's Drawing Revs (ABC/1, ABC/2 …) with their
// release status, from GET /item-revisions?itemId=…. Each row opens the
// drawing page. Bounded per item, read whole (no paging).

import type { ItemRevision } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { useItemRevisions } from '@/modules/item-revisions/api';
import { ItemRevLink } from '@/modules/item-revisions/components/item-rev-link';
import { RevStatusBadge } from '@/modules/item-revisions/components/rev-status-badge';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { PageState } from '@/ui/layout';

const COLUMNS: DataTableColumn<ItemRevision>[] = [
  {
    id: 'drawing_rev',
    header: 'Drawing Rev',
    kind: 'code',
    nowrap: true,
    filterValue: (r) => r.label,
    render: (r) => <ItemRevLink itemRevisionId={r.id} label={r.label} />,
  },
  {
    id: 'release_status',
    header: 'Drawing Rev Status',
    kind: 'badge',
    nowrap: true,
    render: (r) => <RevStatusBadge status={r.releaseStatus} />,
  },
  {
    id: 'drawing_no',
    header: 'Drawing No.',
    kind: 'code',
    className: 'mono',
    nowrap: true,
    render: (r) => r.drawingNo ?? '—',
  },
  {
    id: 'released_on',
    header: 'Released On',
    kind: 'date',
    className: 'mono',
    nowrap: true,
    render: (r) => fmtDate(r.releasedAt),
  },
];

export function ItemDrawingRevs({ itemId }: { itemId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useItemRevisions({ itemId, limit: 200, offset: 0 });
  return (
    <Panel title="Drawing Revs" bodyPadding="none">
      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load the Drawing Revs.'}
        />
      ) : (
        <DataTable<ItemRevision>
          tableKey={TABLE_KEYS.itemDrawingRevs}
          columns={COLUMNS}
          rows={data?.items ?? []}
          loading={isLoading}
          empty="No Drawing Revs for this item yet."
          onRowClick={(r) =>
            void navigate({ to: '/drawings/$itemRevisionId', params: { itemRevisionId: r.id } })
          }
        />
      )}
    </Panel>
  );
}
