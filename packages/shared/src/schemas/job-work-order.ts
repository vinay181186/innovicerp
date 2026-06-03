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
//     Carries the 4 HEADER-level client-material fields (migration 0053,
//     matching legacy CLIENT MATERIAL DETAILS L12839): `clientMaterial`,
//     `clientMaterialQty`, `materialReceivedDate`, `materialReceivedQty`.
//   - Lines: `rate` (processing charge per unit, migration 0053) + no
//     `clientPoLineNo`. Material fields moved off the line to the header.
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
  rate: z.string(), // processing charge per unit; numeric stored as string
  dueDate: z.string().nullable(), // ISO date
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
  // Client material details (header-level, per legacy CLIENT MATERIAL DETAILS
  // L12839). Client supplies raw material → we process → deliver finished parts.
  clientMaterial: z.string().nullable(),
  clientMaterialQty: z.string().nullable(), // numeric stored as string
  materialReceivedDate: z.string().nullable(),
  materialReceivedQty: z.string().nullable(),
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

/** List ROW = one job_work_order_line joined to its header (legacy
 *  renderJWMaster L12644-12671 lists one row per line). Columns, in order:
 *  JW NO. · LINE · DATE · CLIENT · CLIENT PO · ITEM CODE · PART NAME · QTY ·
 *  JC QTY · MATERIAL · DUE · STATUS · REMARKS. Material status reads the
 *  header materialReceivedQty vs the line orderQty (legacy L12648). */
export const jobWorkOrderListItemSchema = z.object({
  jwId: z.string().uuid(),
  lineId: z.string().uuid(),
  code: z.string(),
  lineNo: z.number().int(),
  jwDate: z.string(),
  clientId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  itemCode: z.string().nullable(),
  partName: z.string(),
  orderQty: z.number().int().nonnegative(),
  /** Σ job_cards.order_qty whose source_jw_line_id = this line. */
  jcQty: z.number().int().nonnegative(),
  dueDate: z.string().nullable(),
  status: jwStatusSchema,
  remarks: z.string().nullable(),
  /** Header-level client material (drives the MATERIAL column). */
  clientMaterialQty: z.string().nullable(),
  materialReceivedQty: z.string().nullable(),
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
    rate: z.coerce.number().nonnegative().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
      .optional(),
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
  // Client material details (header-level).
  clientMaterial: z.string().max(255).optional(),
  clientMaterialQty: z.coerce.number().nonnegative().optional(),
  materialReceivedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'materialReceivedDate must be YYYY-MM-DD')
    .optional(),
  materialReceivedQty: z.coerce.number().nonnegative().optional(),
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
