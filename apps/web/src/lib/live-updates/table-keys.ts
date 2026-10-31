// ADR-230 — which screens show each live table, so a change to that table
// refreshes exactly those screens.
//
// Typed `Record<LiveTable, …>`: a table added to LIVE_TABLES (packages/shared)
// and not mapped here fails the build, instead of quietly refreshing nothing.
//
// Every key is a module's own key factory root — never a hand-typed array — so
// renaming a module's keys cannot silently disconnect it from live updates.
// Invalidating a root refetches only the queries currently on screen (TanStack
// Query's default `refetchType: 'active'`); the rest are just marked stale.

import type { LiveTable } from '@innovic/shared';
import type { QueryKey } from '@tanstack/react-query';
import { approvalsKeys } from '@/modules/approvals/api';
import { dispatchKeys } from '@/modules/customer-dispatches/api';
import { dashboardKeys } from '@/modules/dashboard/api';
import { dayLogKeys } from '@/modules/day-logs/api';
import { cancelKeys } from '@/modules/cancel-requests/api';
import { deliveryChallansKeys } from '@/modules/delivery-challans/api';
import { documentEditsKeys } from '@/modules/document-edits/api';
import { goodsReceiptNotesKeys } from '@/modules/goods-receipt-notes/api';
import { incomingQcKeys } from '@/modules/incoming-qc/api';
import { invoiceKeys } from '@/modules/invoices/api';
import { jcOpsBoardKeys } from '@/modules/jc-ops/api';
import { jobCardsKeys } from '@/modules/job-cards/api';
import { jobQueueKeys } from '@/modules/job-queue/api';
import { jwInvoicesKeys } from '@/modules/jw-invoices/api';
import { mlBomsKeys } from '@/modules/ml-bom/api';
import { mlPlansKeys } from '@/modules/ml-plan/api';
import { ncRegisterKeys } from '@/modules/nc-register/api';
import { opEntryKeys } from '@/modules/op-entry/api';
import { plansKeys } from '@/modules/plans/api';
import { productionDashboardKeys } from '@/modules/production-dashboard/api';
import { productionOrdersKeys } from '@/modules/production-orders/api';
import { purchaseOrdersKeys } from '@/modules/purchase-orders/api';
import { purchaseRequestsKeys } from '@/modules/purchase-requests/api';
import { qcCommandKeys } from '@/modules/qc-command/api';
import { QC_DOCUMENT_VIEWS } from '@/modules/qc-documents/api';
import { qcHistoryKeys } from '@/modules/qc-history/api';
import { routeCardsKeys } from '@/modules/route-cards/api';
import { salesOrdersKeys } from '@/modules/sales-orders/api';
import { shopFloorKeys } from '@/modules/shop-floor/api';
import { soOverviewKeys } from '@/modules/so-overview/api';
import { soPlanningKeys } from '@/modules/so-planning/api';
import { soStatusKeys } from '@/modules/so-status/api';

// ADR-250 — the per-person home (dashboardKeys.home(), both scopes) shows job
// cards, ops, sales orders, purchase documents, GRNs, PROs and edit requests, so
// each of those tables refreshes it (only the home query, not KPIs / widgets).

/** Everything that shows a job card's header, status or op progress. */
const PRODUCTION_VIEWS: readonly QueryKey[] = [
  jobCardsKeys.all,
  dashboardKeys.home(),
  jobQueueKeys.all,
  jcOpsBoardKeys.all,
  shopFloorKeys.all,
  productionDashboardKeys.all,
  soStatusKeys.all,
  soOverviewKeys.all,
];

/** An op's progress and its QC call: Op Entry, the QC Call Register and QC
 *  Command read it, as well as every production view. A QC clear writes both
 *  jc_ops and op_log (op-entry service `submitQcLog`). */
const OP_VIEWS: readonly QueryKey[] = [
  ...PRODUCTION_VIEWS,
  opEntryKeys.all,
  qcHistoryKeys.all,
  qcCommandKeys.all,
];

const SALES_ORDER_VIEWS: readonly QueryKey[] = [
  salesOrdersKeys.all,
  dashboardKeys.home(),
  soStatusKeys.all,
  soOverviewKeys.all,
];

/** A PO's approval state shows in the Approvals inbox; its received qty shows
 *  on GRN create. An incoming QC decision updates GRN lines (not published) and
 *  then re-totals the PO lines — so a PO change is also how Incoming QC and the
 *  QC Call Register hear that an incoming call was cleared. */
const PURCHASE_ORDER_VIEWS: readonly QueryKey[] = [
  purchaseOrdersKeys.all,
  dashboardKeys.home(),
  goodsReceiptNotesKeys.all,
  approvalsKeys.all,
  incomingQcKeys.all,
  qcHistoryKeys.all,
];

/** ADR-233 — a Production Order's status, Stock Received and close history.
 *  A close or Short Close also moves the plan's Pending (plans + SO planning),
 *  the PRO coverage SO Status / SO Overview show, and freezes or re-opens the
 *  order's Job Card (the JC page reads its order through forJobCard, which
 *  sits under productionOrdersKeys.all). */
const PRODUCTION_ORDER_VIEWS: readonly QueryKey[] = [
  productionOrdersKeys.all,
  plansKeys.all,
  soPlanningKeys.all,
  soStatusKeys.all,
  soOverviewKeys.all,
  jobCardsKeys.all,
];

