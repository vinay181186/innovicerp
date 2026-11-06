// ADR-253 / ADR-277 — a Route Card's approval state (route_cards.approval_status).
//
//   draft    — "Draft": saved by its creator and not sent. Not on any approver's
//              list, not usable. Stays Route Card Rev 0 until first submitted.
//   pending  — "Pending Approval": sent for approval (Save & Submit, Submit for
//              Approval), or a card a Job Card / Plan Execute / Trash Restore
//              brought in. LOCKED: no edit and no delete until the approver
//              decides. Not usable.
//   approved — usable. Edits to an approved card follow the company
//              Document Edit Approval switch (ADR-249 engine).
//   rejected — refused with a reason; still not usable. Editable again; goes
//              back to `pending` only when the creator submits it.
//
// Always on — there is no switch for new-card approval (owner, 2026-10-24).
export const ROUTE_CARD_APPROVAL_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;
export type RouteCardApprovalStatus = (typeof ROUTE_CARD_APPROVAL_STATUSES)[number];

export const ROUTE_CARD_APPROVAL_LABEL: Record<RouteCardApprovalStatus, string> = {
  draft: 'Draft',
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** ADR-277 — the one refusal for an edit or delete of a card with the approver. */
export const ROUTE_CARD_LOCKED_MESSAGE =
  'This Route Card is waiting for approval and cannot be changed until the approver decides.';

/** ADR-277 — sent for approval: nobody may edit or delete it until decided. */
export function isRouteCardLocked(status: RouteCardApprovalStatus | string): boolean {
  return status === 'pending';
}

/** ADR-277 — the only states Submit for Approval / Save & Submit moves from. */
export function canSubmitRouteCardStatus(status: RouteCardApprovalStatus | string): boolean {
  return status === 'draft' || status === 'rejected';
}

/** ADR-277 — THE edit rule, used by the server and by every screen. A locked
 *  card: nobody. Otherwise the Edit right; or the Entry right on the user's OWN
 *  Draft / Rejected card, so whoever may create a card can finish it. */
export function canEditRouteCard(
  card: { approvalStatus: RouteCardApprovalStatus | string; createdBy: string },
  userId: string | null | undefined,
  rights: { entry: boolean; edit: boolean },
): boolean {
  if (isRouteCardLocked(card.approvalStatus)) return false;
  if (rights.edit) return true;
  return rights.entry && canSubmitRouteCardStatus(card.approvalStatus) && card.createdBy === userId;
}
