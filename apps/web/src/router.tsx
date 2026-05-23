import { createRouter } from '@tanstack/react-router';
import { activityLogListRoute } from './modules/activity-log/routes/list';
import { alertsConfigRoute } from './modules/alerts/routes/config';
import { alertsDashboardRoute } from './modules/alerts/routes/dashboard';
import { alertsDrillRoute } from './modules/alerts/routes/drill';
import { bomMastersListRoute } from './modules/bom-master/routes/list';
import { bomMasterDetailRoute } from './modules/bom-master/routes/detail';
import { bomMasterNewRoute } from './modules/bom-master/routes/new';
import { bomMasterEditRoute } from './modules/bom-master/routes/edit';
import { routeCardsListRoute } from './modules/route-cards/routes/list';
import { routeCardDetailRoute } from './modules/route-cards/routes/detail';
import { routeCardNewRoute } from './modules/route-cards/routes/new';
import { routeCardEditRoute } from './modules/route-cards/routes/edit';
import { qcProcessesListRoute } from './modules/qc-processes/routes/list';
import { qcProcessDetailRoute } from './modules/qc-processes/routes/detail';
import { qcProcessNewRoute } from './modules/qc-processes/routes/new';
import { qcProcessEditRoute } from './modules/qc-processes/routes/edit';
import { costCentersListRoute } from './modules/cost-centers/routes/list';
import { costCenterDetailRoute } from './modules/cost-centers/routes/detail';
import { costCenterNewRoute } from './modules/cost-centers/routes/new';
import { costCenterEditRoute } from './modules/cost-centers/routes/edit';
import { usersListRoute } from './modules/users/routes/list';
import { userEditRoute } from './modules/users/routes/edit';
import { settingsRoute } from './modules/settings/routes';
import { clientsListRoute } from './modules/clients/routes/list';
import { clientDetailRoute } from './modules/clients/routes/detail';
import { clientEditRoute, clientNewRoute } from './modules/clients/routes/edit';
import { deliveryChallansListRoute } from './modules/delivery-challans/routes/list';
import { deliveryChallanDetailRoute } from './modules/delivery-challans/routes/detail';
import { deliveryChallanNewRoute } from './modules/delivery-challans/routes/create';
import { deliveryChallanReceiveRoute } from './modules/delivery-challans/routes/receive';
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
import { machineLoadingRoute } from './modules/machine-loading/routes/list';
import { productionDashboardRoute } from './modules/production-dashboard/routes/index';
import { operatorsListRoute } from './modules/operators/routes/list';
import { operatorDetailRoute } from './modules/operators/routes/detail';
import { operatorEditRoute, operatorNewRoute } from './modules/operators/routes/edit';
import { assemblyDetailRoute } from './modules/assembly/routes/detail';
import { assemblyListRoute } from './modules/assembly/routes/list';
import { planningDashboardRoute } from './modules/plans/routes/dashboard';
import { planDetailRoute } from './modules/plans/routes/detail';
import { planEditRoute } from './modules/plans/routes/edit';
import { plansListRoute } from './modules/plans/routes/list';
import { planNewRoute } from './modules/plans/routes/new';
import { purchaseOrdersListRoute } from './modules/purchase-orders/routes/list';
import { purchaseOrderDetailRoute } from './modules/purchase-orders/routes/detail';
import {
  purchaseOrderEditRoute,
  purchaseOrderNewRoute,
} from './modules/purchase-orders/routes/edit';
import { purchaseOrderFromPrRoute } from './modules/purchase-orders/routes/from-pr';
import { purchaseRequestsListRoute } from './modules/purchase-requests/routes/list';
import { qcDashboardRoute } from './modules/qc-dashboard/routes/index';
import { incomingQcRoute } from './modules/incoming-qc/routes/index';
import { qcHistoryRoute } from './modules/qc-history/routes/index';
import { qcCallRegisterRoute } from './modules/qc-call-register/routes/index';
import { capaListRoute } from './modules/capa/routes/list';
import { tpiRoute } from './modules/tpi/routes/index';
import { reportTypesListRoute } from './modules/report-types/routes/list';
import { soQcStatusRoute } from './modules/so-qc-status/routes/index';
import { qcCommandRoute } from './modules/qc-command/routes/index';
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
import { soOverviewListRoute } from './modules/so-overview/routes/list';
import { soPlanningWorkflowRoute } from './modules/so-planning/routes/workflow';
import { soStatusDetailRoute } from './modules/so-status/routes/detail';
import { soStatusIndexRoute } from './modules/so-status/routes/index';
import { soTimelineIndexRoute } from './modules/so-timeline/routes/index';
import { pendingSoValueRoute } from './modules/pending-so-value/routes/list';
import { storeIssuesListRoute } from './modules/store-issues/routes/list';
import { storeInventoryRoute } from './modules/store-inventory/routes/list';
import { toolIssuesListRoute } from './modules/tool-issues/routes/list';
import { partyMaterialsListRoute } from './modules/party-materials/routes/list';
import { partyGrnListRoute } from './modules/party-grn/routes/list';
import { jwDcListRoute } from './modules/jw-dc/routes/list';
import { designTrackerListRoute } from './modules/design-tracker/routes/list';
import { designProjectsListRoute } from './modules/design-projects/routes/list';
import { designProjectDetailRoute } from './modules/design-projects/routes/detail';
import { designIssuesListRoute } from './modules/design-issues/routes/list';
import { designWorkLogListRoute } from './modules/design-work-log/routes/list';
import { prodSoListRoute } from './modules/prod-so-list/routes/list';
import { prodJwListRoute } from './modules/prod-jw-list/routes/list';
import { dailyReportRoute } from './modules/daily-report/routes/list';
import { jcOpsRoute } from './modules/jc-ops/routes/list';
import { shopFloorRoute } from './modules/shop-floor/routes/list';
import { jobQueueRoute } from './modules/job-queue/routes/list';
import { productionScheduleRoute } from './modules/production-schedule/routes/list';
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
    machineLoadingRoute,
    productionDashboardRoute,
    salesOrdersListRoute,
    salesOrderNewRoute,
    salesOrderDetailRoute,
    salesOrderEditRoute,
    soStatusIndexRoute,
    soStatusDetailRoute,
    soTimelineIndexRoute,
    pendingSoValueRoute,
    storeIssuesListRoute,
    storeInventoryRoute,
    toolIssuesListRoute,
    partyMaterialsListRoute,
    partyGrnListRoute,
    jwDcListRoute,
    designTrackerListRoute,
    designProjectsListRoute,
    designProjectDetailRoute,
    designIssuesListRoute,
    designWorkLogListRoute,
    prodSoListRoute,
    prodJwListRoute,
    dailyReportRoute,
    jcOpsRoute,
    shopFloorRoute,
    jobQueueRoute,
    productionScheduleRoute,
    soOverviewListRoute,
    soPlanningWorkflowRoute,
    planningDashboardRoute,
    plansListRoute,
    planNewRoute,
    planDetailRoute,
    planEditRoute,
    assemblyListRoute,
    assemblyDetailRoute,
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
    deliveryChallanNewRoute,
    deliveryChallanDetailRoute,
    deliveryChallanReceiveRoute,
    // Order matters: /reports/$slug last so /reports beats it for the list view.
    reportsListRoute,
    reportRunRoute,
    // Order matters: /saved-reports/new + /saved-reports/$id/edit win against /$id.
    savedReportNewRoute,
    savedReportsListRoute,
    savedReportEditRoute,
    savedReportRunRoute,
    activityLogListRoute,
    qcDashboardRoute,
    incomingQcRoute,
    qcHistoryRoute,
    qcCallRegisterRoute,
    capaListRoute,
    tpiRoute,
    reportTypesListRoute,
    soQcStatusRoute,
    qcCommandRoute,
    // Order matters: /alerts/config beats /alerts/$code; /alerts list comes
    // before either so /alerts on its own resolves to the dashboard.
    alertsDashboardRoute,
    alertsConfigRoute,
    alertsDrillRoute,
    // BOM Master — order: new before $id before $id/edit so static path wins.
    bomMastersListRoute,
    bomMasterNewRoute,
    bomMasterDetailRoute,
    bomMasterEditRoute,
    // Route Cards — same ordering rule.
    routeCardsListRoute,
    routeCardNewRoute,
    routeCardDetailRoute,
    routeCardEditRoute,
    qcProcessesListRoute,
    qcProcessNewRoute,
    qcProcessDetailRoute,
    qcProcessEditRoute,
    costCentersListRoute,
    costCenterNewRoute,
    costCenterDetailRoute,
    costCenterEditRoute,
    usersListRoute,
    userEditRoute,
    settingsRoute,
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
