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
// (`GET /<module>/:id/related`) and `renderCode`, which maps a `routeKind` to a
// real typed TanStack route. Rule #8 — no dead links — still lives in renderCode:
// an unknown kind renders as plain text.
//
// Document tabs wait for their data; History never does. The panel hides only when the document
// has no related paper at all, so this additive endpoint can never break the
// host page.

import type {
  DocumentTraceability,
  RelatedDoc as RelatedDocRow,
  RelatedItem,
  RelatedSection,
  RelatedTimelineEvent,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { itemCodeWithRev } from '@/lib/item-code';
import { StatusBadge } from '@/ui/core';
import {
  RelatedDocs,
  Timeline,
  type RelatedDocItem,
  type RelatedDocsSection,
  type TimelineEvent,
} from '@/ui/data';
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

/** A row of a document tab: the item in the one standard form. */
function toItem(it: RelatedItem): RelatedDocItem {
  return {
    pol: it.clientPoLineNo,
    code: itemCodeWithRev(it.itemCode, it.itemRevision),
    name: it.itemName,
  };
}

/** A row of the Item tab IS the item. Linked only when the item exists: a
 *  free-text line must not be a dead link. */
function toItemRow(doc: RelatedDocRow, it: RelatedItem | undefined): RelatedDocItem {
  const itemId = it?.itemId;
  return {
    code: itemId ? renderCode(doc.code, 'item', itemId, itemId) : doc.code,
    name: it?.itemName ?? doc.label,
  };
}

/** A timeline event's item: CODE/REV, its name, and how many more the document has. */
function eventItem(e: RelatedTimelineEvent): React.JSX.Element | null {
  if (!e.item) return null;
  const code = itemCodeWithRev(e.item.itemCode, e.item.itemRevision);
  const name = e.item.itemName ?? '—';
  return (
    <span title={`${code} ${name}`}>
      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
        {code}
      </span>{' '}
      <span className="text2">{name}</span>
      {e.moreItems > 0 ? <span className="text3"> +{e.moreItems} more</span> : null}
    </span>
  );
}

/** One /related bucket → one <RelatedDocs> section. The bucket owns the
 *  routeKind for every row in it, so the link is resolved here and the
 *  primitive is handed a finished node — it never learns a route. */
function toSection(s: RelatedSection): RelatedDocsSection {
  // `??`: the server and this screen deploy minutes apart; an old answer has neither.
  const mode = s.itemMode ?? 'none';
  return {
    key: s.key,
    title: s.title,
    ...(s.icon ? { icon: s.icon } : {}),
    count: s.count,
    mode,
    codeHeading: s.codeHeading,
    labelHeading: s.labelHeading,
    items: s.items.map((doc) => {
      const items = doc.items ?? [];
      return {
        id: doc.id,
        code: renderCode(doc.code, s.routeKind, doc.id, doc.linkId),
        label: doc.label,
        status: doc.status ? <StatusBadge kind="doc" status={doc.status} /> : undefined,
        date: doc.date,
        items: mode === 'items' ? [toItemRow(doc, items[0])] : items.map(toItem),
      };
    }),
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
  const { data } = useQuery<DocumentTraceability>({
    queryKey: ['related-docs', module, id],
    queryFn: () => apiFetch<DocumentTraceability>(`/${module}/${id}/related`),
    enabled: Boolean(id),
  });

  // Upstream + downstream + related, in that order — the reading order of the
  // paper trail. <RelatedDocs> drops the empty buckets itself.
  // Not loaded (or refused): no document tabs yet, but the page's History must not vanish.
  const sections: RelatedSection[] = [
    ...(data?.upstream ?? []),
    ...(data?.downstream ?? []),
    ...(data?.related ?? []),
  ].filter((s) => s.count > 0);
  const extras = (extraTabs ?? []).filter((t) => t.count > 0);
  const events: TimelineEvent[] = (data?.timeline ?? []).map((e, i) => ({
    key: `${e.code ?? e.label}-${i}`,
    date: e.ts,
    label: e.label,
    ...(e.code ? { code: renderCode(e.code, e.routeKind, e.linkId ?? '', e.linkId) } : {}),
    detail: eventItem(e),
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
