// QC Process Master shared schemas (Phase A item 3 — Legacy parity build).
//
// Backed by the `qc_processes` table from T-040c (per ADR-016, schema.ts
// L416-L462). Legacy is a 4-field master (name / description / cycle time /
// status) — renderQCProcessMaster L23440. The Drizzle table uses `code` for
// the name column and stores cycle time in minutes; we expose both
// faithfully to the API but the UI labels `code` as "QC Process Name" to
// match legacy.
//
// Used by Route Cards + Job Cards to populate the QC op dropdowns (legacy
// `_selQCProcesses` L23516).

import { z } from 'zod';

const codeRegex = /^[A-Za-z0-9._ -]+$/;

export const qcProcessSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1).max(64),
  description: z.string().nullable(),
  defaultCycleTimeMin: z.string(), // numeric(8,2) as string from Drizzle
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type QcProcess = z.infer<typeof qcProcessSchema>;

export const createQcProcessInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(
      codeRegex,
      'QC process name may contain only letters, digits, spaces, dot, underscore, hyphen',
    ),
  description: z.string().max(1000).optional(),
  defaultCycleTimeMin: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
});
export type CreateQcProcessInput = z.infer<typeof createQcProcessInputSchema>;

export const updateQcProcessInputSchema = createQcProcessInputSchema.partial().omit({ code: true });
export type UpdateQcProcessInput = z.infer<typeof updateQcProcessInputSchema>;

export const listQcProcessesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListQcProcessesQuery = z.infer<typeof listQcProcessesQuerySchema>;

export interface ListQcProcessesResponse {
  items: QcProcess[];
  total: number;
  limit: number;
  offset: number;
}
