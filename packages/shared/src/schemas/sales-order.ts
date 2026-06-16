// Sales Order shared schemas (T-030).
//
// Header + lines, mirroring the legacy SO Master / SO line form
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html — `renderSOmaster()`
// line 11839, `soHeaderForm()` line 12183, `addSO()` line 12413, `_editFullSO()`
// line 12531) on top of the Phase 4 storage layer
// (sales_orders + sales_order_lines, ADR-012).
//
// Three shapes:
//   - read: SalesOrder (header) + SalesOrderLine; SalesOrderListItem aggregates
//     line_count + total_qty + jc_qty for the list view.
//   - write: createSalesOrderInputSchema + updateSalesOrderInputSchema accept
//     `{header, lines}` together. Service runs the inserts/updates/deletes in
//     a single transaction. Update uses the legacy merge semantics from
//     `_editFullSO()` line 12576-12612: lines with an `id` matching existing
//     are updated; lines without are created; existing lines absent from input
//     are soft-deleted.
//   - query: list filters (search, status, type, date range, pagination).
//
// Deferred per ADR-012 (forward fields, captured but not modelled here):
//   - milestones[] (#8, no current data)
//   - clientPoFileUrl / clientPoFileName (file upload, Phase 6)
//   - dispatchedQty / SO Total Value (derived; needs dispatch + BOM modules)
//   - bom_master_id / bom_status are kept as nullable text fields (forward FK
//     when BOM module ships).

import { z } from 'zod';
import { SO_STATUSES } from '../enums/so-status';
import { SO_TYPES } from '../enums/so-type';
import { uomSchema } from './item';

export const soTypeSchema = z.enum(SO_TYPES);
export const soStatusSchema = z.enum(SO_STATUSES);

const codeRegex = /^[A-Za-z0-9._/-]+$/; // legacy soNo allows '/' (e.g. SO-436/A)

// ─── Read shapes ───────────────────────────────────────────────────────────

export const salesOrderLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  salesOrderId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  // ISSUE-005 — live item code joined from items.code when itemId is set.
  // Null when itemId is null (the snapshot text in itemCodeText is the
  // only display value). UI renders `itemCode ?? itemCodeText ?? '—'`.
  itemCode: z.string().nullable().default(null),
  partName: z.string(),
  material: z.string().nullable(),
  drawingNo: z.string().nullable(),
  uom: uomSchema,
  orderQty: z.number().int().positive(),
  // Billing status (migration 0050 / ADR-042). dispatchedQty is the cumulative
  // customer-dispatched qty; billedQty is Σ invoice-line qty (populated on the
  // SO detail read, 0 elsewhere). Pending-to-bill = orderQty − billedQty.
  dispatchedQty: z.number().int().nonnegative().default(0),
  billedQty: z.number().int().nonnegative().default(0),
  // Σ job_cards.order_qty whose source_so_line_id = this line (SO detail read,
  // 0 elsewhere). Drives the JC-Qty / Balance columns on the SO Master expand.
  jcQty: z.number().int().nonnegative().default(0),
  rate: z.string(), // numeric stored as string
  dueDate: z.string().nullable(), // ISO date
  clientPoLineNo: z.string().nullable(),
  status: soStatusSchema,
  sourceBomMasterId: z.string().uuid().nullable().default(null),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type SalesOrderLine = z.infer<typeof salesOrderLineSchema>;

/** SO delivery-schedule milestone (ISSUE-015). One delivery lot planned for the
 *  SO (legacy `_soMilestones` row). SO-level, not per-line. */
export const soMilestoneSchema = z.object({
  id: z.string().uuid(),
  salesOrderId: z.string().uuid(),
  lotNo: z.number().int(),
  qty: z.number().int().nonnegative(),
  dueDate: z.string().nullable(), // ISO date
  remarks: z.string().nullable(),
});
export type SoMilestone = z.infer<typeof soMilestoneSchema>;

export const salesOrderSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  soDate: z.string(), // ISO date
  clientId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  type: soTypeSchema,
  status: soStatusSchema,
  gstPercent: z.string(), // numeric stored as string
  bomMasterId: z.string().nullable(),
  bomStatus: z.string().nullable(),
  costCenter: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type SalesOrder = z.infer<typeof salesOrderSchema>;

/** Detail response: header + ordered lines (open lines first, then by lineNo)
 *  + delivery-schedule milestones (ordered by lotNo). */
export const salesOrderDetailSchema = salesOrderSchema.extend({
  lines: z.array(salesOrderLineSchema),
  milestones: z.array(soMilestoneSchema).default([]),
  // Storage path of the latest active client-PO file in file_registry (ISSUE-013),
  // null when none uploaded. UI renders a 📎 view link + an upload control.
  clientPoFilePath: z.string().nullable().default(null),
});
export type SalesOrderDetail = z.infer<typeof salesOrderDetailSchema>;

/** List row: header + aggregates from sales_order_lines + linked job_cards.
 *  Mirrors legacy renderSOmaster columns line 11971 (Lines, Total Qty, JC Qty,
 *  Due Date). earliestDueDate = MIN(line.due_date) across non-deleted lines. */
export const salesOrderListItemSchema = salesOrderSchema.extend({
  lineCount: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  jcQty: z.number().int().nonnegative(),
  earliestDueDate: z.string().nullable(),
  // 📎 client-PO file link (ISSUE-013): latest active file_registry row with
  // category 'client_po' for this SO; null when none. Mirrors legacy
  // renderSOmaster clientPoFileUrl paperclip (L11866).
  clientPoFilePath: z.string().nullable().default(null),
});
export type SalesOrderListItem = z.infer<typeof salesOrderListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

