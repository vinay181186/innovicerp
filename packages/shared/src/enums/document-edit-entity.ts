// Documents enrolled in edit-approval. The value is the ActivityLog entity
// name (§18 — one fact, one name) so the request's REQUEST / APPROVE / REJECT
// trail renders on the document's own History tab with no new view.
//
// This list grows one batch at a time. Phase 1 enrolled Purchase Order; Phase 2
// adds the other transactional documents (and later masters); Phase 3 adds the
// four documents that gain edit screens. Each value is that document's canonical
// ActivityLog entity name.
export const DOCUMENT_EDIT_ENTITIES = [
  'PurchaseOrder',
  'PurchaseRequest',
  'NonConformance',
  'Plan',
] as const;

export type DocumentEditEntity = (typeof DOCUMENT_EDIT_ENTITIES)[number];
