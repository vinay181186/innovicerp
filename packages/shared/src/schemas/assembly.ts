// Assembly Tracker wire shapes (PL-5). Per ADR-030.
//
// Drives the per-Equipment-SO tracker page that mirrors legacy
// renderAssemblyTracker (HTML L28738). Multi-level BOM readiness rollup +
// per-unit assembly tracking + dispatch flags.

import { z } from 'zod';
import { SO_STATUSES } from '../enums/so-status';

export const assemblyComponentStatusEnum = z.enum([
  'ready',
  'enough_for_some',
  'shortage',
]);
export type AssemblyComponentStatus = z.infer<typeof assemblyComponentStatusEnum>;

export const assemblyComponentRowSchema = z.object({
  childItemId: z.string().uuid().nullable(),
  childItemCode: z.string(),
  childItemName: z.string().nullable(),
  bomType: z.enum(['manufacture', 'purchase', 'outsource']),
  qtyPerSet: z.number(),
  totalNeed: z.number().int().nonnegative(),
  stockQty: z.number().int().nonnegative(),
  autoReadyQty: z.number().int().nonnegative(),
  overrideQty: z.number().int().nonnegative(),
  finalReadyQty: z.number().int().nonnegative(),
  shortfall: z.number().int().nonnegative(),
  enoughForUnits: z.number().int().nonnegative(),
  status: assemblyComponentStatusEnum,
});
export type AssemblyComponentRow = z.infer<typeof assemblyComponentRowSchema>;

export const assemblyUnitRowSchema = z.object({
  id: z.string().uuid(),
  unitNo: z.number().int().positive(),
  serialNo: z.string().nullable(),
  assemblyDate: z.string(),
  assembledBy: z.string().nullable(),
  remarks: z.string().nullable(),
  dispatched: z.boolean(),
  dispatchDate: z.string().nullable(),
  dispatchedBy: z.string().nullable(),
  dispatchRemarks: z.string().nullable(),
});
export type AssemblyUnitRow = z.infer<typeof assemblyUnitRowSchema>;

export const assemblyRollupSchema = z.object({
  /** Equipment SO order qty (units required). */
  orderQty: z.number().int().nonnegative(),
  /** Number of units assembled (rows in assembly_units, not deleted). */
  assembledQty: z.number().int().nonnegative(),
  /** Number of assembled units flipped to dispatched=true. */
  dispatchedQty: z.number().int().nonnegative(),
  /** orderQty - assembledQty (clamped at 0). */
  balanceQty: z.number().int().nonnegative(),
  /** min(component.enoughForUnits) across all components. */
  canAssembleAdditional: z.number().int().nonnegative(),
  /** Component with the lowest enoughForUnits (the bottleneck). null when no components. */
  bottleneck: z
    .object({
      childItemCode: z.string(),
      enoughForUnits: z.number().int().nonnegative(),
    })
    .nullable(),
  /** waiting | ready | assembling | done. */
  status: z.enum(['waiting', 'ready', 'assembling', 'done']),
});
export type AssemblyRollup = z.infer<typeof assemblyRollupSchema>;

export const assemblyHeaderSchema = z.object({
  soId: z.string().uuid(),
  soCode: z.string(),
  customerName: z.string().nullable(),
  type: z.enum(['component_manufacturing', 'equipment', 'with_material']),
  status: z.enum(SO_STATUSES),
  bomMasterId: z.string().uuid().nullable(),
  bomCode: z.string().nullable(),
  bomName: z.string().nullable(),
  partNoText: z.string().nullable(),
  partName: z.string().nullable(),
  orderQty: z.number().int().nonnegative(),
});
export type AssemblyHeader = z.infer<typeof assemblyHeaderSchema>;

export const assemblyTrackerResponseSchema = z.object({
  generatedAt: z.string(),
  header: assemblyHeaderSchema,
  components: z.array(assemblyComponentRowSchema),
  rollup: assemblyRollupSchema,
  units: z.array(assemblyUnitRowSchema),
});
export type AssemblyTrackerResponse = z.infer<typeof assemblyTrackerResponseSchema>;

export const assemblyListItemSchema = z.object({
  soId: z.string().uuid(),
  soCode: z.string(),
  customerName: z.string().nullable(),
  bomCode: z.string().nullable(),
  partNoText: z.string().nullable(),
  partName: z.string().nullable(),
  orderQty: z.number().int().nonnegative(),
  assembledQty: z.number().int().nonnegative(),
  dispatchedQty: z.number().int().nonnegative(),
  dueDate: z.string().nullable(),
  status: z.enum(['waiting', 'ready', 'assembling', 'done']),
});
export type AssemblyListItem = z.infer<typeof assemblyListItemSchema>;

export const assemblyListResponseSchema = z.object({
  generatedAt: z.string(),
  items: z.array(assemblyListItemSchema),
});
export type AssemblyListResponse = z.infer<typeof assemblyListResponseSchema>;

// ─── Write inputs ────────────────────────────────────────────────────────

export const markUnitAssembledInputSchema = z.object({
  serialNo: z.string().trim().max(80).optional(),
  assemblyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assembledBy: z.string().trim().max(80).optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type MarkUnitAssembledInput = z.infer<typeof markUnitAssembledInputSchema>;

export const markUnitDispatchedInputSchema = z.object({
  dispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dispatchedBy: z.string().trim().max(80).optional(),
  dispatchRemarks: z.string().trim().max(500).optional(),
});
export type MarkUnitDispatchedInput = z.infer<typeof markUnitDispatchedInputSchema>;

export const setReadinessOverrideInputSchema = z.object({
  readyQtyOverride: z.number().int().nonnegative(),
  remarks: z.string().trim().max(500).optional(),
});
export type SetReadinessOverrideInput = z.infer<typeof setReadinessOverrideInputSchema>;