/** Per-line input. itemId is preferred; itemCodeText is a fallback for legacy
 *  / unresolved codes (ADR-012 #10). At least one of (itemId, itemCodeText)
 *  must be present. lineNo is optional on input — service auto-assigns the
 *  next free integer if blank. `id` is set when updating an existing line. */
export const salesOrderLineInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    lineNo: z.number().int().positive().optional(),
    itemId: z.string().uuid().optional(),
    itemCodeText: z.string().min(1).max(64).optional(),
    partName: z.string().min(1).max(255),
    material: z.string().max(255).optional(),
    drawingNo: z.string().max(64).optional(),
    uom: uomSchema.default('NOS'),
    orderQty: z.number().int().positive(), // CHECK > 0 enforced in DB too
    rate: z.coerce.number().nonnegative().default(0),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
      .optional(),
    clientPoLineNo: z.string().max(64).optional(),
    status: soStatusSchema.optional(),
    // BOM-8 cascade: when set, line creation spawns child JCs / PRs from
    // the BOM's lines (per bom_type). Fires once per line creation;
    // re-saves with same BOM are idempotent (checked by source_so_line_id
    // already-existing children). See modules/bom-master/cascade.ts.
    sourceBomMasterId: z.string().uuid().optional(),
  })
  .refine((l) => Boolean(l.itemId) || Boolean(l.itemCodeText?.trim()), {
    message: 'itemId or itemCodeText is required (per ADR-012 #10)',
  });
export type SalesOrderLineInput = z.infer<typeof salesOrderLineInputSchema>;

/** Per-milestone input (ISSUE-015). `id` set when updating an existing lot;
 *  rows absent from an update payload are soft-deleted (line-merge semantics). */
export const salesOrderMilestoneInputSchema = z.object({
  id: z.string().uuid().optional(),
  lotNo: z.number().int().positive(),
  qty: z.coerce.number().int().nonnegative().default(0),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
    .optional(),
  remarks: z.string().max(500).optional(),
});
export type SalesOrderMilestoneInput = z.infer<typeof salesOrderMilestoneInputSchema>;

const _soHeaderInputBase = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen'),
  soDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'soDate must be YYYY-MM-DD'),
  clientId: z.string().uuid().optional(),
  customerName: z.string().max(255).optional(),
  clientPoNo: z.string().max(64).optional(),
  type: soTypeSchema.default('component_manufacturing'),
  status: soStatusSchema.default('open'),
  gstPercent: z.coerce.number().nonnegative().max(99.99).default(18),
  bomMasterId: z.string().max(64).optional(),
  bomStatus: z.string().max(32).optional(),
  costCenter: z.string().max(64).optional(),
  remarks: z.string().max(2000).optional(),
});

/** CREATE — `{header, lines}`. Header + at least one line; service runs both
 *  inserts in a single transaction. Equipment SOs may legally have an empty
 *  lines array (the equipment itself was modelled as a single line in legacy
 *  but Phase 4 keeps both shapes uniform for now — Equipment with zero lines
 *  is allowed; non-Equipment requires ≥ 1 line). */
export const createSalesOrderInputSchema = z
  .object({
    // Client master link is mandatory (supersedes ADR-012 #9 for SO): an SO
    // must reference a real client; the free-text customerName fallback is
    // removed. The server snapshots customerName from the client master.
    header: _soHeaderInputBase.refine((h) => Boolean(h.clientId), {
      message: 'A client (from the client master) is required for a Sales Order.',
    }),
    lines: z.array(salesOrderLineInputSchema).default([]),
    milestones: z.array(salesOrderMilestoneInputSchema).optional(),
  })
  .refine((i) => i.header.type === 'equipment' || i.lines.length > 0, {
    message: 'At least one line is required for non-Equipment SOs (legacy line 12442)',
  });
export type CreateSalesOrderInput = z.infer<typeof createSalesOrderInputSchema>;

/** UPDATE — same shape as create. `code` is omitted from header (immutable
 *  business key, matches the items / clients update pattern). Lines use the
 *  legacy `_editFullSO` merge semantics: id-matched lines are updated, new
 *  lines are inserted, existing lines absent from input are soft-deleted. */
export const updateSalesOrderInputSchema = z.object({
  header: _soHeaderInputBase
    .partial()
    .omit({ code: true })
    .refine(
      // If both fields are explicitly set to undefined that's fine — keep
      // existing values. Only block the case where the caller actively sets
      // both to empty/null in one shot.
      (h) =>
        h.clientId !== '' &&
        (h.customerName === undefined ||
          h.customerName.trim().length > 0 ||
          h.clientId !== undefined),
      { message: 'clientId or customerName must remain populated' },
    ),
  lines: z.array(salesOrderLineInputSchema).optional(),
  milestones: z.array(salesOrderMilestoneInputSchema).optional(),
});
export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listSalesOrdersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches code / customer / clientPoNo
  status: soStatusSchema.optional(),
  type: soTypeSchema.optional(),
  clientId: z.string().uuid().optional(),
  /** Inclusive lower bound on so_date (YYYY-MM-DD). */
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Inclusive upper bound on so_date (YYYY-MM-DD). */
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListSalesOrdersQuery = z.infer<typeof listSalesOrdersQuerySchema>;

export interface ListSalesOrdersResponse {
  items: SalesOrderListItem[];
  total: number;
  limit: number;
  offset: number;
}
