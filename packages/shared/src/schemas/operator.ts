import { z } from 'zod';

const codeRegex = /^[A-Za-z0-9._-]+$/;

export const operatorSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  department: z.string().max(100).nullable(),
  skills: z.string().max(1000).nullable(),
  isActive: z.boolean(),
  userId: z.string().uuid().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Operator = z.infer<typeof operatorSchema>;

export const createOperatorInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, underscore, hyphen'),
  name: z.string().min(1).max(255),
  department: z.string().max(100).optional(),
  skills: z.string().max(1000).optional(),
  isActive: z.boolean().default(true),
  userId: z.string().uuid().optional().or(z.literal('')),
});
export type CreateOperatorInput = z.infer<typeof createOperatorInputSchema>;

export const updateOperatorInputSchema = createOperatorInputSchema.partial().omit({ code: true });
export type UpdateOperatorInput = z.infer<typeof updateOperatorInputSchema>;

export const listOperatorsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListOperatorsQuery = z.infer<typeof listOperatorsQuerySchema>;

export interface ListOperatorsResponse {
  operators: Operator[];
  total: number;
  limit: number;
  offset: number;
}
