// Job Work Order shared schemas (T-031).
//
// Header + lines, mirroring the legacy JW Master / JW form
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html — `renderJWMaster()`
// line 12642, `jwHeaderForm()` line 12784, `addJW()` line 12885) on top of the
// Phase 4 storage layer (job_work_orders + job_work_order_lines, ADR-012).
//
// Differences from `sales-order.ts`:
//   - Header: no `type`, no `gstPercent`, no `costCenter`, no BOM fields.
//     Status uses the same `so_status` enum (ADR-012 #5 — semantics identical).
//   - Lines: no `rate`, no `clientPoLineNo`. Add 4 client-material fields:
//     `clientMaterial`, `clientMaterialQty`, `materialReceivedDate`,
//     `materialReceivedQty`. (Legacy form puts these at header level since
//     all current JWs are single-line; our DB stores them per-line for
//     forward-compat with multi-line JWs.)
//
// Same write contracts:
//   - `createJobWorkOrderInputSchema` and `updateJobWorkOrderInputSchema`
//     accept `{header, lines}`; service runs the merge in one transaction
//     using the same option-C semantics as sales orders.
//   - Header requires `clientId` OR `customerName` (ADR-012 #9).
//   - Each line requires `itemId` OR `itemCodeText` (ADR-012 #10).
//   - JWs always require ≥ 1 line (no Equipment exception).

import { z } from 'zod';
import { SO_STATUSES } from '../enums/so-status';
import { uomSchema } from './item';

export const jwStatusSchema = z.enum(SO_STATUSES);

const codeRegex = /^[A-Za-z0-9._/-]+$/; // legacy jwNo allows '/'

// ─── Read shapes ───────────────────────────────────────────────────────────

export const jobWorkOrderLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  jobWorkOrderId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  partName: z.string(),
  material: z.string().nullable(),
  drawingNo: z.string().nullable(),
  uom: uomSchema,
  orderQty: z.number().int().positive(),
  dueDate: z.string().nullable(), // ISO date
  clientMaterial: z.string().nullable(),
  clientMaterialQty: z.string().nullable(), // numeric stored as string
  materialReceivedDate: z.string().nullable(),
  materialReceivedQty: z.string().nullable(),
  status: jwStatusSchema,
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JobWorkOrderLine = z.infer<typeof jobWorkOrderLineSchema>;

export const jobWorkOrderSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  jwDate: z.string(), // ISO date
  clientId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  status: jwStatusSchema,
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JobWorkOrder = z.infer<typeof jobWorkOrderSchema>;

export const jobWorkOrderDetailSchema = jobWorkOrderSchema.extend({
  lines: z.array(jobWorkOrderLineSchema),
});
export type JobWorkOrderDetail = z.infer<typeof jobWorkOrderDetailSchema>;

/** List row: header + aggregates from job_work_order_lines + linked job_cards.
 *  Mirrors legacy renderJWMaster columns line 12685 (Qty, JC Qty, Material, Due). */
export const jobWorkOrderListItemSchema = jobWorkOrderSchema.extend({
  lineCount: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  jcQty: z.number().int().nonnegative(),
  /** Sum of materialReceivedQty across all lines (numeric string). Renders
   *  the legacy "Material" column: ✓ Full / ◑ Partial / ✕ Not Received. */
  materialReceivedQtyTotal: z.string(),
  /** Sum of clientMaterialQty across all lines. */
  clientMaterialQtyTotal: z.string(),
  /** MIN(line.due_date) across non-deleted lines. Drives the "Due" col +
   *  red-when-overdue colour. */
  earliestDueDate: z.string().nullable(),
});
export type JobWorkOrderListItem = z.infer<typeof jobWorkOrderListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const jobWorkOrderLineInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    lineNo: z.number().int().positive().optional(),
    itemId: z.string().uuid().optional(),
    itemCodeText: z.string().min(1).max(64).optional(),
    partName: z.string().min(1).max(255),
    material: z.string().max(255).optional(),
    drawingNo: z.string().max(64).optional(),
    uom: uomSchema.default('NOS'),
    orderQty: z.number().int().positive(), // CHECK > 0 in DB too
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
      .optional(),
    clientMaterial: z.string().max(255).optional(),
    clientMaterialQty: z.coerce.number().nonnegative().optional(),
    materialReceivedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'materialReceivedDate must be YYYY-MM-DD')
      .optional(),
    materialReceivedQty: z.coerce.number().nonnegative().optional(),
    status: jwStatusSchema.optional(),
  })
  .refine((l) => Boolean(l.itemId) || Boolean(l.itemCodeText?.trim()), {
    message: 'itemId or itemCodeText is required (per ADR-012 #10)',
  });
export type JobWorkOrderLineInput = z.infer<typeof jobWorkOrderLineInputSchema>;

const _jwHeaderInputBase = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen'),
  jwDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'jwDate must be YYYY-MM-DD'),
  clientId: z.string().uuid().optional(),
  customerName: z.string().max(255).optional(),
  clientPoNo: z.string().max(64).optional(),
  status: jwStatusSchema.default('open'),
  remarks: z.string().max(2000).optional(),
});

/** CREATE — `{header, lines}`. Header + ≥ 1 line (no Equipment exception
 *  on JWs); service runs both inserts in one transaction. */
export const createJobWorkOrderInputSchema = z.object({
  header: _jwHeaderInputBase.refine((h) => Boolean(h.clientId) || Boolean(h.customerName?.trim()), {
    message: 'clientId or customerName is required (per ADR-012 #9)',
  }),
  lines: z.array(jobWorkOrderLineInputSchema).min(1, 'At least one line is required'),
});
export type CreateJobWorkOrderInput = z.infer<typeof createJobWorkOrderInputSchema>;

/** UPDATE — same shape; lines optional (option C merge). `code` immutable. */
export const updateJobWorkOrderInputSchema = z.object({
  header: _jwHeaderInputBase.partial().omit({ code: true }),
  lines: z.array(jobWorkOrderLineInputSchema).optional(),
});
export type UpdateJobWorkOrderInput = z.infer<typeof updateJobWorkOrderInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listJobWorkOrdersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  status: jwStatusSchema.optional(),
  clientId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJobWorkOrdersQuery = z.infer<typeof listJobWorkOrdersQuerySchema>;

export interface ListJobWorkOrdersResponse {
  items: JobWorkOrderListItem[];
  total: number;
  limit: number;
  offset: number;
}
