// Where a document opens in the web app, as a `navPage` string (ADR-190).
//
// The same string the Task Board stores on a task's linkedRef.navPage (the web
// helper relatedNavPage in modules/tasks/lib/format.ts builds those, and these
// paths are identical to it for the six Task Board kinds). The server uses this
// to hand the web a ready-made link on read models that have no page of their
// own — alert drill-down records, the approvals inbox — so the browser never
// guesses a route from a code.
//
// Kind names are the Related Documents panel's `routeKind` vocabulary
// (traceability.ts), so one kind means one page everywhere. Add a kind only for
// a page that really exists.

export const DOC_NAV_KINDS = [
  'sales-order',
  'purchase-request',
  'purchase-order',
  'grn',
  'job-card',
  'nc',
  'item',
  'machine',
  'client',
  'vendor',
  'bom-master',
  'invoice',
  'design-project',
  'qc-call',
] as const;

export type DocNavKind = (typeof DOC_NAV_KINDS)[number];

/** `docNavPage('sales-order', id)` → `/sales-orders/<id>`. A QC call is a
 *  jc_op id and opens the QC Call Register on that op. */
export function docNavPage(kind: DocNavKind, id: string): string {
  switch (kind) {
    case 'sales-order':
      return `/sales-orders/${id}`;
    case 'purchase-request':
      return `/purchase-requests/${id}`;
    case 'purchase-order':
      return `/purchase-orders/${id}`;
    case 'grn':
      return `/goods-receipt-notes/${id}`;
    case 'job-card':
      return `/job-cards/${id}`;
    case 'nc':
      return `/nc-register/${id}`;
    case 'item':
      return `/items/${id}`;
    case 'machine':
      return `/machines/${id}`;
    case 'client':
      return `/clients/${id}`;
    case 'vendor':
      return `/vendors/${id}`;
    case 'bom-master':
      return `/bom-masters/${id}`;
    case 'invoice':
      return `/invoices/${id}`;
    case 'design-project':
      return `/design-projects/${id}`;
    case 'qc-call':
      return `/qc-call-register?op=${id}`;
  }
}
