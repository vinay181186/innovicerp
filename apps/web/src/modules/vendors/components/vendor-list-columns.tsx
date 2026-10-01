// Vendor Master list columns (ADR-199 fit table). Moved out of
// routes/list.tsx to keep that file under 400 lines.

import type { Vendor } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatusBadge } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';

// The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
// column (rowActionsWidth below): 4+8+12+9+8+10+12+6+8+6+6 = 89, + 11 = 100,
// so the table never scrolls sideways. Centred by the standard; only Name is
// left-aligned so the vendor names share one edge, and the long free-text
// columns ellipsize with the full value on hover rather than wrapping the
// row taller.
export function vendorListColumns(): DataTableColumn<Vendor>[] {
  return [
    { id: 'sr_no', header: 'Sr No', width: '4%', className: 'text3', render: (_v, i) => i + 1 },
    {
      id: 'code',
      header: 'Vendor Code',
      width: '8%',
      nowrap: true,
      // A real link, so the code can be ctrl/middle-clicked into a new tab.
      // stopPropagation sits on the link (not the cell) so clicking the rest
      // of the cell still opens the row, exactly as before.
      render: (v) => (
        <Link
          to="/vendors/$id"
          params={{ id: v.id }}
          className="td-code"
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {v.code}
        </Link>
      ),
    },
    {
      id: 'name',
      header: 'Vendor Name',
      width: '12%',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      key: 'name',
    },
    {
      id: 'contact_person',
      header: 'Contact Person',
      width: '9%',
      ellipsis: true,
      render: (v) => v.contactPerson ?? '—',
      title: (v) => v.contactPerson ?? '',
    },
    { id: 'phone', header: 'Phone', width: '8%', nowrap: true, render: (v) => v.phone ?? '—' },
    {
      id: 'email',
      header: 'Email',
      width: '10%',
      className: 'text3',
      ellipsis: true,
      render: (v) => v.email ?? '—',
      title: (v) => v.email ?? '',
    },
    {
      id: 'gst_number',
      header: 'GSTIN',
      width: '12%',
      nowrap: true,
      render: (v) => v.gstNumber ?? '—',
    },
    {
      id: 'payment_terms_days',
      header: 'Payment Terms (days)',
      width: '6%',
      align: 'right',
      nowrap: true,
      render: (v) => v.paymentTermsDays ?? '—',
    },
    {
      id: 'address',
      header: 'Address',
      width: '8%',
      className: 'text3',
      ellipsis: true,
      render: (v) => v.addressLine1 ?? '—',
      title: (v) => v.addressLine1 ?? '',
    },
    {
      id: 'rating',
      header: 'Rating',
      width: '6%',
      nowrap: true,
      // Same letter->colour map the hand-rolled ratingBadgeClass carried
      // (A green · B blue · C amber · D red), and the same one the vendor
      // detail page already draws, so list and detail cannot disagree.
      render: (v) => <StatusBadge kind="rating" status={v.rating} />,
    },
    {
      id: 'is_active',
      kind: 'badge',
      header: 'Vendor Status',
      width: '6%',
      nowrap: true,
      render: (v) => <StatusBadge kind="active" status={String(v.isActive)} />,
    },
  ];
}
