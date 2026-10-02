// First-Pass Yield tab (legacy _qccRenderFPY L18757). FPY by Operation +
// Inspector (side-by-side), plus the lowest-FPY items (quality hot-spots).
// FPY = ops that passed QC on the first attempt with zero rejects.
//
// ADR-199 table standard: every table is the shared fit table (<DataTable>).
// The full-width "lowest FPY items" list carries the tab's fit key
// (TABLE_KEYS.qcCommandFpy); the two narrow side-by-side group tables render on
// the same shared sheet without a saved layout. Numbers are right-aligned.

import type { QcCommandFpy, QcFpyGroupRow, QcFpyItemRow } from '@innovic/shared';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';

function fpyColor(pct: number): string {
  if (pct >= 95) return 'var(--green)';
  if (pct >= 85) return 'var(--amber)';
  return 'var(--red)';
}

const FPY_HELP =
  'Items accepted at QC on first attempt with no rejections. Green ≥ 95%, Amber 85–94%, Red < 85%.';

// Legacy L18795/L18805 hand-rolls a compact sub-header here rather than using
// .panel-hdr/.panel-title (which it defines but does not use on this page).
function SubHdr({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        padding: '10px 14px',
        fontSize: 12,
        fontWeight: 700,
        borderBottom: '1px solid var(--border)',
        color: 'var(--text2)',
      }}
    >
      {children}
    </div>
  );
}

const fpyPctHeader = <span title={FPY_HELP}>First-Pass Yield %</span>;

function groupColumns(label: string, nameWeight?: number): DataTableColumn<QcFpyGroupRow>[] {
  return [
    {
      id: 'name',
      header: label,
      align: 'left',
      ellipsis: true,
      render: (r) => <span style={{ fontWeight: nameWeight }}>{r.name}</span>,
      title: (r) => r.name,
    },
    {
      id: 'total',
      header: 'Inspected',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => r.total,
    },
    {
      id: 'passed',
      header: 'Accepted',
      align: 'right',
      nowrap: true,
      className: 'mono',
      render: (r) => <span style={{ color: 'var(--green2)' }}>{r.passed}</span>,
    },
    {
      id: 'pct',
      header: fpyPctHeader,
      label: 'First-Pass Yield %',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (r) => <span style={{ color: fpyColor(r.pct) }}>{r.pct}%</span>,
      filterValue: (r) => r.pct,
    },
  ];
}

function GroupPanel({
  title,
  label,
  rows,
  nameWeight,
}: {
  title: string;
  label: string;
  rows: QcFpyGroupRow[];
  nameWeight?: number;
}): React.JSX.Element {
  return (
    <div className="panel">
      <SubHdr>{title}</SubHdr>
      <DataTable
        columns={groupColumns(label, nameWeight)}
        rows={rows}
        rowKey={(r) => r.name}
        emptyText="No QC data yet."
      />
    </div>
  );
}

const itemColumns: DataTableColumn<QcFpyItemRow>[] = [
  {
    id: 'code',
    header: 'Item Code',
    nowrap: true,
    // Item code strong in the body colour (item-code rule).
    className: 'td-code',
    render: (it) => <span style={{ color: 'var(--text)' }}>{it.code}</span>,
  },
  {
    id: 'name',
    header: 'Item Name',
    align: 'left',
    ellipsis: true,
    render: (it) => it.name,
    title: (it) => it.name ?? '',
  },
  {
    id: 'total',
    header: 'Inspected',
    align: 'right',
    nowrap: true,
    className: 'mono',
    render: (it) => it.total,
  },
  {
    id: 'passed',
    header: 'First-Pass',
    align: 'right',
    nowrap: true,
    className: 'mono',
    render: (it) => <span style={{ color: 'var(--green2)' }}>{it.passed}</span>,
  },
  {
    id: 'pct',
    header: fpyPctHeader,
    label: 'First-Pass Yield %',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (it) => <span style={{ color: fpyColor(it.pct) }}>{it.pct}%</span>,
    filterValue: (it) => it.pct,
  },
];

export function FpyTab({ fpy }: { fpy: QcCommandFpy }): React.JSX.Element {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Legacy L18799 leaves the operation name unweighted; L18809 gives the
            inspector name a font-weight:600. */}
        <GroupPanel
          title="First-Pass Yield by Operation"
          label="Operation"
          rows={fpy.byOperation}
        />
        <GroupPanel
          title="First-Pass Yield by Inspector"
          label="Inspector"
          rows={fpy.byInspector}
          nameWeight={600}
        />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <SubHdr>⚠ Items with Lowest First-Pass Yield</SubHdr>
        <DataTable
          tableKey={TABLE_KEYS.qcCommandFpy}
          columns={itemColumns}
          rows={fpy.byItem}
          rowKey={(it) => it.code}
          emptyText="No QC data yet."
        />
      </div>
    </>
  );
}
