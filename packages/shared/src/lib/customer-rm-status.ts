// Where is the customer's own raw material for a JWSO line (or a whole JWSO)?
// ONE rule, in ONE place (OW-143). The API fills `customerRm.status` from it;
// the web only maps the status to its word and colour.
//
// Before this the JWSO Master List compared QC-accepted qty with the order
// qty, so material sitting at the gate waiting for Incoming QC read
// "✕ None accepted", and pieces issued to a Job Card still read "✓ Accepted".
//
// Pure arithmetic: no database, no React, no colours. The quantities are read
// by the API from the documents that move the material (Party GRN, Incoming
// QC, the deviation NC, Issue to JC / Return to Store, Customer Material
// Return) — nothing is stored, so no writer can leave it out of step.

/** Every state, in the order the material moves. `none` = cancelled JWSO or
 *  nothing to track. Awaited = nothing received yet · Partial = some received,
 *  the rest still due · Inspection = received, waiting for Incoming QC ·
 *  Deviated = deviated pieces whose NC is still pending · Accepted = QC passed,
 *  all in store · Issuing = part issued to a Job Card, the rest in store ·
 *  Issued = everything accepted has gone to a Job Card. */
export const CUSTOMER_RM_STATUSES = [
  'awaited',
  'partial',
  'inspection',
  'deviated',
  'accepted',
  'issuing',
  'issued',
  'none',
] as const;
export type CustomerRmStatus = (typeof CUSTOMER_RM_STATUSES)[number];

/** One word per state (owner, OW-143 mockup 2026-10-30). */
export const CUSTOMER_RM_STATUS_LABEL: Record<CustomerRmStatus, string> = {
  awaited: 'Awaited',
  partial: 'Partial',
  inspection: 'Inspection',
  deviated: 'Deviated',
  accepted: 'Accepted',
  issuing: 'Issuing',
  issued: 'Issued',
  none: '—',
};

/** The quantities the rule reads — one JWSO line, or the sum of a JWSO's lines. */
export interface CustomerRmQty {
  /** Order qty of lines that carry a customer RM (1 RM piece per part, ADR-203). */
  requiredQty: number;
  /** Σ received on live Party GRN lines (all QC outcomes). */
  receivedQty: number;
  /** Received and still waiting for Incoming QC. */
  qcPendingQty: number;
  /** Deviated at Incoming QC with the NC still pending (ADR-247). */
  deviatedQty: number;
  /** QC-accepted (Use As Is pieces included). */
  acceptedQty: number;
  /** Accepted − net issued to Job Cards − good pieces returned to the customer. */
  inStoreQty: number;
  /** Issued to Job Cards − returned to store. */
  issuedQty: number;
  /** Sent back on a live Customer Material Return (good + deviated). */
  returnedQty: number;
}

/** Still to come from the customer: what is not yet received, waiting QC,
 *  accepted or held on a pending NC (the Party GRN receive cap's own rule,
 *  party-grn partyCommittedQtySql). */
export function customerRmGrnPendingQty(q: CustomerRmQty): number {
  return Math.max(0, q.requiredQty - q.qcPendingQty - q.acceptedQty - q.deviatedQty);
}

/** The one word. The state that needs action comes first:
 *  Deviated → Inspection → Partial / Awaited → Accepted → Issuing → Issued. */
export function customerRmStatus(q: CustomerRmQty, cancelled: boolean): CustomerRmStatus {
  if (cancelled) return 'none';
  if (q.requiredQty === 0 && q.receivedQty === 0) return 'none';
  if (q.deviatedQty > 0) return 'deviated';
  if (q.qcPendingQty > 0) return 'inspection';
  if (customerRmGrnPendingQty(q) > 0) {
    return q.acceptedQty > 0 ? 'partial' : 'awaited';
  }
  if (q.inStoreQty > 0) return q.issuedQty > 0 ? 'issuing' : 'accepted';
  if (q.issuedQty > 0) return 'issued';
  // Everything accepted went back to the customer — nothing left to track.
  return 'none';
}

/** Σ of several lines' quantities — the JWSO's word is the rule on the sum. */
export function sumCustomerRmQty(rows: readonly CustomerRmQty[]): CustomerRmQty {
  const t: CustomerRmQty = {
    requiredQty: 0,
    receivedQty: 0,
    qcPendingQty: 0,
    deviatedQty: 0,
    acceptedQty: 0,
    inStoreQty: 0,
    issuedQty: 0,
    returnedQty: 0,
  };
  for (const r of rows) {
    t.requiredQty += r.requiredQty;
    t.receivedQty += r.receivedQty;
    t.qcPendingQty += r.qcPendingQty;
    t.deviatedQty += r.deviatedQty;
    t.acceptedQty += r.acceptedQty;
    t.inStoreQty += r.inStoreQty;
    t.issuedQty += r.issuedQty;
    t.returnedQty += r.returnedQty;
  }
  return t;
}
