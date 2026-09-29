// DocRefLink — the Activity Log's "Document No." cell as a link to the
// document it names.
//
// A log row carries the document TYPE (`entity`, e.g. "SalesOrder", "Job Card")
// and, usually, its CODE (`refId`, e.g. "IN-JC-00002") — not the row uuid the
// detail routes (`/job-cards/$id` …) need. So:
//   1. ENTITY_KIND maps the stored entity name to a global-search kind.
//   2. A refId that already IS a uuid (a few writers log the id) is opened
//      straight away as that row.
//   3. A code is resolved on click through the global search (exact doc-no
//      match within that kind), then opened by `openSearchResult` — the one
//      place that decides where a document opens (detail page, or its host
//      register filtered to the code).
//   4. Nothing matched (deleted, or a kind this build cannot open) → the
//      Search page for that code, which says so.
// The href is the Search page, so Ctrl/middle-click still opens something
// sensible in a new tab.

import type { GlobalSearchKind, GlobalSearchResponse } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { openSearchResult } from '@/lib/global-search';
import { isPlainLeftClick } from '@/ui/is-plain-left-click';

/** Stored `activity_log.entity` → global-search kind. Both the CamelCase and
 *  spaced spellings the services write are listed. Entities with no page of
 *  their own (Reservation, Access Control, users …) are absent and stay text. */
const ENTITY_KIND: Record<string, GlobalSearchKind> = {
  SalesOrder: 'sales-order',
  'Sales Order': 'sales-order',
  JobWorkOrder: 'job-work-order',
  'Job Work Order': 'job-work-order',
  PurchaseRequest: 'purchase-request',
  'Purchase Request': 'purchase-request',
  PurchaseOrder: 'purchase-order',
  'Purchase Order': 'purchase-order',
  PurchaseOrderLine: 'purchase-order',
  GoodsReceiptNote: 'grn',
  GRN: 'grn',
  DeliveryChallan: 'delivery-challan',
  'Delivery Challan': 'delivery-challan',
  JobCard: 'job-card',
  'Job Card': 'job-card',
  JcOp: 'job-card',
  'JC Operation': 'job-card',
  Op: 'job-card',
  NonConformance: 'nc',
  NC: 'nc',
  Invoice: 'invoice',
  Plan: 'plan',
  BOM: 'bom-master',
  'Route Card': 'route-card',
  Item: 'item',
  Dispatch: 'customer-dispatch',
  JwInvoice: 'jw-invoice',
  JwReturnChallan: 'jw-return',
  PartyGrn: 'party-grn',
  PartyMaterialIssue: 'party-material-issue',
  Task: 'task',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DocRefLink({
  entity,
  refId,
  label,
}: {
  entity: string;
  refId: string | null;
  /** Text to show instead of the code (the Op Log shows its Log No. but opens
   *  the job card behind it). */
  label?: string | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const kind = ENTITY_KIND[entity];

  if (!refId) return <span className="text3">—</span>;
  // "bulk" and similar markers are not document numbers.
  if (!kind || refId === 'bulk') return <span className="mono text3">{refId}</span>;

  const isUuid = UUID_RE.test(refId);

  async function open(): Promise<void> {
    if (!refId || !kind) return;
    // A uuid is already the row id: open it directly (detail page, or the
    // host register for kinds without one).
    if (isUuid) {
      openSearchResult(navigate, {
        kind,
        id: refId,
        docNo: refId,
        date: null,
        party: null,
        lines: [],
        qty: null,
        status: null,
        hit: null,
      });
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<GlobalSearchResponse>(
        `/global-search?${new URLSearchParams({ q: refId, kind }).toString()}`,
      );
      const hit = res.items.find((r) => r.docNo.toLowerCase() === refId.toLowerCase()) ?? null;
      if (hit && openSearchResult(navigate, hit)) return;
    } catch {
      // Fall through to the Search page, which reports its own error.
    } finally {
      setBusy(false);
    }
    void navigate({ to: '/search', search: { q: refId, kind } });
  }

  return (
    <Link
      to="/search"
      search={{ q: isUuid ? undefined : refId, kind }}
      className="mono fw-700"
      title={`Open ${refId}`}
      style={busy ? { opacity: 0.6, cursor: 'progress' } : undefined}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) return;
        e.preventDefault();
        if (!busy) void open();
      }}
    >
      {label ?? (isUuid ? `${refId.slice(0, 8)}…` : refId)}
    </Link>
  );
}
