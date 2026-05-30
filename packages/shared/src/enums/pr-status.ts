// Purchase Request status. open → approved → po_created (or cancelled).
export const PR_STATUSES = ['open', 'approved', 'po_created', 'cancelled'] as const;
export type PrStatus = (typeof PR_STATUSES)[number];

// Purchase Request type. Legacy `pr.prType`: 'standard' (regular PR),
// 'jw_osp' (auto-created from an outsource JC op), 'service' (links to
// a Service PO). Outsource Jobs page lists `jw_osp` rows.
export const PR_TYPES = ['standard', 'jw_osp', 'service'] as const;
export type PrType = (typeof PR_TYPES)[number];
