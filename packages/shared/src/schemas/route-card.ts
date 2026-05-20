// Route Card shared schemas (RC-2). Ports the structure of the legacy
// renderRouteCards (legacy/InnovicERP_v82_12_3.html L10078) +
// saveRouteCardForItem (L6918) to typed Zod.
//
// Header + ops + revision triple. Each revision archives the previous
// ops as JSON so the diff history survives even after the line rows
// are replaced on update.
//
// Op types:
//   process   — machine step (legacy: machineId set, no opType)
//   qc        — inspection step (legacy: opType='QC', machineId='QC')
//   outsource — OSP step (legacy: opType='OSP', isOSP=true, plus
//               ospVendorCode / ospVendor / ospLeadDays)
//
// Cycle time is stored in HOURS in cycle_time_min — column name is a
// legacy carry-over (see ISSUE-NN); UI labels read "Cycle (hrs)" so
// the user-facing semantics stay aligned with legacy.

import { z } from 'zod';
import { OP_TYPES } from '../enums/op-type';

// Note: opTypeSchema is exported from op-entry.ts; we use a local
// alias to avoid the duplicate-export collision when both files are
// re-exported from the shared package barrel.
const rcOpTypeSchema = z.enum(OP_TYPES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const routeCardSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  itemId: z.string().uuid(),
  currentRevision: z.number().int().positive(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type RouteCard = z.infer<typeof routeCardSchema>;

export const routeCardOpSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  routeCardId: z.string().uuid(),
  opSeq: z.number().int().positive(),
  machineId: z.string().uuid().nullable(),
  machineCodeText: z.string().nullable(),
  operation: z.string(),
  opType: rcOpTypeSchema,
  cycleTimeMin: z.string(), // numeric stored as string; legacy stores HOURS here
  program: z.string().nullable(),
  toolNo: z.string().nullable(),
  toolDetails: z.string().nullable(),
  qcRequired: z.boolean(),
  ospVendorId: z.string().uuid().nullable(),
  ospVendorCodeText: z.string().nullable(),
  ospLeadDays: z.number().int().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  // Joined display values (populated by service via machines + vendors).
  machineCode: z.string().nullable().default(null),
  machineName: z.string().nullable().default(null),
  ospVendorCode: z.string().nullable().default(null),
  ospVendorName: z.string().nullable().default(null),
});
export type RouteCardOp = z.infer<typeof routeCardOpSchema>;

export const routeCardRevisionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  routeCardId: z.string().uuid(),
  revisionNo: z.number().int().positive(),
  notes: z.string().nullable(),
  // Snapshot of ops AS THEY WERE at this revision. Stored as jsonb
  // so the diff trail survives even after op rows are replaced.
  // Structurally equivalent to RouteCardOpSnapshot[] (subset of
  // fields the diff needs).
  opsSnapshot: z.array(
    z.object({
      opSeq: z.number().int().positive(),
      machineId: z.string().uuid().nullable().optional(),
      machineCode: z.string().nullable().optional(),
      operation: z.string(),
      opType: rcOpTypeSchema,
      cycleTimeMin: z.string(),
      program: z.string().nullable().optional(),
      toolNo: z.string().nullable().optional(),
      toolDetails: z.string().nullable().optional(),
      ospVendorCode: z.string().nullable().optional(),
      ospLeadDays: z.number().int().nullable().optional(),
    }),
  ),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});
export type RouteCardRevision = z.infer<typeof routeCardRevisionSchema>;

export const routeCardDetailSchema = routeCardSchema.extend({
  ops: z.array(routeCardOpSchema),
  revisions: z.array(routeCardRevisionSchema).default([]),
  itemCode: z.string().nullable().default(null),
  itemName: z.string().nullable().default(null),
});
export type RouteCardDetail = z.infer<typeof routeCardDetailSchema>;

export const routeCardListItemSchema = routeCardSchema.extend({
  opCount: z.number().int().nonnegative(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
});
export type RouteCardListItem = z.infer<typeof routeCardListItemSchema>;

// ─── List query ────────────────────────────────────────────────────────────

export const listRouteCardsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  itemId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListRouteCardsQuery = z.infer<typeof listRouteCardsQuerySchema>;

export interface ListRouteCardsResponse {
  items: RouteCardListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Write inputs ──────────────────────────────────────────────────────────

// Per-op input. machineId+operation required; opType drives the rest:
//   process  — machineId required, vendor fields ignored
//   qc       — machineId nullable (legacy stores 'QC' sentinel; we
//              accept null + the UI sets machineCodeText='QC'), but
//              service-layer keeps that as a display nicety
//   outsource — operation required + at least one of
//              (ospVendorId, ospVendorCodeText) must be present
//
// cycleTimeMin is the legacy "cycleTime" value (hours) parsed to a
// non-negative float. opSeq is implicit (index + 1 at insert time)
// so the form doesn't have to track it.
export const createRouteCardOpInputSchema = z
  .object({
    machineId: z.string().uuid().nullable().optional(),
    machineCodeText: z.string().max(64).nullable().optional(),
    operation: z.string().min(1, 'Operation name required').max(255),
    opType: rcOpTypeSchema.default('process'),
    cycleTimeMin: z.number().nonnegative().default(0),
    program: z.string().max(255).nullable().optional(),
    toolNo: z.string().max(64).nullable().optional(),
    toolDetails: z.string().max(1000).nullable().optional(),
    qcRequired: z.boolean().default(false),
    ospVendorId: z.string().uuid().nullable().optional(),
    ospVendorCodeText: z.string().max(64).nullable().optional(),
    ospLeadDays: z.number().int().nonnegative().nullable().optional(),
  })
  .refine(
    (v) => {
      if (v.opType !== 'process') return true;
      return Boolean(v.machineId) || Boolean(v.machineCodeText && v.machineCodeText.trim());
    },
    { message: 'Process steps require a machine', path: ['machineId'] },
  )
  .refine(
    (v) => {
      if (v.opType !== 'outsource') return true;
      return Boolean(v.ospVendorId) || Boolean(v.ospVendorCodeText && v.ospVendorCodeText.trim());
    },
    { message: 'Outsource steps require a vendor', path: ['ospVendorId'] },
  );
export type CreateRouteCardOpInput = z.infer<typeof createRouteCardOpInputSchema>;

export const createRouteCardInputSchema = z.object({
  // code is optional on create — server auto-generates IN-RC-NNNNN
  // if omitted (matches legacy _nextRcNo behaviour, L6933).
  code: z.string().min(1).max(64).optional(),
  itemId: z.string().uuid(),
  notes: z.string().max(2000).nullable().optional(),
  ops: z.array(createRouteCardOpInputSchema).min(1, 'Add at least one operation'),
});
export type CreateRouteCardInput = z.infer<typeof createRouteCardInputSchema>;

// Update: same shape as create but code is REQUIRED + revisionNote is
// optional (server auto-generates a diff note if blank). Service
// bumps current_revision + writes the pre-update ops snapshot to
// route_card_revisions.
export const updateRouteCardInputSchema = z.object({
  code: z.string().min(1).max(64),
  itemId: z.string().uuid(),
  notes: z.string().max(2000).nullable().optional(),
  ops: z.array(createRouteCardOpInputSchema).min(1, 'Add at least one operation'),
  revisionNote: z.string().max(2000).nullable().optional(),
});
export type UpdateRouteCardInput = z.infer<typeof updateRouteCardInputSchema>;
