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
import { customerMaterialReturnCancelHandler } from '../customer-material-returns/cancel-handler';
import { deliveryChallanCancelHandler } from '../delivery-challans/cancel-handler';
import { dcReceiptCancelHandler } from '../delivery-challans/receipt-cancel-handler';
import { grnCancelHandler } from '../goods-receipt-notes/cancel-handler';
import { invoiceCancelHandler } from '../invoices/cancel-handler';
import { jobCardCancelHandler } from '../job-cards/cancel-handler';
import { jobWorkOrderCancelHandler } from '../job-work-orders/cancel-handler';
import { jwDcOutwardCancelHandler } from '../jw-dc/cancel-handler';
import { jwDcInwardCancelHandler } from '../jw-dc/inward-cancel-handler';
import { jwInvoiceCancelHandler } from '../jw-invoices/cancel-handler';
import { jwReturnCancelHandler } from '../jw-returns/cancel-handler';
import { partyGrnCancelHandler } from '../party-grn/cancel-handler';
import { partyMaterialIssueCancelHandler } from '../party-material-issues/cancel-handler';
import { planCancelHandler } from '../plans/cancel-handler';
import { productionOrderCancelHandler } from '../production-orders/cancel-handler';
import { purchaseOrderCancelHandler } from '../purchase-orders/cancel-handler';
import { purchaseRequestCancelHandler } from '../purchase-requests/cancel-handler';
import { salesOrderCancelHandler } from '../sales-orders/cancel-handler';
import { stockCountCancelHandler } from '../stock-counts/cancel-handler';
import { storeIssueCancelHandler } from '../store-issues/cancel-handler';
import { toolIssueCancelHandler } from '../tool-issues/cancel-handler';

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
  jw_return: jwReturnCancelHandler,
  customer_material_return: customerMaterialReturnCancelHandler,
  party_grn: partyGrnCancelHandler,
  party_material_issue: partyMaterialIssueCancelHandler,
  delivery_challan: deliveryChallanCancelHandler,
  store_issue: storeIssueCancelHandler,
  stock_count: stockCountCancelHandler,
  tool_issue: toolIssueCancelHandler,
  purchase_request: purchaseRequestCancelHandler,
  purchase_order: purchaseOrderCancelHandler,
  jw_dc_outward: jwDcOutwardCancelHandler,
  plan: planCancelHandler,
  job_work_order: jobWorkOrderCancelHandler,
  sales_order: salesOrderCancelHandler,
  grn: grnCancelHandler,
  job_card: jobCardCancelHandler,
  production_order: productionOrderCancelHandler,
  dc_receipt: dcReceiptCancelHandler,
  jw_dc_inward: jwDcInwardCancelHandler,
};

/** One-step cancel (owner rule 2026-10-31, Purchase Request): the page's EDIT
 *  tick cancels at once. A request is still written (and approved in the same
 *  transaction) so the history reads like every other document; one already
 *  pending from before stays decidable / withdrawable with the Edit tick. The
 *  list and the decider right live in shared (ONE_STEP_CANCEL_DOC_TYPES /
 *  cancelDeciderRight) so the screens read the same rule. */
export { cancelDeciderRight } from '@innovic/shared';
