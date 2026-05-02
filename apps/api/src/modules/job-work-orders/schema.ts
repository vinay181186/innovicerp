// Re-export shared Zod schemas. Per CLAUDE.md §8, modules may host their own
// schemas or re-export from @innovic/shared; we re-export so the source of
// truth stays in the shared package and frontend uses the same types.
export {
  createJobWorkOrderInputSchema,
  jobWorkOrderDetailSchema,
  jobWorkOrderLineSchema,
  jobWorkOrderListItemSchema,
  jobWorkOrderSchema,
  listJobWorkOrdersQuerySchema,
  updateJobWorkOrderInputSchema,
} from '@innovic/shared';
export type {
  CreateJobWorkOrderInput,
  JobWorkOrder,
  JobWorkOrderDetail,
  JobWorkOrderLine,
  JobWorkOrderLineInput,
  JobWorkOrderListItem,
  ListJobWorkOrdersQuery,
  ListJobWorkOrdersResponse,
  UpdateJobWorkOrderInput,
} from '@innovic/shared';
