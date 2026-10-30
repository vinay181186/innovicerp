// OW-143 — where the customer's own raw material is, as ONE word, on every JWSO
// screen (Master List, the list's ▸ line table, JWSO detail header + lines).
// The server computes the status (packages/shared lib/customer-rm-status.ts);
// this only maps status → word + colour, and lists the quantities on hover.
//
// Hover = the native `title` (one line per row). The app has no shared hover
// popover that renders through a portal — RowMenu is an action menu — and an
// absolutely-positioned popup would be clipped by the table cell's
// overflow:hidden inside the scrolling .tbl-wrap.

import { CUSTOMER_RM_STATUS_LABEL, type CustomerRm } from '@innovic/shared';

const COLOUR: Record<CustomerRm['status'], string> = {
  awaited: 'var(--red2)',
  deviated: 'var(--red2)',
  partial: 'var(--amber2)',
  inspection: 'var(--amber2)',
  accepted: 'var(--green2)',
  issuing: 'var(--blue)',
  issued: 'var(--blue)',
  none: 'var(--text3)',
};

const RULE = '────────────';

/** The hover breakdown, one row per line. */
function breakdown(v: CustomerRm): string {
  return [
    `Required: ${v.requiredQty}`,
    `Received (Party GRN): ${v.receivedQty}`,
    RULE,
    `GRN Pending: ${v.grnPendingQty}`,
    `QC Pending: ${v.qcPendingQty}`,
    `Deviated – NC Open: ${v.deviatedQty}`,
    `In Store: ${v.inStoreQty}`,
    `Issued to JC: ${v.issuedQty}`,
    `Returned to Customer: ${v.returnedQty}`,
    RULE,
    `Accepted at QC (total): ${v.acceptedQty}`,
  ].join('\n');
}

export function CustomerRmStatus({ value }: { value: CustomerRm | undefined }): React.JSX.Element {
  if (!value || value.status === 'none') {
    return <span style={{ color: 'var(--text3)' }}>—</span>;
  }
  return (
    <span
      style={{ color: COLOUR[value.status], fontWeight: 700, cursor: 'help' }}
      title={breakdown(value)}
    >
      {CUSTOMER_RM_STATUS_LABEL[value.status]}
    </span>
  );
}
