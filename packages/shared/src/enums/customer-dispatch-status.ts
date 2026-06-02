export const CUSTOMER_DISPATCH_STATUSES = ['dispatched', 'cancelled'] as const;

export type CustomerDispatchStatus = (typeof CUSTOMER_DISPATCH_STATUSES)[number];
