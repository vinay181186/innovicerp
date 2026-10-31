// QC Process Master list columns — moved out of routes/list.tsx (400-line
// ceiling) when ADR-252 added the Report Type column.
//
// The sheet's columns, unchanged from the hand-written <colgroup>: the widths
// are `%` and must sum to 100 WITH the Action column (rowActionsWidth below):
// 5+24+26+14+11+10 = 90, + 10 = 100, so the table never scrolls sideways.
// Centred by the standard; only the process name is left-aligned (a name
// reads from its left edge).

import type { QcProcess } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Badge, StatusBadge } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';

// Sort & Filter tick list (ADR-200): the stored boolean as text.
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export function buildQcProcessColumns(
  currentPage: number,
  pageSize: number,
): DataTableColumn<QcProcess>[] {
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      width: '5%',
      className: 'text3',
      // Server-paged list: the serial number continues across pages.
      render: (_p, i) => (currentPage - 1) * pageSize + i + 1,
    },
    {
      // The QC Process Name IS the stored code.
      id: 'name',
      sortFilterField: 'code',
      header: 'QC Process Name',
      width: '24%',
      align: 'left',
      ellipsis: true,
      title: (p) => p.code,
      // The master code — strong (mono fw-700 in --text), never the faint
      // --text3, and a real link so it can be ctrl/middle-clicked into a new
      // tab. stopPropagation sits on the link (not the cell) so clicking the
      // rest of the cell still opens the row, exactly as before.
      render: (p) => (
        <Link
          to="/qc-processes/$id"
          params={{ id: p.id }}
          className="mono fw-700"
          style={{ color: 'var(--text)', textDecoration: 'none' }}
          title="Open this QC process"
          onClick={(e) => e.stopPropagation()}
        >
          {p.code}
        </Link>
      ),
    },
    {
      id: 'description',
      sortFilterField: 'description',
      header: 'Description',
      width: '26%',
      className: 'text2',
      ellipsis: true,
      render: (p) => p.description ?? '—',
      title: (p) => p.description ?? '',
    },
    {
      // ADR-252 — the report this QC step produces; "Mandatory" when the
      // Report Type is compulsory (Submit QC then needs the file).
      id: 'report_type',
      header: 'Report Type',
      width: '14%',
      nowrap: true,
      render: (p) =>
        p.reportTypeName ? (
          <span>
            {p.reportTypeName}
            {p.reportMandatory ? (
              <Badge tone="red" style={{ marginLeft: 6 }}>
                {p.reportLastStageOnly ? 'Mandatory (last stage only)' : 'Mandatory'}
              </Badge>
            ) : null}
          </span>
        ) : (
          '—'
        ),
      title: (p) => p.reportTypeName ?? '',
    },
    {
      id: 'default_cycle_time',
      sortFilterField: 'defaultCycleTimeMin',
      filterType: 'num',
      header: 'Default Cycle Time (min)',
      width: '11%',
      className: 'mono',
      nowrap: true,
      render: (p) =>
        Number(p.defaultCycleTimeMin) > 0 ? Number(p.defaultCycleTimeMin).toFixed(2) : '—',
    },
    {
      id: 'is_active',
      sortFilterField: 'isActive',
      filterOptions: ACTIVE_OPTIONS,
      kind: 'badge',
      header: 'Active',
      width: '10%',
      nowrap: true,
      // kind="masteractive": a Quality master paints Inactive AMBER, not the
      // generic `active` kind's red — the row is retired from the QC pickers,
      // which is a thing to notice, not a fault. Carried verbatim, and it is
      // the same chip the QC process DETAIL page draws, so the two cannot
      // disagree.
      render: (p) => <StatusBadge kind="masteractive" status={String(p.isActive)} />,
    },
  ];
}
