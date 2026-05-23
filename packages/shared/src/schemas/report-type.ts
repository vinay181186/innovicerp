// Report / Document Master schemas (QC Wave 5). Mirrors legacy
// renderReportMaster (HTML L23677). Backed by report_types (migration 0038).

import { z } from 'zod';

export const REPORT_TYPE_STATUSES = ['Active', 'Inactive'] as const;
export const reportTypeStatusSchema = z.enum(REPORT_TYPE_STATUSES);

export const reportTypeSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  defaultMandatory: z.boolean(),
  status: reportTypeStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReportType = z.infer<typeof reportTypeSchema>;

export interface ListReportTypesResponse {
  items: ReportType[];
}

export const createReportTypeInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().max(500).optional(),
  defaultMandatory: z.boolean().default(false),
  status: reportTypeStatusSchema.default('Active'),
});
export type CreateReportTypeInput = z.infer<typeof createReportTypeInputSchema>;

export const updateReportTypeInputSchema = createReportTypeInputSchema.partial();
export type UpdateReportTypeInput = z.infer<typeof updateReportTypeInputSchema>;
