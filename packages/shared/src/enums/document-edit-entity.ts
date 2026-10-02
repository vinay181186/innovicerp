// Documents enrolled in edit-approval. The value is the ActivityLog entity
// name (§18 — one fact, one name) so the request's REQUEST / APPROVE / REJECT
// trail renders on the document's own History tab with no new view.
//
// This list grows by exactly one entry per rollout batch. Phase 1 enrols only
// Purchase Order; Phase 2 adds the other transactional documents and masters;
// Phase 3 adds the four documents that gain edit screens.
export const DOCUMENT_EDIT_ENTITIES = ['PurchaseOrder'] as const;

export type DocumentEditEntity = (typeof DOCUMENT_EDIT_ENTITIES)[number];
