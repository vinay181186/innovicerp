// Operator Master list columns (ADR-199 fit table). Moved out of
// routes/list.tsx to keep that file under 400 lines.

import type { Operator } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatusBadge } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';

// The sheet's columns. The sheet lays out AUTO (2026-09-26 list standard):
// only Sr No keeps a width; codes, qty and badges sit on one line and size
// their own column, and the name columns wrap into whatever is left, so
// nothing spills over a gridline and the Action column (1% = shrink to its
// buttons) is never pushed off the screen. Centred by the standard; names
// read from their left edge, numbers sit right.
// Sort & Filter runs on the SERVER (ADR-200): `sortFilterField` names the
// field in api operators/sf-columns.ts. Active is the stored boolean as text.
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export function operatorListColumns(firstRowNo: number): DataTableColumn<Operator>[] {
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      width: '5%',
      className: 'text3',
      // Server-paged list: the serial number continues across pages.
      render: (_op, i) => firstRowNo + i,
    },
    {
      id: 'code',
      sortFilterField: 'code',
      filterType: 'text',
      header: 'Code',
      nowrap: true,
      // A real link, so the code can be ctrl/middle-clicked into a new tab.
      // stopPropagation sits on the link (not the cell) so clicking the rest
      // of the cell still opens the row, exactly as before.
      render: (op) => (
        <Link
          to="/operators/$id"
          params={{ id: op.id }}
          className="td-code"
          title="Open this operator"
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {op.code}
        </Link>
      ),
    },
    {
      id: 'name',
      sortFilterField: 'name',
      kind: 'text',
      header: 'Name',
      align: 'left',
      className: 'fw-700',
      key: 'name',
    },
    {
      id: 'department',
      sortFilterField: 'department',
      filterType: 'text',
      header: 'Department',
      className: 'text2',
      render: (op) => op.department ?? '—',
    },
    {
      id: 'skills',
      sortFilterField: 'skills',
      kind: 'text',
      header: 'Skills / Machines',
      align: 'left',
      className: 'text2',
      render: (op) => op.skills ?? '—',
      title: (op) => op.skills ?? '',
    },
    {
      id: 'is_active',
      sortFilterField: 'isActive',
      filterOptions: ACTIVE_OPTIONS,
      kind: 'badge',
      header: 'Active',
      nowrap: true,
      // kind="active" — the same chip the operator DETAIL page draws, so the
      // two cannot disagree, and the same one the Client Master reference
      // list uses for a master's Active flag. The hand-written chip this
      // replaces was green / grey.
      render: (op) => <StatusBadge kind="active" status={String(op.isActive)} />,
    },
  ];
}
