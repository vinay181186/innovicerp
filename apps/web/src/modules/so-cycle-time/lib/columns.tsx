// SO Cycle Time columns (ADR-199 fit sheet). Every column carries its
// server Sort & Filter field (ADR-200/201 — so-cycle-time/service.ts
// SCT_SF_COLUMNS), so ▾ sorts / filters every SO, not the page on screen.

import { SO_STATUSES, type SoCycleTimeRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { soNoWithInternal } from '@/lib/so-number';
import type { DataTableColumn } from '@/ui/data';
import { soStatusLabel } from '@/modules/sales-orders/lib/so-status-label';

export const TYPE_LABEL: Record<string, string> = {
  component_manufacturing: 'Component',
  equipment: 'Equipment',
  with_material: 'With Material',
};

const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  ...SO_STATUSES.map((st) => ({ value: st, label: soStatusLabel(st) })),
];

/** A phase-duration cell: "Nd" coloured amber > 10 / red > 20, "—" when the
 *  phase was never reached. Days footnote below the table explains the scale. */
function durContent(v: number | null): React.JSX.Element {
  if (v == null) return <span className="text3">—</span>;
  const color = v > 20 ? 'var(--red)' : v > 10 ? 'var(--amber)' : 'var(--text)';
  return (
    <span className="mono fw-700" style={{ color }}>
      {v}d
    </span>
  );
}

export function soCycleTimeColumns(avgTotal: number): DataTableColumn<SoCycleTimeRow>[] {
  const dur = (
    id: string,
    header: string,
    get: (r: SoCycleTimeRow) => number | null,
  ): DataTableColumn<SoCycleTimeRow> => ({
    id,
    kind: 'num',
    header,
    sortFilterField: id,
    filterValue: (r) => get(r),
    render: (r) => durContent(get(r)),
  });

  return [
    {
      id: 'so_no',
      kind: 'code',
      header: 'SO No.',
      nowrap: true,
      sortFilterField: 'soNo',
      render: (r) => (
        <Link
          to="/sales-orders/$id"
          params={{ id: r.soId }}
          className="td-code"
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {soNoWithInternal(r.soNo, r.internalSoNo)}
        </Link>
      ),
    },
    {
      id: 'customer',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      sortFilterField: 'customer',
      ellipsis: true,
      render: (r) => r.customer ?? '—',
      title: (r) => r.customer ?? '',
    },
    {
      id: 'so_type',
      kind: 'code',
      header: 'SO Type',
      sortFilterField: 'soType',
      filterType: 'list',
      filterOptions: TYPE_OPTIONS,
      filterValue: (r) => TYPE_LABEL[r.type ?? ''] ?? r.type ?? '',
      render: (r) => TYPE_LABEL[r.type ?? ''] ?? r.type ?? '—',
    },
    {
      id: 'so_status',
      kind: 'badge',
      header: 'SO Status',
      sortFilterField: 'soStatus',
      filterType: 'list',
      filterOptions: STATUS_OPTIONS,
      filterValue: (r) => (r.phases.dispatched ? 'Completed' : soStatusLabel(r.status)),
      render: (r) => {
        const done = Boolean(r.phases.dispatched);
        return (
          <span
            className={`badge ${done ? 'b-green' : r.status === 'cancelled' ? 'b-grey' : 'b-blue'}`}
          >
            {done ? 'Completed' : soStatusLabel(r.status)}
          </span>
        );
      },
    },
    dur('design', 'Design', (r) => r.durations.design),
    dur('material', 'Material', (r) => r.durations.materialProc),
    dur('production', 'Production', (r) => r.durations.production),
    dur('qc', 'QC', (r) => r.durations.qc),
    dur('assembly', 'Assembly', (r) => r.durations.assembly),
    dur('dispatch', 'Dispatch', (r) => r.durations.assemblyToDispatch),
    {
      id: 'total',
      kind: 'num',
      header: 'Total',
      sortFilterField: 'total',
      filterValue: (r) => r.durations.total,
      render: (r) => {
        if (r.durations.total == null) return <span className="text3">—</span>;
        const over = r.durations.total > avgTotal;
        return (
          <span className="mono fw-700" style={{ color: over ? 'var(--amber)' : 'var(--green)' }}>
            {r.durations.total}d
          </span>
        );
      },
    },
  ];
}
