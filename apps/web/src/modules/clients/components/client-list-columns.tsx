// Customer Master list columns (ADR-199 fit table). Moved out of
// routes/list.tsx to keep that file under 400 lines.

import type { Client } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatusBadge } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';

// The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
// column (rowActionsWidth below): 4+9+22+19+13+15+7 = 89, + 11 = 100, so the
// table never scrolls sideways. Centred by the standard; only Customer is
// left-aligned so the names share one edge, and the long free-text columns
// ellipsize with the full value on hover rather than wrapping the row taller.
// `offset` = the first row's position on this page (ADR-201 paging), so Sr No
// keeps counting across pages. `sortFilterField` = the field in the API's
// CLIENT_SF_COLUMNS map (Sort & Filter runs on the server — ADR-200).
export function clientListColumns(offset = 0): DataTableColumn<Client>[] {
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      width: '4%',
      className: 'text3',
      render: (_c, i) => offset + i + 1,
    },
    {
      id: 'code',
      header: 'Code',
      width: '9%',
      sortFilterField: 'code',
      nowrap: true,
      // A real link, so the code can be ctrl/middle-clicked into a new tab.
      // stopPropagation sits on the link (not the cell) so clicking the rest
      // of the cell still opens the row, exactly as before.
      render: (c) => (
        <Link
          to="/clients/$id"
          params={{ id: c.id }}
          className="td-code"
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {c.code}
        </Link>
      ),
    },
    {
      id: 'name',
      header: 'Customer',
      sortFilterField: 'name',
      width: '22%',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      key: 'name',
    },
    {
      id: 'address',
      header: 'Address',
      sortFilterField: 'address',
      width: '19%',
      className: 'text2',
      ellipsis: true,
      render: (c) => c.addressLine1 ?? '—',
      title: (c) => c.addressLine1 ?? '',
    },
    {
      id: 'contact',
      header: 'Contact',
      sortFilterField: 'contact',
      width: '13%',
      className: 'text2',
      ellipsis: true,
      render: (c) => c.contactPerson ?? '—',
      title: (c) => c.contactPerson ?? '',
    },
    {
      id: 'email',
      header: 'Email',
      sortFilterField: 'email',
      width: '15%',
      className: 'text2',
      ellipsis: true,
      render: (c) => c.email ?? '—',
      title: (c) => c.email ?? '',
    },
    {
      id: 'is_active',
      kind: 'badge',
      header: 'Active',
      width: '7%',
      nowrap: true,
      render: (c) => <StatusBadge kind="active" status={c.isActive ? 'active' : 'inactive'} />,
    },
  ];
}
