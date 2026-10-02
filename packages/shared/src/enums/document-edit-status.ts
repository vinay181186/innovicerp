// Lifecycle of a staged edit request (edit-approval, ADR-202). Deliberately
// SEPARATE from the document's own business status — approving or rejecting a
// change never moves the document's status, it only resolves this request.
// 'pending' is the only state in which the live document is untouched.
export const DOCUMENT_EDIT_STATUSES = [
  'pending', // waiting for a decision; the live document is untouched
  'approved', // decided — at least one change was applied to the document
  'rejected', // decided — every change was rejected, nothing applied
  'withdrawn', // the requester pulled it back before a decision
  'superseded', // the document moved under it; approved changes could not apply
] as const;

export type DocumentEditStatus = (typeof DOCUMENT_EDIT_STATUSES)[number];

// The outcome recorded per individual change when the approver decides (1A —
// per-change approve/reject). 'superseded' = approved but the document's value
// had already drifted from the captured `before`, so it was not applied.
export const DOCUMENT_EDIT_CHANGE_OUTCOMES = ['approved', 'rejected', 'superseded'] as const;

export type DocumentEditChangeOutcome = (typeof DOCUMENT_EDIT_CHANGE_OUTCOMES)[number];
