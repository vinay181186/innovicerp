// ADR-253 — a Route Card's approval state (route_cards.approval_status).
//
//   pending  — "Pending Approval": a NEW card (RC screen, or one a Job Card /
//              Plan Execute created for an item with no card). Not usable:
//              no Production Order / ML-plan order may be raised on it.
//   approved — usable. Edits to an approved card follow the company
//              Document Edit Approval switch (ADR-249 engine).
//   rejected — refused with a reason; still not usable. Saving the card again
//              sends it back to `pending`.
//
// Always on — there is no switch for new-card approval (owner, 2026-10-24).
export const ROUTE_CARD_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RouteCardApprovalStatus = (typeof ROUTE_CARD_APPROVAL_STATUSES)[number];

export const ROUTE_CARD_APPROVAL_LABEL: Record<RouteCardApprovalStatus, string> = {
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};
