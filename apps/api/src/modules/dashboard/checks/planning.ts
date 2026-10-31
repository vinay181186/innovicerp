// ADR-264 — Planning checks, each the ADR-250 home rule imported as is:
//   plan_so_unplanned — personal/rows-planning.ts soToPlanSql (so_to_plan:
//                       open SO / JWSO with qty still To Plan; one row per
//                       order, Due Date = earliest line still to plan).
//   plan_rc_approval  — personal/rows-route-card.ts rcPendingSql (new Route
//                       Cards Pending Approval); its date is the card's
//                       Created On (IST day), the status reads its age.

import { soToPlanSql } from '../personal/rows-planning';
import { rcPendingSql } from '../personal/rows-route-card';
import { orderHref } from './sales';
import type { CheckDef } from './types';

export const PLANNING_CHECKS: readonly CheckDef[] = [
  {
    key: 'plan_so_unplanned',
    dept: 'planning',
    label: 'SO lines not planned',
    head: ['SO No.', 'Internal SO No.', 'Due Date'],
    href: '/planning',
    query: (c) => soToPlanSql(c.cid, c.today, {}),
    docHref: orderHref,
    refCode: (r) => r.x1,
    dated: true,
  },
  {
    key: 'plan_rc_approval',
    dept: 'planning',
    label: 'Route Card waiting approval',
    // A new card has no parent document: the reference column stays empty.
    head: ['RC No.', '—', 'Created On'],
    href: '/route-cards',
    query: (c) => rcPendingSql(c.cid, {}),
    docHref: (r) => `/route-cards/${r.id}`,
    dated: false,
    // rcPendingSql's qty is the card's op count, not a quantity.
    noQty: true,
  },
];
