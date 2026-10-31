// ADR-264 — Purchase checks, each the ADR-250 home rule imported as is:
//   pur_pr_pending  — personal/rows-purchase.ts prToPoSql (pr_to_po: every live
//                     PR with balance still to order — PRs have no approval,
//                     owner rule 2026-10-31; the same three conditions as
//                     purchase-requests prWaitingForPoSql).
//   pur_po_overdue  — poOverdueSql (issued PO past its Due Date), narrowed to
//                     POs whose Pending (lib/po-pending, qty − accepted) > 0.
//   pur_po_approval — poDraftSql (PO in draft, waiting approval); the status
//                     reads how long it has waited since its PO Date.

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { poDraftSql, poOverdueSql, prToPoSql } from '../personal/rows-purchase';
import { type CheckDef, narrow } from './types';

export const PURCHASE_CHECKS: readonly CheckDef[] = [
  {
    key: 'pur_pr_pending',
    dept: 'purchase',
    label: 'PR pending for PO',
    head: ['PR No.', 'Vendor', 'Due Date'],
    href: '/purchase-requests',
    query: (c) => prToPoSql(c.cid, c.today, {}),
    docHref: (r) => docNavPage('purchase-request', r.id),
    dated: true,
  },
  {
    key: 'pur_po_overdue',
    dept: 'purchase',
    label: 'Overdue POs (material not received)',
    head: ['PO No.', 'Vendor', 'Due Date'],
    href: '/purchase-orders',
    query: (c) => narrow(poOverdueSql(c.cid, c.today, {}), sql`x.qty > 0`),
    docHref: (r) => docNavPage('purchase-order', r.id),
    dated: true,
  },
  {
    key: 'pur_po_approval',
    dept: 'purchase',
    label: 'PO waiting for approval',
    head: ['PO No.', 'Vendor', 'PO Date'],
    href: '/purchase-orders',
    query: (c) => poDraftSql(c.cid, c.today, {}),
    docHref: (r) => docNavPage('purchase-order', r.id),
    dated: false,
  },
];
