import { z } from 'zod';

export const opLogTypeSchema = z.enum(['start', 'complete', 'qc']);
export type OpLogType = z.infer<typeof opLogTypeSchema>;

export const listOpLogQuerySchema = z.object({
  jcNo: z.string().optional(),
  logType: opLogTypeSchema.optional(),
  shift: z.string().optional(),
  operatorId: z.string().uuid().optional(),
  fromDate: z.string().optional(), // YYYY-MM-DD
  toDate: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListOpLogQuery = z.infer<typeof listOpLogQuerySchema>;

export const opLogListItemSchema = z.object({
  id: z.string().uuid(),
  logNo: z.string(),
  logType: opLogTypeSchema,
  logDate: z.string(), // YYYY-MM-DD
  jcNo: z.string(),
  itemCode: z.string().nullable(),
  opSeq: z.number().int(),
  operation: z.string().nullable(),
  machineCode: z.string().nullable(),
  shift: z.string(),
  qty: z.number().int(),
  rejectQty: z.number().int(),
  operatorName: z.string().nullable(),
  remarks: z.string().nullable(),
  isTpi: z.boolean(),
  qcReportPath: z.string().nullable(),
  qcReportName: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
});
export type OpLogListItem = z.infer<typeof opLogListItemSchema>;

export const listOpLogResponseSchema = z.object({
  items: z.array(opLogListItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ListOpLogResponse = z.infer<typeof listOpLogResponseSchema>;
