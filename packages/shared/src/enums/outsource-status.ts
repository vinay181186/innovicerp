export const OUTSOURCE_STATUSES = [
  'pending',
  'pr_raised',
  'po_created',
  'sent',
  'received',
] as const;

export type OutsourceStatus = (typeof OUTSOURCE_STATUSES)[number];
