// Edit-approval engine registry (ADR-202). One entry per document type enrolled
// in edit-approval, keyed by its ActivityLog entity name. The engine
// (./service.ts) is entity-agnostic: it drives everything through this table, so
// Phase 2 adds a document by adding one entry here — no engine change.
//
// Phase 1 enrolled PurchaseOrder; Phase 2a added PurchaseRequest, NonConformance
// and Plan at RECORD/HEADER level; Phase 2b adds SalesOrder and JobWorkOrder,
// also at RECORD/HEADER level (their child lines / milestones are not staged).

import type { AccessFormKey, DocumentEditEntity } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import type { DiffField } from '../../lib/audit-trail';
import { grnEditRegistryEntry } from '../goods-receipt-notes/grn-edit-registry';
import { jobCardEditRegistryEntry } from '../job-cards/jobcard-edit-registry';
import { jwEditRegistryEntry } from '../job-work-orders/jw-edit-registry';
import { ncEditRegistryEntry } from '../nc-register/nc-edit-registry';
import { planEditRegistryEntry } from '../plans/plan-edit-registry';
import { poEditRegistryEntry } from '../purchase-orders/po-edit-registry';
import { prEditRegistryEntry } from '../purchase-requests/pr-edit-registry';
import { soEditRegistryEntry } from '../sales-orders/so-edit-registry';

/** The locked (or read) target document, projected to just what the engine
 *  needs: the row for diffing, its optimistic-lock token, its code, and whether
 *  it is LIVE (a draft edits directly; a live edit is staged). */
export interface DocEditTarget {
  doc: Record<string, unknown>;
  updatedAt: Date | string | null;
  docCode: string;
  isLive: boolean;
}

/** What one document type must provide for the engine to stage and apply edits
 *  to it. The diff is computed over flat {key → value} snapshots whose keys are
 *  `diffFields` keys, so the same `diffFields()` the audit trail uses produces
 *  the change list and, at approval, the drift check. */
export interface DocEditRegistryEntry {
  /** Access Control form that gates edit (request) and approve (decide). */
  formKey: AccessFormKey;
  /** The fields compared, in display order. A FUNCTION of the locked target, not
   *  a static list: PO line keys (`line:<lineId>:item|qty|rate`) are built from
   *  the document's CURRENT lines, so the set changes per document (Phase 1b). */
  diffFields(target: DocEditTarget): readonly DiffField[];
  /** Lock the target row FOR UPDATE and project it. Null = gone / not visible. */
  loadForDiff(tx: DbTransaction, companyId: string, id: string): Promise<DocEditTarget | null>;
  /** The flat current-value snapshot for diffing (keys = diffFields keys). */
  beforeSnapshot(target: DocEditTarget): Record<string, unknown>;
  /** The flat proposed-value snapshot from the edit input (keys = diffFields
   *  keys). Omits a key the input did not touch, so it is not seen as a change.
   *  `user` is the actor (requester, or approver on the drift recompute) — used
   *  to gate price-only fields. */
  afterSnapshot(
    tx: DbTransaction,
    companyId: string,
    input: unknown,
    user: AuthContext,
  ): Promise<Record<string, unknown>>;
  /** Rebuild a proposed edit input carrying ONLY the approved field keys, or
   *  null when none remain. */
  buildFilteredInput(proposedPayload: unknown, approvedFields: ReadonlySet<string>): unknown | null;
  /** Apply the filtered input inside the engine's transaction (which already
   *  holds the target row lock). `expectedUpdatedAt` is the freshly-locked token. */
  applyEdit(
    tx: DbTransaction,
    companyId: string,
    id: string,
    filteredInput: unknown,
    expectedUpdatedAt: string | null,
    user: AuthContext,
  ): Promise<void>;
  /** Batch lookup of each document's current updated_at, so the inbox's isStale
   *  flag costs one query per entity type, not one per request (§6 no N+1). */
  loadUpdatedAts(
    tx: DbTransaction,
    companyId: string,
    ids: string[],
  ): Promise<Map<string, Date | string | null>>;
}

// Partial: an entity may be listed in the frozen DOCUMENT_EDIT_ENTITIES before its
// registry entry is wired (lets each document be enrolled independently, and lets
// several enrollments land in parallel). getEntry() throws a clear error for an
// entity that is enumerated but not yet registered — it only fires at runtime when
// an edit to that document is actually diverted, never at type-check.
export const DOC_EDIT_REGISTRY: Partial<Record<DocumentEditEntity, DocEditRegistryEntry>> = {
  PurchaseOrder: poEditRegistryEntry,
  PurchaseRequest: prEditRegistryEntry,
  NonConformance: ncEditRegistryEntry,
  Plan: planEditRegistryEntry,
  SalesOrder: soEditRegistryEntry,
  JobWorkOrder: jwEditRegistryEntry,
  GoodsReceiptNote: grnEditRegistryEntry,
  JobCard: jobCardEditRegistryEntry,
};
