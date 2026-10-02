// Rejection Pareto tab (legacy _qccRenderPareto L18833). ALL NCs grouped by
// reason, sorted by rejected qty desc: rank #, NC count, rejected qty, % of
// total qty, top-3 items, rank-colored distribution bar + header totals.
//
// ADR-199 table standard: the data table is the shared fit table
// (<DataTable tableKey={TABLE_KEYS.qcCommandPareto}>). Numbers right-aligned;
// the distribution bar rides as its own never-cut column.

import { NC_REASON_CATEGORY_LABELS, type QcCommandPareto, type QcParetoRow } from '@innovic/shared';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { type QcPager, TablePager, rowNo } from './TablePager';

const RANK_COLORS = ['var(--red2)', 'var(--amber2)', 'var(--orange2)', 'var(--text3)'];
function rankColor(i: number): string {
  return RANK_COLORS[i] ?? 'var(--text3)';
}

function reasonLabel(reason: string): string {
  return (NC_REASON_CATEGORY_LABELS as Record<string, string>)[reason] ?? reason;
}

// Rank = position over ALL reasons (page offset + index), so page 2 starts at 26.
function paretoColumns(pager: QcPager): DataTableColumn<QcParetoRow>[] {
  const rank = (i: number): number => rowNo(pager, i) - 1;
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      nowrap: true,
      className: 'mono fw-700',
      render: (_r, i) => rowNo(pager, i),
    },
    {
      id: 'reason',
      header: 'Reason',
      align: 'left',
      ellipsis: true,
      render: (r) => <span style={{ fontWeight: 600 }}>{reasonLabel(r.reason)}</span>,
      title: (r) => reasonLabel(r.reason),
    },
    {
      id: 'count',
      header: 'NC Count',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => r.count,
    },
    {
      id: 'rejectedQty',
      header: 'Rejected',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (r) => <span style={{ color: 'var(--red2)' }}>{r.rejectedQty}</span>,
    },
    {
      id: 'pct',
      header: '% of Total',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (r, i) => <span style={{ color: rankColor(rank(i)) }}>{r.pct}%</span>,
      filterValue: (r) => r.pct,
    },
    {
      id: 'topItems',
      header: 'Top Items',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (r) => r.topItems || '—',
      title: (r) => r.topItems ?? '',
    },
    {
      id: 'distribution',
      header: 'Distribution',
      minWidth: 160,
      filterable: false,
      render: (r, i) => (
        <div
          style={{
            background: 'var(--bg3)',
            borderRadius: 10,
            height: 18,
            overflow: 'hidden',
          }}
        >
          <div style={{ background: rankColor(rank(i)), height: '100%', width: `${r.pct}%` }} />
        </div>
      ),
    },
  ];
}

export function ParetoTab({
  pareto,
  pager,
}: {
  /** `rows` is this page (server-paged, ADR-201); the totals are over every NC. */
  pareto: QcCommandPareto;
  pager: QcPager;
}): React.JSX.Element {
  return (
    <div>
      <div className="panel">
        {/* Legacy L18846 hand-rolls this sub-header instead of .panel-hdr.
            totalCount/totalQty are server-computed over every NC — not summed here. */}
        <div
          style={{
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 700,
            borderBottom: '1px solid var(--border)',
            color: 'var(--text2)',
          }}
        >
          Top Rejection Reasons — Total: {pareto.totalCount} NCs, {pareto.totalQty} pcs rejected
        </div>
        {pager.total === 0 ? (
          <div className="empty-state" style={{ color: 'var(--green2)' }}>
            No rejections recorded yet.
          </div>
        ) : (
          <DataTable
            tableKey={TABLE_KEYS.qcCommandPareto}
            columns={paretoColumns(pager)}
            rows={pareto.rows}
            rowKey={(r) => r.reason}
          />
        )}
        {pager.total > 0 ? <TablePager pager={pager} noun="reason" /> : null}
      </div>
    </div>
  );
}
