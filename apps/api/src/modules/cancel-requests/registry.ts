// ADR-235 — the Cancel registry: one handler per enrolled document type.
//
// A handler owns nothing new: it locks the document, says what would refuse
// the cancel today (blockers), says what the cancel will do (effects), and
// runs the document module's OWN cancel worker (§20.1 — one writer per
// number). Each handler lives in its document's module folder.

import type {
  CancelBlocker,
  CancelDocType,
  CancelEffect,
  DocumentEditEntity,
} from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { customerDispatchCancelHandler } from '../customer-dispatches/cancel-handler';
import { invoiceCancelHandler } from '../invoices/cancel-handler';
import { jwInvoiceCancelHandler } from '../jw-invoices/cancel-handler';

export interface CancelHandler {
  docType: CancelDocType;
  /** The document's edit-approval entity (document_edit_requests.entity), or
   *  null when the type has no edit approval. A pending staged edit blocks a
   *  Cancel Request. */
  editEntity: DocumentEditEntity | null;
  /** Read the document; `forUpdate` locks it (request / approve). The preview
   *  reads without a lock. null = not found in this company. */
  lock(
    tx: DbTransaction,
    companyId: string,
    docId: string,
    forUpdate: boolean,
  ): Promise<{ code: string; cancelled: boolean } | null>;
  /** The worker's own refusal rule (the same function), right now. */
  blockers(tx: DbTransaction, companyId: string, docId: string): Promise<CancelBlocker[]>;
  /** What the cancel will do — shown before the user commits. */
  effects(tx: DbTransaction, companyId: string, docId: string): Promise<CancelEffect[]>;
  /** Run the module's own cancel worker, in the caller's transaction. */
  run(
    tx: DbTransaction,
    companyId: string,
    docId: string,
    reason: string,
    actor: AuthContext,
  ): Promise<void>;
}

export const CANCEL_HANDLERS: Record<CancelDocType, CancelHandler> = {
  invoice: invoiceCancelHandler,
  jw_invoice: jwInvoiceCancelHandler,
  customer_dispatch: customerDispatchCancelHandler,
};
