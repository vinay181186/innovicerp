// BOM Master list columns (ADR-199 fit table). Moved out of routes/list.tsx
// to keep that file under 400 lines.

import type { BomMasterListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { StatusBadge } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';
import { statusText } from '@/lib/status-text';

const BOM_STATUS_OPTIONS = (['draft', 'active', 'obsolete'] as const).map((v) => ({
  value: v,
  label: statusText(v),
}));

// The sheet's columns. The sheet lays out AUTO (2026-09-26 list standard):
// only Sr No keeps a width; codes, revs, dates and counts sit on one line
// and the BOM name / parent item name wrap into what is left. Centred by the
// standard; BOM Name and Parent Item read from their left edge.
export function bomListColumns(offset = 0): DataTableColumn<BomMasterListItem>[] {
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
      id: 'bom_no',
      sortFilterField: 'bomNo',
      header: 'BOM No.',
      nowrap: true,
      // The part list opens from the fit table's ▸ (the row's ONE expand
      // control, ADR-199) — no chevron of its own here, so hiding or
      // dropping this column can never take the part list away.
      render: (b) => (
        <Link
          to="/bom-masters/$id"
          params={{ id: b.id }}
          className="td-code"
          title="Open this BOM"
          // stopPropagation on the link, not the cell, so clicking the rest
          // of the cell still opens the row.
          onClick={(e) => e.stopPropagation()}
        >
          {b.bomNo}
        </Link>
      ),
    },
    {
      id: 'bom_name',
      sortFilterField: 'bomName',
      kind: 'text',
      header: 'BOM Name',
      align: 'left',
      className: 'fw-700',
      key: 'bomName',
    },
    // Parent item code and name are two one-line columns (ADR-199 table
    // standard: every row one line). Code strong, name quiet.
    {
      id: 'parent_item_code',
      sortFilterField: 'parentItemCode',
      header: 'Parent Item Code',
      nowrap: true,
      render: (b) =>
        b.parentItemCode ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {b.parentItemCode}
          </span>
        ) : (
          <span style={{ color: 'var(--amber2)' }}>not set</span>
        ),
    },
    {
      id: 'parent_item_name',
      sortFilterField: 'parentItemName',
      header: 'Parent Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (b) => b.parentItemName ?? '—',
      title: (b) => b.parentItemName ?? '',
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      filterType: 'num',
      header: 'Items',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (b) => <span style={{ color: 'var(--purple)' }}>{b.lineCount}</span>,
    },
    {
      id: 'revision',
      sortFilterField: 'revision',
      filterType: 'num',
      header: 'BOM Rev',
      className: 'mono fw-700',
      nowrap: true,
      render: (b) => <span style={{ color: 'var(--cyan)' }}>BOM Rev {b.revision}</span>,
    },
    {
      id: 'revision_date',
      sortFilterField: 'revisionDate',
      kind: 'date',
      header: 'Revision Date',
      className: 'mono text2',
      nowrap: true,
      key: 'revisionDate',
      render: (b) => fmtDate(b.revisionDate),
    },
    {
      // Counts SO LINES that use this BOM (not orders) — same label as the detail.
      id: 'linked_so_count',
      sortFilterField: 'linkedSoCount',
      filterType: 'num',
      header: 'Linked SO Lines',
      align: 'right',
      nowrap: true,
      render: (b) =>
        b.linkedSoCount > 0 ? (
          <span className="fw-700" style={{ color: 'var(--green2)' }}>
            {b.linkedSoCount}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterOptions: BOM_STATUS_OPTIONS,
      kind: 'badge',
      header: 'BOM Status',
      nowrap: true,
      // `bom`, not the generic `doc` map: draft happens to agree, but active
      // and obsolete are not in `doc` at all. Same kind the BOM detail page
      // draws, so the two cannot disagree.
      render: (b) => <StatusBadge kind="bom" status={b.status} />,
    },
  ];
}
