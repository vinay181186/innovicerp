// Re-export shared Zod schemas. Per CLAUDE.md §8, modules may host their own
// schemas or re-export from @innovic/shared; we re-export so the source of
// truth stays in the shared package and frontend uses the same types.
export {
  createSalesOrderInputSchema,
  listSalesOrdersQuerySchema,
  salesOrderDetailSchema,
  salesOrderLineSchema,
  salesOrderListItemSchema,
  salesOrderSchema,
  updateSalesOrderInputSchema,
} from '@innovic/shared';
export type {
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
  SoMilestone,
  UpdateSalesOrderInput,
} from '@innovic/shared';
