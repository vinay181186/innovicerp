// Shared between SO and JW per ADR-012 #5 — semantics are identical.
export const SO_STATUSES = ['open', 'closed', 'dispatched', 'cancelled'] as const;

export type SoStatus = (typeof SO_STATUSES)[number];
