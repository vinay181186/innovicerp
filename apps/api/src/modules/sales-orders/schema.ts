// Re-export shared Zod schemas. Per CLAUDE.md §8, modules may host their own
// schemas or re-export from @innovic/shared; we re-export so the source of
// truth stays in the shared package and frontend uses the same types.
export {
  closeSalesOrderInputSchema,
  createSalesOrderInputSchema,
  listSalesOrdersQuerySchema,
  salesOrderDetailSchema,
  salesOrderLineSchema,
  salesOrderListItemSchema,
  salesOrderSchema,
  shortCloseSalesOrderLineInputSchema,
  soDrawingHistoryLineSchema,
  soDrawingHistorySchema,
  soDrawingRevisionSchema,
  updateSalesOrderInputSchema,
} from '@innovic/shared';
export type {
  CloseSalesOrderInput,
  CreateSalesOrderInput,
  DocumentTraceability,
  ListSalesOrdersQuery,
  ListSalesOrdersResponse,
  RelatedDoc,
  SalesOrder,
  SalesOrderDetail,
  SalesOrderLine,
  SalesOrderLineInput,
  SalesOrderListItem,
  SalesOrderMilestoneInput,
  ShortCloseSalesOrderLineInput,
  SoDrawingAction,
  SoDrawingHistory,
  SoDrawingHistoryLine,
  SoDrawingRevision,
  SoMilestone,
  UpdateSalesOrderInput,
} from '@innovic/shared';
