// OSP Process Configuration zod schemas + types.
//
// Mirror of legacy db.ospProcessConfig (Settings page L13231–13298).

import { z } from 'zod';

export const ospProcessSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  processName: z.string(),
  vendorId: z.string().uuid().nullable(),
  vendorCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  autoPo: z.boolean(),
  leadDays: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OspProcess = z.infer<typeof ospProcessSchema>;

export const listOspProcessesResponseSchema = z.object({
  items: z.array(ospProcessSchema),
});
export type ListOspProcessesResponse = z.infer<typeof listOspProcessesResponseSchema>;

export const ospProcessInputSchema = z.object({
  processName: z.string().min(1).max(120),
  vendorId: z.string().uuid().nullable().optional(),
  autoPo: z.boolean().default(false),
  leadDays: z.number().int().nonnegative().max(365).default(5),
});
export type OspProcessInput = z.infer<typeof ospProcessInputSchema>;
