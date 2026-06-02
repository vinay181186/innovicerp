export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid'] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
