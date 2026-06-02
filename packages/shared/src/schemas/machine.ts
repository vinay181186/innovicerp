import { z } from 'zod';

const codeRegex = /^[A-Za-z0-9._-]+$/;

export const machineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  machineType: z.string().max(64).nullable(),
  capacityPerShift: z.number().int().nullable(),
  shiftsPerDay: z.number().int().positive(),
  status: z.string().min(1).max(32),
  hourRate: z.number().nonnegative(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Machine = z.infer<typeof machineSchema>;

export const createMachineInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, underscore, hyphen'),
  name: z.string().min(1).max(255),
  machineType: z.string().max(64).optional(),
  capacityPerShift: z.coerce.number().int().nonnegative().optional(),
  shiftsPerDay: z.coerce.number().int().positive().default(1),
  status: z.string().min(1).max(32).default('Idle'),
  hourRate: z.coerce.number().nonnegative().optional(),
});
export type CreateMachineInput = z.infer<typeof createMachineInputSchema>;

export const updateMachineInputSchema = createMachineInputSchema.partial().omit({ code: true });
export type UpdateMachineInput = z.infer<typeof updateMachineInputSchema>;

export const listMachinesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  status: z.string().max(32).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListMachinesQuery = z.infer<typeof listMachinesQuerySchema>;

export interface ListMachinesResponse {
  machines: Machine[];
  total: number;
  limit: number;
  offset: number;
}
