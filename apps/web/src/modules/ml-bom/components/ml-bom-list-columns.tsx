// Multi-Level BOM list columns (ADR-225, ADR-199 fit table). Same shape as
// bom-master/components/bom-list-columns.tsx.

import type { MlBomListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import type { DataTableColumn } from '@/ui/data';

export function mlBomListColumns(offset = 0): DataTableColumn<MlBomListItem>[] {
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      width: '4%',
      className: 'text3',
      align: 'right',
      render: (_b, i) => offset + i + 1,
    },
    {
      id: 'code',
      sortFilterField: 'code',
      header: 'BOM No.',
      nowrap: true,
      render: (b) => (
        <Link
          to="/ml-boms/$id"
          params={{ id: b.id }}
          className="td-code"
          onClick={(e) => e.stopPropagation()}
        >
          {b.code}
        </Link>
      ),
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      header: 'Item Code',
      nowrap: true,
      // The item code is THE main thing on the row — strong, never --text3.
      render: (b) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {b.itemCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (b) => b.itemName ?? '—',
      title: (b) => b.itemName ?? '',
    },
    {
      // No ▾: a boolean has no agreed server filter type (ADR-200 offers
      // text / num / date / list only).
      id: 'is_default',
      header: 'Default',
      nowrap: true,
      render: (b) =>
        b.isDefault ? (
          <span className="fw-700" style={{ color: 'var(--green2)' }}>
            ✓
          </span>
        ) : null,
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      filterType: 'num',
      header: 'Lines',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (b) => b.lineCount,
    },
    {
      id: 'sub_assembly_count',
      sortFilterField: 'subAssemblyCount',
      filterType: 'num',
      header: 'Sub-Assemblies',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (b) => b.subAssemblyCount,
    },
    {
      id: 'levels',
      sortFilterField: 'levels',
      filterType: 'num',
      header: 'Levels',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (b) => b.levels,
    },
    {
      id: 'revision',
      sortFilterField: 'revision',
      filterType: 'num',
      header: 'BOM Rev',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (b) => <span style={{ color: 'var(--cyan)' }}>{b.revision}</span>,
    },
  ];
}
