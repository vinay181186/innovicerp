// Shared between SO and JW per ADR-012 #5 — semantics are identical.
// `draft` (#3/#4): an SO saved but not yet committed to production; shown in the
// SO list status column. Added to the so_status pgEnum via migration 0059.
export const SO_STATUSES = ['draft', 'open', 'closed', 'dispatched', 'cancelled'] as const;

export type SoStatus = (typeof SO_STATUSES)[number];
