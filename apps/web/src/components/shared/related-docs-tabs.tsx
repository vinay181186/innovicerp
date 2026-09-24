// Related Documents — the traceability strip at the foot of a document detail
// page (SO Master, JWSO Master, PO detail).
//
// THIS FILE IS NOW A DATA WRAPPER, NOTHING ELSE. Everything it used to draw by
// hand — a row of purple `.btn`s pretending to be tabs, its own unruled
// `.innovic-table`, its own status badge map, its own raw-grey timeline rail —
// now comes from the primitives:
//
//   ui/data/RelatedDocs   the panel, the TabStrip and the ruled document sheet
//   ui/data/Timeline      the 🕒 Document Timeline, density="compact"
//   ui/core/StatusBadge   kind="doc", the generic document-status map
//
// What stays here is the only thing a primitive must not own: the fetch
// (`GET /<module>/:id/related`, the same `['related-docs', module, id]` query
// key RelatedDocsPanel caches, so no second request is made) and `renderCode`,
// which maps a `routeKind` to a real typed TanStack route. Rule #8 — no dead
// links — still lives in renderCode: an unknown kind renders as plain text.
//
// The whole panel still hides while loading, on error, and when the document
// has no related paper at all, so this additive endpoint can never break the
// host page.

import type { DocumentTraceability, RelatedSection } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { StatusBadge } from '@/ui/core';
import { RelatedDocs, Timeline, type RelatedDocsSection, type TimelineEvent } from '@/ui/data';
import { renderCode } from '@/components/shared/related-docs-panel';

/** A tab whose contents this component knows nothing about. The Related
 *  Documents strip is shared by SO / JWSO / PO, so a panel that only one of
 *  them has (the SO's drawing trail) is passed in rather than baked in here.
 *  `count` doubles as the badge and as the hide switch — a zero-count tab is
 *  dropped, exactly like an empty /related bucket. */
export type RelatedDocsExtraTab = {
  key: string;
  title: string;
  icon?: string;
  count: number;
  render: () => React.JSX.Element;
};

/** One /related bucket → one <RelatedDocs> section. The bucket owns the
 *  routeKind for every row in it, so the link is resolved here and the
 *  primitive is handed a finished node — it never learns a route. */
function toSection(s: RelatedSection): RelatedDocsSection {
  return {
    key: s.key,
    title: s.title,
    ...(s.icon ? { icon: s.icon } : {}),
    count: s.count,
    items: s.items.map((doc) => ({
      id: doc.id,
      code: renderCode(doc.code, s.routeKind, doc.id, doc.linkId),
      label: doc.label,
      status: <StatusBadge kind="doc" status={doc.status} />,
      date: doc.date,
    })),
  };
}

export function RelatedDocsTabs({
  module,
  id,
  extraTabs,
}: {
  module: string;
  id: string;
  extraTabs?: RelatedDocsExtraTab[];
}): React.JSX.Element | null {
  const { data, isLoading, isError } = useQuery<DocumentTraceability>({
    queryKey: ['related-docs', module, id],
    queryFn: () => apiFetch<DocumentTraceability>(`/${module}/${id}/related`),
    enabled: Boolean(id),
  });

  if (isLoading || isError || !data) return null;

  // Upstream + downstream + related, in that order — the reading order of the
  // paper trail. <RelatedDocs> drops the empty buckets itself.
  const sections: RelatedSection[] = [...data.upstream, ...data.downstream, ...data.related].filter(
    (s) => s.count > 0,
  );
  const extras = (extraTabs ?? []).filter((t) => t.count > 0);
  const events: TimelineEvent[] = data.timeline.map((e, i) => ({
    key: `${e.code ?? e.label}-${i}`,
    date: e.ts,
    label: e.label,
    ...(e.code ? { code: renderCode(e.code, e.routeKind, e.linkId ?? '', e.linkId) } : {}),
  }));

  if (sections.length === 0 && extras.length === 0 && events.length === 0) return null;

  return (
    <RelatedDocs
      sections={sections.map(toSection)}
      extraTabs={extras}
      // The timeline stays always-visible under the chosen category, exactly
      // where it has always been. No events, no rail — not an empty heading.
      {...(events.length > 0
        ? { children: <Timeline events={events} density="compact" title="🕒 Document Timeline" /> }
        : {})}
    />
  );
}
