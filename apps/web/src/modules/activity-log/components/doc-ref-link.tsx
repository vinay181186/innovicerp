// DocRefLink — the Activity Log's "Document No." cell as a link to the
// document it names.
//
// A log row carries the document TYPE (`entity`, e.g. "SalesOrder", "Job Card"),
// usually its CODE (`refId`, e.g. "IN-JC-00002") and, since ADR-197, the
// document's uuid (`entityId`). So:
//   1. lib/activity-entity.ts maps the stored entity (any spelling) to where
//      it opens: a global-search kind, or a detail route by id.
//   2. With an `entityId` (or a refId that already IS a uuid — a few old
//      writers logged the id) the document opens straight away.
//   3. A code alone is resolved on click through the global search (exact
//      doc-no match within that kind), then opened by `openSearchResult` — the
//      one place that decides where a document opens (detail page, or its host
//      register filtered to the code).
//   4. Nothing matched (deleted, or a kind this build cannot open) → the
//      Search page for that code, which says so.
// The href is the Search page, so Ctrl/middle-click still opens something
// sensible in a new tab.

import type { GlobalSearchResponse } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { openSearchResult } from '@/lib/global-search';
import { isPlainLeftClick } from '@/ui/is-plain-left-click';
import { activityEntityTarget } from '../lib/activity-entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DocRefLink({
  entity,
  refId,
  entityId,
  label,
}: {
  entity: string;
  refId: string | null;
  /** The document's uuid when the log row carries it (ADR-197). */
  entityId?: string | null | undefined;
  /** Text to show instead of the code (the Op Log shows its Log No. but opens
   *  the job card behind it). */
  label?: string | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const target = activityEntityTarget(entity);
  const id = entityId ?? (refId && UUID_RE.test(refId) ? refId : null);

  if (!refId && !id) return <span className="text3">—</span>;
  const text = label ?? (refId && !UUID_RE.test(refId) ? refId : `${(id ?? '').slice(0, 8)}…`);
  // "bulk" and similar markers are not document numbers.
  if (!target || refId === 'bulk') return <span className="mono text3">{text}</span>;
  // A detail route by id only: without the id there is nothing to open.
  if (target.route && !id) return <span className="mono text3">{text}</span>;

  const kind = target.kind;
  const route = target.route;

  async function open(): Promise<void> {
    if (route) {
      if (id) void navigate({ to: route, params: { id } });
      return;
    }
    if (!kind) return;
    if (id) {
      openSearchResult(navigate, {
        kind,
        id,
        docNo: refId ?? id,
        date: null,
        party: null,
        lines: [],
        qty: null,
        status: null,
        hit: null,
      });
      return;
    }
    if (!refId) return;
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

  const searchCode = refId && !UUID_RE.test(refId) ? refId : undefined;
  return (
    <Link
      to="/search"
      search={{ q: searchCode, kind }}
      className="mono fw-700"
      title={`Open ${refId ?? 'document'}`}
      style={busy ? { opacity: 0.6, cursor: 'progress' } : undefined}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) return;
        e.preventDefault();
        if (!busy) void open();
      }}
    >
      {text}
    </Link>
  );
}
