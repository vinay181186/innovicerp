// Generic "Related Documents" panel (new-ERP navigation enhancement).
//
// Drop <RelatedDocsPanel module="purchase-orders" id={id} /> onto any document
// detail page. It fetches GET /<module>/:id/related (a read-only, FK-derived
// payload — DocumentTraceability) and renders four parts: Upstream, Downstream,
// Related, and a Document Timeline. Nothing is computed here; the server owns the
// relationships. The whole panel hides while loading, on error, or when empty, so
// this additive endpoint can never break the host page.
//
// Clickability (rule #8 — no dead links): a row/event links to a detail route
// ONLY when its `routeKind` is present in ROUTE_LINKS below. Every literal `to`
// here is a real typed TanStack route; unknown/null kinds render as plain text.

import type {
  DocumentTraceability,
  RelatedDoc,
  RelatedSection,
  RelatedTimelineEvent,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

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
  item: (t, i) => (
    <Link to="/items/$id" params={{ id: i }} className="td-code">
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
  'service-po': (t, i) => (
    <Link to="/service-pos/$id" params={{ id: i }} className="td-code">
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
function renderCode(
  code: string,
  routeKind: string | null,
  id: string,
  linkId: string | null,
): React.JSX.Element {
  const render = routeKind ? ROUTE_LINKS[routeKind] : undefined;
  if (render) return render(code, linkId ?? id);
  return <span title="No detail page for this document type">{code}</span>;
}

function statusBadgeClass(status: string | null): string {
  switch (status) {
    case 'open':
    case 'in_planning':
    case 'draft':
    case 'pending':
    case 'unpaid':
      return 'b-amber';
    case 'completed':
    case 'closed':
    case 'paid':
    case 'approved':
    case 'received':
    case 'dispatched':
      return 'b-green';
    case 'in_progress':
    case 'assembled':
    case 'partial':
    case 'partially_paid':
    case 'sent':
      return 'b-blue';
    case 'cancelled':
    case 'rejected':
    case 'overdue':
      return 'b-red';
    default:
      return 'b-grey';
  }
}

function StatusBadge({ status }: { status: string | null }): React.JSX.Element | null {
  if (!status) return null;
  return <span className={`badge ${statusBadgeClass(status)}`}>{status.replaceAll('_', ' ')}</span>;
}

function DocRow({ doc, routeKind }: { doc: RelatedDoc; routeKind: string | null }): React.JSX.Element {
  return (
    <tr>
      <td className="mono" style={{ fontSize: 12 }}>
        {renderCode(doc.code, routeKind, doc.id, doc.linkId)}
        {doc.label ? (
          <span className="text2" style={{ marginLeft: 8, fontSize: 11 }}>
            {doc.label}
          </span>
        ) : null}
      </td>
      <td>
        <StatusBadge status={doc.status} />
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {doc.date ?? '—'}
      </td>
    </tr>
  );
}

function Section({ section }: { section: RelatedSection }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {section.icon ? `${section.icon} ` : ''}
          {section.title}
        </span>
        <span className="badge b-grey">{section.count}</span>
      </div>
      {section.count === 0 ? (
        <div className="text3" style={{ fontSize: 12, paddingLeft: 4 }}>
          none
        </div>
      ) : (
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((doc) => (
              <DocRow key={doc.id} doc={doc} routeKind={section.routeKind} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SectionBlock({
  heading,
  sections,
}: {
  heading: string;
  sections: RelatedSection[];
}): React.JSX.Element | null {
  // Only render a block when at least one of its sections has rows.
  const nonEmpty = sections.filter((s) => s.count > 0);
  if (nonEmpty.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        className="text3"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}
      >
        {heading}
      </div>
      {nonEmpty.map((s) => (
        <Section key={s.key} section={s} />
      ))}
    </div>
  );
}

function Timeline({ events }: { events: RelatedTimelineEvent[] }): React.JSX.Element | null {
  if (events.length === 0) return null;
  return (
    <div>
      <div
        className="text3"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}
      >
        🕒 Document Timeline
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid #e5e7eb' }}>
        {events.map((e, idx) => (
          <li key={`${e.code ?? e.label}-${idx}`} style={{ position: 'relative', padding: '4px 0 4px 14px' }}>
            <span
              style={{
                position: 'absolute',
                left: -5,
                top: 9,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#9ca3af',
              }}
            />
            <span className="text2" style={{ fontSize: 11, marginRight: 8 }}>
              {e.ts ?? '—'}
            </span>
            <span style={{ fontSize: 12 }}>
              {e.label}
              {e.code ? (
                <span style={{ marginLeft: 6 }}>
                  {renderCode(e.code, e.routeKind, e.linkId ?? '', e.linkId)}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Fetch + render the Related Documents panel for one document. Self-contained:
 *  give it the module slug (the API route prefix) and the document id. */
export function RelatedDocsPanel({
  module,
  id,
}: {
  module: string;
  id: string;
}): React.JSX.Element | null {
  const { data, isLoading, isError } = useQuery<DocumentTraceability>({
    queryKey: ['related-docs', module, id],
    queryFn: () => apiFetch<DocumentTraceability>(`/${module}/${id}/related`),
    enabled: Boolean(id),
  });

  if (isLoading || isError || !data) return null;

  const hasAny =
    data.upstream.some((s) => s.count > 0) ||
    data.downstream.some((s) => s.count > 0) ||
    data.related.some((s) => s.count > 0) ||
    data.timeline.length > 0;
  if (!hasAny) return null;

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-hdr">
        <div className="panel-title">🔗 Related Documents</div>
      </div>
      <div className="panel-body">
        <SectionBlock heading="⬆ Upstream (source)" sections={data.upstream} />
        <SectionBlock heading="⬇ Downstream (generated)" sections={data.downstream} />
        <SectionBlock heading="↔ Related" sections={data.related} />
        <Timeline events={data.timeline} />
      </div>
    </div>
  );
}
