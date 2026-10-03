// 'cancelled' (ADR-202 Phase 3): an invoice is a statutory document — it is never
// edited or renumbered. A correction is a reason-logged cancel (blocked once any
// payment exists) that keeps the INV-#### series intact, mirroring jw_invoices.
export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'cancelled'] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
