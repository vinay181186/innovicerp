import { z } from 'zod';

// Machine GROUP master (e.g. VMC, CNC, Lathe, Grinding) — migration 0116.
//
// The second tab of the Machine Master screen. Replaces the free-text
// `machineType` field on the machine form, which let the same group arrive as
// "VMC", "vmc" and "V.M.C" so no screen could group machines reliably.
//
// Shaped as a deliberate sibling of ./material-grade and the TPI master: the
// single `code` IS the name the user types and reads — 'VMC' — unique per
// company and permanent once created, because machines and the screens that
// read them snapshot it. Retire a group with isActive rather than renaming it.
// No separate `name`, for the same reason tpi_masters has none: one value, one
// field, nothing to keep in sync.

const codeRegex = /^[A-Za-z0-9._\- ]+$/;

export const machineGroupSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  /** The group as written on the shop floor — 'VMC', 'CNC', 'Lathe'. */
  code: z.string().min(1).max(64),
  /** Free note — what the group covers, which shop it lives in. */
  description: z.string().max(500).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type MachineGroup = z.infer<typeof machineGroupSchema>;

export const createMachineGroupInputSchema = z.object({
  // Required, unlike the material masters: there is no sensible auto series for
  // a group whose whole purpose is to be the word the shop floor already uses.
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'group may contain only letters, digits, spaces, dot, underscore, hyphen'),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});
export type CreateMachineGroupInput = z.infer<typeof createMachineGroupInputSchema>;

// `code` is omitted for the same reason as every other master here: machines
// and the screens that read them snapshot the group text, so renaming it would
// make the master disagree with records already written. Retire with isActive.
export const updateMachineGroupInputSchema = createMachineGroupInputSchema
  .partial()
  .omit({ code: true });
export type UpdateMachineGroupInput = z.infer<typeof updateMachineGroupInputSchema>;

export const listMachineGroupsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  // 1000 so the master loads in one scrolling fetch (no Prev/Next), matching
  // the Raw Material masters.
  limit: z.coerce.number().int().positive().max(1000).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListMachineGroupsQuery = z.infer<typeof listMachineGroupsQuerySchema>;

export interface ListMachineGroupsResponse {
  groups: MachineGroup[];
  total: number;
  limit: number;
  offset: number;
}
