// Service Purchase Orders shared schemas.
//
// Mirror of legacy db.servicePOs (renderServicePO L27504). Non-inventory
// service purchases (labour / maintenance / calibration / consultancy /
// etc.) — separate from regular POs because they have no item link, no
// GRN downstream, and a different approval flow.

import { z } from 'zod';

export const SERVICE_PO_STATUSES = ['draft', 'pending', 'approved', 'completed', 'cancelled'] as const;
export type ServicePoStatus = (typeof SERVICE_PO_STATUSES)[number];
export const servicePoStatusSchema = z.enum(SERVICE_PO_STATUSES);

export const SERVICE_PO_COST_CENTERS = ['so', 'general'] as const;
export type ServicePoCostCenter = (typeof SERVICE_PO_COST_CENTERS)[number];
export const servicePoCostCenterSchema = z.enum(SERVICE_PO_COST_CENTERS);

export const SERVICE_PO_TAX_TYPES = ['sgst_cgst', 'igst'] as const;
export type ServicePoTaxType = (typeof SERVICE_PO_TAX_TYPES)[number];
export const servicePoTaxTypeSchema = z.enum(SERVICE_PO_TAX_TYPES);

// Verbatim from legacy `_spoExpenseHeads` L27502.
export const SERVICE_PO_EXPENSE_HEADS = [
  'Transport',
  'Calibration',
  'Testing',
  'Labour',
  'AMC',
  'Inspection',
  'Machining',
  'Consultancy',
  'Other',
] as const;

const codeRegex = /^[A-Za-z0-9._/-]+$/;

export const servicePoLineSchema = z.object({
  id: z.string().uuid(),
  servicePoId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  description: z.string(),
  qty: z.number().nonnegative(),
  rate: z.number().nonnegative(),
  amount: z.number().nonnegative(),
});
export type ServicePoLine = z.infer<typeof servicePoLineSchema>;

export const servicePoSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  spoNo: z.string(),
  spoDate: z.string(),
  vendorId: z.string().uuid().nullable(),
  vendorCodeText: z.string().nullable(),
  expenseHead: z.string(),
  costCenter: servicePoCostCenterSchema,
  soRefId: z.string().uuid().nullable(),
  soNoText: z.string().nullable(),
  subtotal: z.number().nonnegative(),
  taxType: servicePoTaxTypeSchema,
  gstPct: z.number().nonnegative(),
  taxAmount: z.number().nonnegative(),
  total: z.number().nonnegative(),
  paymentTerms: z.string(),
  remarks: z.string().nullable(),
  status: servicePoStatusSchema,
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ServicePo = z.infer<typeof servicePoSchema>;

export const servicePoDetailSchema = servicePoSchema.extend({
  vendorName: z.string().nullable(),
  lines: z.array(servicePoLineSchema),
});
export type ServicePoDetail = z.infer<typeof servicePoDetailSchema>;

export const servicePoListItemSchema = servicePoSchema.extend({
  vendorName: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
});
export type ServicePoListItem = z.infer<typeof servicePoListItemSchema>;

export const listServicePosQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  status: servicePoStatusSchema.optional(),
  vendorId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListServicePosQuery = z.infer<typeof listServicePosQuerySchema>;

export interface ListServicePosResponse {
  items: ServicePoListItem[];
  total: number;
  limit: number;
  offset: number;
}

export const servicePoLineInputSchema = z.object({
  description: z.string().min(1).max(500),
  qty: z.coerce.number().nonnegative().default(1),
  rate: z.coerce.number().nonnegative().default(0),
});
export type ServicePoLineInput = z.infer<typeof servicePoLineInputSchema>;

export const createServicePoInputSchema = z.object({
  spoNo: z.string().min(1).max(64).regex(codeRegex),
  spoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendorId: z.string().uuid(),
  expenseHead: z.string().max(64).default('Other'),
  costCenter: servicePoCostCenterSchema.default('so'),
  soRefId: z.string().uuid().optional(),
  soNoText: z.string().max(64).optional(),
  taxType: servicePoTaxTypeSchema.default('sgst_cgst'),
  gstPct: z.coerce.number().nonnegative().max(99.99).default(18),
  paymentTerms: z.string().max(64).default('Immediate'),
  remarks: z.string().max(2000).optional(),
  status: servicePoStatusSchema.default('pending'),
  lines: z.array(servicePoLineInputSchema).min(1),
});
export type CreateServicePoInput = z.infer<typeof createServicePoInputSchema>;

export const updateServicePoInputSchema = createServicePoInputSchema.partial().omit({ spoNo: true });
export type UpdateServicePoInput = z.infer<typeof updateServicePoInputSchema>;
