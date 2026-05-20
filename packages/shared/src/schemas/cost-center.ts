// Cost Center Master shared schemas (Phase A item 4 — Legacy parity build).
//
// Backed by the `cost_centers` table from migration 0023. Mirror of legacy
// renderCostCenters L17165 — 6 business fields plus the standard audit /
// soft-delete envelope. Department + type are stored as text (not enums)
// so adding a department doesn't need a migration.

import { z } from 'zod';

const codeRegex = /^[A-Za-z0-9._-]+$/;

export const COST_CENTER_DEPARTMENTS = [
  'Production',
  'QC',
  'Maintenance',
  'Store',
  'Admin',
  'Design',
  'Purchase',
  'Sales',
  'Other',
] as const;
export type CostCenterDepartment = (typeof COST_CENTER_DEPARTMENTS)[number];

export const COST_CENTER_TYPES = ['Manufacturing', 'Overhead', 'Service'] as const;
export type CostCenterType = (typeof COST_CENTER_TYPES)[number];

export const costCenterSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  department: z.string().nullable(),
  type: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type CostCenter = z.infer<typeof costCenterSchema>;

export const createCostCenterInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, underscore, hyphen'),
  name: z.string().min(1).max(255),
  department: z.string().max(64).optional(),
  type: z.string().max(64).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().default(true),
});
export type CreateCostCenterInput = z.infer<typeof createCostCenterInputSchema>;

export const updateCostCenterInputSchema = createCostCenterInputSchema
  .partial()
  .omit({ code: true });
export type UpdateCostCenterInput = z.infer<typeof updateCostCenterInputSchema>;

export const listCostCentersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  department: z.string().max(64).optional(),
  type: z.string().max(64).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListCostCentersQuery = z.infer<typeof listCostCentersQuerySchema>;

export interface ListCostCentersResponse {
  items: CostCenter[];
  total: number;
  limit: number;
  offset: number;
}
