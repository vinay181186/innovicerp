// ADR-265 — which approval types the caller may decide. No new rules: each
// answer is the check the type's own decide endpoint makes.
//   po       loadPoInboxAccess        (approvePurchaseOrder's Approve tick)
//   rc       loadRcInboxAccess        (approveRouteCard's Approve tick)
//   logEntry decidableTimeChangeScope (decideOpLogTimeChange, ADR-232)
//   edit     Approve on DOCUMENT_EDIT_FORM_KEY[entity] (decideDocumentEdit)
//   cancel   typesWith(user, 'decide') (decideCancelRequest, cancelDeciderRight)
// Every check opens its own transaction: call these BEFORE / outside any
// withUserContext transaction.

import {
  type AccessFormKey,
  type CancelDocType,
  DOCUMENT_EDIT_ENTITIES,
  DOCUMENT_EDIT_FORM_KEY,
  type DocumentEditEntity,
} from '@innovic/shared';
import type { SQL } from 'drizzle-orm';
import type { AuthContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { typesWith } from '../cancel-requests/list';
import { decidableTimeChangeScope } from '../op-entry/time-change-page';
import { loadPoInboxAccess } from '../purchase-orders/approval-inbox';
import { loadRcInboxAccess } from '../route-cards/approval-inbox';

/** Document types whose edit requests the caller may decide — one access
 *  check per distinct form, not per entity. */
export async function approvableEditEntities(user: AuthContext): Promise<DocumentEditEntity[]> {
  const forms = [...new Set(DOCUMENT_EDIT_ENTITIES.map((e) => DOCUMENT_EDIT_FORM_KEY[e]))];
  const ok = await Promise.all(forms.map((f) => hasFormAccess(user, f, 'approve')));
  const allowed = new Set<AccessFormKey>(forms.filter((_, i) => ok[i]));
  return DOCUMENT_EDIT_ENTITIES.filter((e) => allowed.has(DOCUMENT_EDIT_FORM_KEY[e]));
}

/** Cancel Request doc types the caller may decide. */
export const decidableCancelTypes = (user: AuthContext): Promise<CancelDocType[]> =>
  typesWith(user, 'decide');

export interface ApproverScope {
  po: boolean;
  rc: boolean;
  /** `AND …` on an op_log alias `l` (ADR-232), or null = no log-entry right. */
  logScope: SQL | null;
  editEntities: DocumentEditEntity[];
  cancelTypes: CancelDocType[];
}

/** Every type at once (history). The waiting list reads po / rc / logEntry
 *  through readApprovalInbox instead, which answers them on the way. */
export async function loadApproverScope(user: AuthContext): Promise<ApproverScope> {
  const [po, rc, opApprove, qcApprove, editEntities, cancelTypes] = await Promise.all([
    loadPoInboxAccess(user),
    loadRcInboxAccess(user),
    hasFormAccess(user, 'op_entry', 'approve'),
    hasFormAccess(user, 'qc_submit', 'approve'),
    approvableEditEntities(user),
    decidableCancelTypes(user),
  ]);
  const logScope = opApprove || qcApprove ? await decidableTimeChangeScope(user) : null;
  return { po: po.canApprove, rc: rc.canApprove, logScope, editEntities, cancelTypes };
}
