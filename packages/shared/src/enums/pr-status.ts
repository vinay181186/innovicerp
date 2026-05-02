// Purchase Request status. open → approved → po_created (or cancelled).
export const PR_STATUSES = ['open', 'approved', 'po_created', 'cancelled'] as const;
export type PrStatus = (typeof PR_STATUSES)[number];