/** 0227 — a Route Card or its ops. Approval drives PRO / plan status (ADR-253)
 *  and the home "RC pending approval" rows; ML BOM / ML Plan show the card. */
const ROUTE_CARD_VIEWS: readonly QueryKey[] = [
  routeCardsKeys.all,
  plansKeys.all,
  soPlanningKeys.all,
  productionOrdersKeys.all,
  jobCardsKeys.all,
  mlBomsKeys.all,
  mlPlansKeys.all,
  dashboardKeys.home(),
  // ADR-265 — a NEW card waits in the Approvals list until approved.
  approvalsKeys.all,
];

/** 0227 — a delivery challan (OSP / RTV / returnable) moves op progress, the
 *  PO's sent qty, the NC it returns against and GRN-against-DC. */
const DELIVERY_CHALLAN_VIEWS: readonly QueryKey[] = [
  deliveryChallansKeys.all,
  jcOpsBoardKeys.all,
  jobCardsKeys.all,
  purchaseOrdersKeys.all,
  ncRegisterKeys.all,
  goodsReceiptNotesKeys.all,
  soStatusKeys.all,
];

/** 0227 — an NC raised, disposed or closed: the register, the JC and op it
 *  came from, the QC screens and the home rows. */
const NC_VIEWS: readonly QueryKey[] = [
  ncRegisterKeys.all,
  jobCardsKeys.all,
  opEntryKeys.all,
  qcCommandKeys.all,
  incomingQcKeys.all,
  goodsReceiptNotesKeys.all,
  dashboardKeys.home(),
];

export const LIVE_TABLE_KEYS: Readonly<Record<LiveTable, readonly QueryKey[]>> = {
  job_cards: PRODUCTION_VIEWS,
  jc_ops: OP_VIEWS,
  // ADR-265 — an Op Entry time change waits in the Approvals list.
  // Not approvalsKeys: queueing a time change writes only
  // op_log_time_change_requests (not live), and every op entry save would
  // re-read every user's Approvals badge — the 60 s poll covers it (ADR-265).
  op_log: OP_VIEWS,
  sales_orders: SALES_ORDER_VIEWS,
  sales_order_lines: SALES_ORDER_VIEWS,
  purchase_orders: PURCHASE_ORDER_VIEWS,
  purchase_order_lines: PURCHASE_ORDER_VIEWS,
  purchase_requests: [purchaseRequestsKeys.all, approvalsKeys.all, dashboardKeys.home()],
  // A new GRN raises an incoming QC call on the QC Call Register.
  goods_receipt_notes: [
    goodsReceiptNotesKeys.all,
    incomingQcKeys.all,
    qcHistoryKeys.all,
    purchaseOrdersKeys.all,
    dashboardKeys.home(),
  ],
  document_edit_requests: [documentEditsKeys.all, approvalsKeys.all, dashboardKeys.home()],
  // ADR-235: a Cancel Request raised / decided — the dialog, the Approvals tab and
  // the documents it may have just cancelled.
  cancel_requests: [
    cancelKeys.all,
    approvalsKeys.all,
    dashboardKeys.home(),
    invoiceKeys.all,
    jwInvoicesKeys.all,
    dispatchKeys.all,
  ],
  production_orders: [...PRODUCTION_ORDER_VIEWS, dashboardKeys.home()],
  production_order_closes: PRODUCTION_ORDER_VIEWS,
  // Day Log (owner 2026-10-26): a day submitted / reopened / left on Leave, or
  // a timer started on another PC — My Day Log and Team Day Logs. ADR-255: NOT
  // dashboardKeys.home() — daily_reports is company-wide readable, so that
  // would refetch every user's Home on every save; a reply reaches the owner's
  // Home 🔔 on its 60 s poll / focus refetch instead.
  // Not approvalsKeys: every Day Log save touches this company-wide row, so it
  // would re-read every user's Approvals badge; the rare (pre-ADR-256) Day Log
  // edit reaches the Approvals list on its 60 s poll / focus refetch (ADR-265).
  daily_reports: [dayLogKeys.all, dashboardKeys.widgets()],
  // Teams Config (0230; one-way since 0231): a User → mate row added / removed.
  // Realtime reaches only that User (read rule user_id = me) — their Team tab,
  // its people and person pages; another Super Admin's Teams Config list
  // refreshes on focus / its own saves.
  day_log_team_mates: [
    dayLogKeys.access(),
    dayLogKeys.teamAll(),
    dayLogKeys.teamMatesAll(),
    dayLogKeys.personDayAll(),
  ],
  customer_dispatches: [
    dispatchKeys.all,
    salesOrdersKeys.all,
    soStatusKeys.all,
    soOverviewKeys.all,
    dashboardKeys.home(),
  ],
  delivery_challans: DELIVERY_CHALLAN_VIEWS,
  nc_register: NC_VIEWS,
  // 0227 — the same screens this PC refreshes after its own QC upload.
  qc_documents: QC_DOCUMENT_VIEWS,
  // ML Plan reads the ML BOM tree it was planned from.
  ml_boms: [mlBomsKeys.all, mlPlansKeys.all],
  ml_bom_lines: [mlBomsKeys.all, mlPlansKeys.all],
  // The SO detail shows its ML plans.
  ml_plans: [mlPlansKeys.all, salesOrdersKeys.all],
  ml_plan_nodes: [mlPlansKeys.all],
  route_cards: ROUTE_CARD_VIEWS,
  route_card_ops: ROUTE_CARD_VIEWS,
};
