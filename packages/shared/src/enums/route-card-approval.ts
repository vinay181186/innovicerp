// ADR-253 — a Route Card's approval state (route_cards.approval_status).
//
//   pending  — "Pending Approval": a NEW card (RC screen, or one a Job Card /
//              Plan Execute created for an item with no card). Not usable:
//              no Production Order / ML-plan order may be raised on it.
//   approved — usable. Edits to an approved card follow the company
//              Document Edit Approval switch (ADR-249 engine).
//   rejected — "Returned to Creator" (owner 2026-11-05): sent back with a
//              comment; still not usable. The creator gets a task; saving the
//              card again sends it back to `pending` and closes that task.
//              The DB value stays `rejected` — only the words changed.
//
// Always on — there is no switch for new-card approval (owner, 2026-10-24).
export const ROUTE_CARD_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RouteCardApprovalStatus = (typeof ROUTE_CARD_APPROVAL_STATUSES)[number];

export const ROUTE_CARD_APPROVAL_LABEL: Record<RouteCardApprovalStatus, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Returned to Creator',
};
