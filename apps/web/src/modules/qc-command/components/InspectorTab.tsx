// Inspector Performance tab (legacy _qccRenderInspector L18873). Per-inspector
// over ALL QC entries: inspections, distinct JCs, accepted, rejected, reject
// rate (green ≤5 / amber ≤15 / red), current assigned load. Avg-Hrs/Inspection
// dropped — op_log has no hours column (legacy itself flagged it mobile-only).
//
// ADR-199 table standard: the data table is the shared fit table
// (<DataTable tableKey={TABLE_KEYS.qcCommandInspector}>). Numbers right-aligned.

import type { QcInspectorPerfRow } from '@innovic/shared';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { type QcPager, TablePager } from './TablePager';

function rejColor(pct: number): string {
  if (pct <= 5) return 'var(--green)';
  if (pct <= 15) return 'var(--amber)';
  return 'var(--red)';
}

const columns: DataTableColumn<QcInspectorPerfRow>[] = [
  {
    id: 'name',
    header: 'Inspected By',
    align: 'left',
    ellipsis: true,
    className: 'fw-700',
    render: (p) => p.name,
    title: (p) => p.name,
  },
  {
    id: 'inspections',
    header: 'Inspections',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (p) => <span style={{ color: 'var(--cyan)' }}>{p.inspections}</span>,
  },
  {
    id: 'jcs',
    header: 'JCs',
    align: 'right',
    nowrap: true,
    className: 'mono',
    render: (p) => p.jcs,
  },
  {
    id: 'accepted',
    header: 'Accepted',
    align: 'right',
    nowrap: true,
    className: 'mono',
    render: (p) => <span style={{ color: 'var(--green2)' }}>{p.accepted}</span>,
  },
  {
    id: 'rejected',
    header: 'Rejected',
    align: 'right',
    nowrap: true,
    className: 'mono',
    render: (p) => <span style={{ color: 'var(--red2)' }}>{p.rejected}</span>,
  },
  {
    id: 'rejRate',
    header: <span title="Green ≤ 5%, Amber 6–15%, Red > 15%">Rejection Rate</span>,
    label: 'Rejection Rate',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (p) => <span style={{ color: rejColor(p.rejRate) }}>{p.rejRate}%</span>,
    filterValue: (p) => p.rejRate,
  },
  {
    id: 'currentLoad',
    header: <span title="Items now assigned to this inspector">Current Load</span>,
    label: 'Current Load',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (p) => <span style={{ color: 'var(--amber2)' }}>{p.currentLoad}</span>,
    filterValue: (p) => p.currentLoad,
  },
];

export function InspectorTab({
  perf,
  pager,
}: {
  /** This page of inspectors (server-paged, ADR-201). */
  perf: QcInspectorPerfRow[];
  pager: QcPager;
}): React.JSX.Element {
  return (
    <div>
      <div className="panel">
        {/* Legacy L18895 hand-rolls this sub-header instead of .panel-hdr. */}
        <div
          style={{
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 700,
            borderBottom: '1px solid var(--border)',
            color: 'var(--text2)',
          }}
        >
          Inspector Performance
        </div>
        <DataTable
          tableKey={TABLE_KEYS.qcCommandInspector}
          columns={columns}
          rows={perf}
          rowKey={(p) => p.name}
          emptyText="No inspections recorded yet."
        />
        <TablePager pager={pager} noun="inspector" />
      </div>
    </div>
  );
}
