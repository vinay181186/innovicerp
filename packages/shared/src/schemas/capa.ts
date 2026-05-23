// CAPA (Corrective & Preventive Action) schemas (QC Wave 3).
//
// Mirrors legacy renderCAPA (HTML L22779) + _capaNew / _capaEdit (5-step
// process). Backed by capa_records (migration 0034).

import { z } from 'zod';

export const CAPA_TYPES = ['Corrective', 'Preventive'] as const;
export const CAPA_STATUSES = ['Open', 'In Progress', 'Verified', 'Closed'] as const;
export const CAPA_RC_METHODS = ['5-Why', 'Fishbone', 'Other'] as const;
export const CAPA_EFFECTIVENESS = ['', 'Effective', 'Not Effective'] as const;

export const capaTypeSchema = z.enum(CAPA_TYPES);
export const capaStatusSchema = z.enum(CAPA_STATUSES);

// ─── Read shape (full record — list rows double as edit-modal source) ───────
export const capaRecordSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  type: capaTypeSchema,
  capaDate: z.string(),
  ncRefs: z.array(z.string()),
  jcNo: z.string().nullable(),
  soNo: z.string().nullable(),
  itemCode: z.string().nullable(),
  operation: z.string().nullable(),
  problem: z.string(),
  rootCauseMethod: z.string().nullable(),
  rootCause: z.string().nullable(),
  correctiveAction: z.string().nullable(),
  responsible: z.string().nullable(),
  targetDate: z.string().nullable(),
  verification: z.string().nullable(),
  verifiedBy: z.string().nullable(),
  verifiedDate: z.string().nullable(),
  preventiveAction: z.string().nullable(),
  effectiveness: z.string().nullable(),
  reviewDate: z.string().nullable(),
  status: capaStatusSchema,
  department: z.string().nullable(),
  overdue: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CapaRecord = z.infer<typeof capaRecordSchema>;

export const capaCountersSchema = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  effectivenessPct: z.number().int().nonnegative(),
});
export type CapaCounters = z.infer<typeof capaCountersSchema>;

export interface ListCapaResponse {
  items: CapaRecord[];
  counters: CapaCounters;
}

// ─── Create (legacy _capaNew) ───────────────────────────────────────────────
export const createCapaInputSchema = z.object({
  type: capaTypeSchema.default('Corrective'),
  capaDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ncRefs: z.array(z.string().min(1)).default([]),
  jcNo: z.string().max(64).optional(),
  soNo: z.string().max(64).optional(),
  itemCode: z.string().max(64).optional(),
  operation: z.string().max(200).optional(),
  problem: z.string().min(1, 'Problem description is required'),
  department: z.string().max(64).optional(),
});
export type CreateCapaInput = z.infer<typeof createCapaInputSchema>;

// ─── Update (legacy _capaEdit 5-step) ───────────────────────────────────────
export const updateCapaInputSchema = z.object({
  problem: z.string().min(1).optional(),
  rootCauseMethod: z.enum(CAPA_RC_METHODS).optional(),
  rootCause: z.string().optional(),
  correctiveAction: z.string().optional(),
  responsible: z.string().max(120).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('')),
  verification: z.string().optional(),
  verifiedBy: z.string().max(120).optional(),
  verifiedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('')),
  preventiveAction: z.string().optional(),
  effectiveness: z.enum(CAPA_EFFECTIVENESS).optional(),
  reviewDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('')),
  status: capaStatusSchema.optional(),
});
export type UpdateCapaInput = z.infer<typeof updateCapaInputSchema>;
