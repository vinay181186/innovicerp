import { createRouter } from '@tanstack/react-router';
import { activityLogListRoute } from './modules/activity-log/routes/list';
import { clientsListRoute } from './modules/clients/routes/list';
import { clientDetailRoute } from './modules/clients/routes/detail';
import { clientEditRoute, clientNewRoute } from './modules/clients/routes/edit';
import { deliveryChallansListRoute } from './modules/delivery-challans/routes/list';
import { deliveryChallanDetailRoute } from './modules/delivery-challans/routes/detail';
import { ncRegisterListRoute } from './modules/nc-register/routes/list';
import { ncRegisterDetailRoute } from './modules/nc-register/routes/detail';
import { ncRegisterEditRoute } from './modules/nc-register/routes/edit';
import { ncRegisterNewRoute } from './modules/nc-register/routes/new';
import { itemsListRoute } from './modules/items/routes/list';
import { itemDetailRoute } from './modules/items/routes/detail';
import { itemEditRoute, itemNewRoute } from './modules/items/routes/edit';
import { goodsReceiptNotesListRoute } from './modules/goods-receipt-notes/routes/list';
import { goodsReceiptNoteDetailRoute } from './modules/goods-receipt-notes/routes/detail';
import {
  goodsReceiptNoteEditRoute,
  goodsReceiptNoteNewRoute,
} from './modules/goods-receipt-notes/routes/edit';
import { jobCardsListRoute } from './modules/job-cards/routes/list';
import { jobWorkOrdersListRoute } from './modules/job-work-orders/routes/list';
import { jobWorkOrderDetailRoute } from './modules/job-work-orders/routes/detail';
import { jobWorkOrderEditRoute, jobWorkOrderNewRoute } from './modules/job-work-orders/routes/edit';
import { machinesListRoute } from './modules/machines/routes/list';
import { machineDetailRoute } from './modules/machines/routes/detail';
import { machineEditRoute, machineNewRoute } from './modules/machines/routes/edit';
import { opEntryRoute } from './modules/op-entry/routes/index';
import { machineOpEntryRoute } from './modules/op-entry/routes/machines';
import { runningOpsRoute } from './modules/op-entry/routes/running';
import { operatorsListRoute } from './modules/operators/routes/list';
import { operatorDetailRoute } from './modules/operators/routes/detail';
import { operatorEditRoute, operatorNewRoute } from './modules/operators/routes/edit';
import { purchaseOrdersListRoute } from './modules/purchase-orders/routes/list';
import { purchaseOrderDetailRoute } from './modules/purchase-orders/routes/detail';
import {
  purchaseOrderEditRoute,
  purchaseOrderNewRoute,
} from './modules/purchase-orders/routes/edit';
import { purchaseOrderFromPrRoute } from './modules/purchase-orders/routes/from-pr';
import { purchaseRequestsListRoute } from './modules/purchase-requests/routes/list';
import { reportRunRoute } from './modules/reports/routes/run';
import { reportsListRoute } from './modules/reports/routes/list';
import { savedReportEditRoute } from './modules/saved-reports/routes/edit';
import { savedReportNewRoute } from './modules/saved-reports/routes/new';
import { savedReportRunRoute } from './modules/saved-reports/routes/run';
import { savedReportsListRoute } from './modules/saved-reports/routes/list';
import { storeTransactionsListRoute } from './modules/store-transactions/routes/list';
import { purchaseRequestDetailRoute } from './modules/purchase-requests/routes/detail';
import {
  purchaseRequestEditRoute,
  purchaseRequestNewRoute,
} from './modules/purchase-requests/routes/edit';
import { salesOrdersListRoute } from './modules/sales-orders/routes/list';
import { salesOrderDetailRoute } from './modules/sales-orders/routes/detail';
import { salesOrderEditRoute, salesOrderNewRoute } from './modules/sales-orders/routes/edit';
import { vendorsListRoute } from './modules/vendors/routes/list';
import { vendorDetailRoute } from './modules/vendors/routes/detail';
import { vendorEditRoute, vendorNewRoute } from './modules/vendors/routes/edit';
import { authCallbackRoute } from './routes/auth-callback';
import { authenticatedRoute } from './routes/_authenticated';
import { indexRoute } from './routes/index';
import { loginRoute } from './routes/login';
import { rootRoute } from './routes/__root';

const routeTree = rootRoute.addChildren([
  loginRoute,
  authCallbackRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    itemsListRoute,
    itemNewRoute,
    itemDetailRoute,
    itemEditRoute,
    clientsListRoute,
    clientNewRoute,
    clientDetailRoute,
    clientEditRoute,
    vendorsListRoute,
    vendorNewRoute,
    vendorDetailRoute,
    vendorEditRoute,
    machinesListRoute,
    machineNewRoute,
    machineDetailRoute,
    machineEditRoute,
    operatorsListRoute,
    operatorNewRoute,
    operatorDetailRoute,
    operatorEditRoute,
    opEntryRoute,
    runningOpsRoute,
    machineOpEntryRoute,
    salesOrdersListRoute,
    salesOrderNewRoute,
    salesOrderDetailRoute,
    salesOrderEditRoute,
    jobWorkOrdersListRoute,
    jobWorkOrderNewRoute,
    jobWorkOrderDetailRoute,
    jobWorkOrderEditRoute,
    jobCardsListRoute,
    purchaseRequestsListRoute,
    purchaseRequestNewRoute,
    purchaseRequestDetailRoute,
    purchaseRequestEditRoute,
    // Order matters: more-specific paths first so /purchase-orders/from-pr +
    // /purchase-orders/new beat /purchase-orders/$id.
    purchaseOrderFromPrRoute,
    purchaseOrderNewRoute,
    purchaseOrdersListRoute,
    purchaseOrderDetailRoute,
    purchaseOrderEditRoute,
    goodsReceiptNoteNewRoute,
    goodsReceiptNotesListRoute,
    goodsReceiptNoteDetailRoute,
    goodsReceiptNoteEditRoute,
    storeTransactionsListRoute,
    // Order matters: /nc-register/new + /nc-register/$id/edit win against /$id.
    ncRegisterNewRoute,
    ncRegisterListRoute,
    ncRegisterEditRoute,
    ncRegisterDetailRoute,
    deliveryChallansListRoute,
    deliveryChallanDetailRoute,
    // Order matters: /reports/$slug last so /reports beats it for the list view.
    reportsListRoute,
    reportRunRoute,
    // Order matters: /saved-reports/new + /saved-reports/$id/edit win against /$id.
    savedReportNewRoute,
    savedReportsListRoute,
    savedReportEditRoute,
    savedReportRunRoute,
    activityLogListRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
