// The routeKind registry of the Related Documents panel (<RelatedDocsTabs>).
//
// Clickability (rule #8 — no dead links): a row/event links to a detail route
// ONLY when its `routeKind` is present in ROUTE_LINKS below. Every literal `to`
// here is a real typed TanStack route; unknown/null kinds render as plain text.

import { Link } from '@tanstack/react-router';

/** routeKind → how to render a linked code. The param id defaults to the row's
 *  own id but honours `linkId` when a route is scoped by a different key (e.g.
 *  assembly units link to /assemblies/$soId). Add an entry only for a route that
 *  actually exists. */
const ROUTE_LINKS: Record<string, (label: string, linkId: string) => React.JSX.Element> = {
  client: (t, i) => (
    <Link to="/clients/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  vendor: (t, i) => (
    <Link to="/vendors/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  // An item code stays dark and bold, link or not (owner): never `.td-code` blue.
  item: (t, i) => (
    <Link
      to="/items/$id"
      params={{ id: i }}
      className="mono fw-700"
      style={{ color: 'var(--text)', textDecoration: 'none' }}
    >
      {t}
    </Link>
  ),
  machine: (t, i) => (
    <Link to="/machines/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  operator: (t, i) => (
    <Link to="/operators/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'bom-master': (t, i) => (
    <Link to="/bom-masters/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'route-card': (t, i) => (
    <Link to="/route-cards/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'sales-order': (t, i) => (
    <Link to="/sales-orders/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'job-work-order': (t, i) => (
    <Link to="/job-work-orders/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'job-card': (t, i) => (
    <Link to="/job-cards/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'production-order': (t, i) => (
    <Link to="/production-orders/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  plan: (t, i) => (
    <Link to="/plans/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'purchase-request': (t, i) => (
    <Link to="/purchase-requests/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'purchase-order': (t, i) => (
    <Link to="/purchase-orders/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  grn: (t, i) => (
    <Link to="/goods-receipt-notes/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'delivery-challan': (t, i) => (
    <Link to="/delivery-challans/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'jw-dc': (t, i) => (
    <Link to="/jw-dc/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  nc: (t, i) => (
    <Link to="/nc-register/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  invoice: (t, i) => (
    <Link to="/invoices/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  'design-project': (t, i) => (
    <Link to="/design-projects/$id" params={{ id: i }} className="td-code">
      {t}
    </Link>
  ),
  assembly: (t, i) => (
    <Link to="/assemblies/$soId" params={{ soId: i }} className="td-code">
      {t}
    </Link>
  ),
};

/** Render a document code as a Link when its kind is routable, else plain text
 *  (no dead link — rule #8). */
export function renderCode(
  code: string,
  routeKind: string | null,
  id: string,
  linkId: string | null,
): React.JSX.Element {
  const render = routeKind ? ROUTE_LINKS[routeKind] : undefined;
  if (render) return render(code, linkId ?? id);
  return <span title="No detail page for this document type">{code}</span>;
}
