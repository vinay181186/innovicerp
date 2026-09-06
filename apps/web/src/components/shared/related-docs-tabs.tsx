// Related Documents shown as clickable category tabs — the SO Master detail
// treatment, generalized so any document detail page can reuse it.
//
// Same data as <RelatedDocsPanel variant="full">, but presented as tabs: one tab
// per bucket that actually has documents (Client / Planning / Job Cards /
// Purchase Orders / … — whatever the module's /related endpoint returns), so
// nothing is ever hidden. The selected tab's docs render in a table below, and
// the 🕒 Document Timeline stays always-visible underneath.
//
// No new API call: it reuses the exact ['related-docs', module, id] query that
// RelatedDocsPanel caches, plus that panel's renderCode/StatusBadge/Timeline
// helpers, so links, badges and the timeline stay identical to before. Any
// module whose GET /<module>/:id/related returns the shared DocumentTraceability
// shape (SO, JWSO, …) can drop this in.

import type { DocumentTraceability, RelatedSection } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { StatusBadge, Timeline, renderCode } from '@/components/shared/related-docs-panel';

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
  // Which tab is open. Null until the user clicks — the render then defaults to
  // the first non-empty bucket. Kept above the early returns so hook order is
  // stable.
  const [activeKey, setActiveKey] = useState<string | null>(null);

  if (isLoading || isError || !data) return null;

  // One tab per bucket that has rows (upstream + downstream + related, in order).
  const sections: RelatedSection[] = [...data.upstream, ...data.downstream, ...data.related].filter(
    (s) => s.count > 0,
  );
  const extras = (extraTabs ?? []).filter((t) => t.count > 0);
  const hasTimeline = data.timeline.length > 0;
  if (sections.length === 0 && extras.length === 0 && !hasTimeline) return null;

  // Honour the clicked tab; fall back to the first bucket if the stored key no
  // longer exists (e.g. that bucket emptied after a refetch). An extra tab is
  // only ever active because it was clicked — it never wins the fallback, so
  // the card still opens on the documents the page has always shown.
  const activeExtra = extras.find((t) => t.key === activeKey) ?? null;
  const active = activeExtra ? null : (sections.find((s) => s.key === activeKey) ?? sections[0] ?? null);

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-hdr">
        <div className="panel-title" style={{ color: 'var(--blue)', textTransform: 'uppercase' }}>
          Related Documents
        </div>
      </div>
      <div className="panel-body">
        {sections.length > 0 || extras.length > 0 ? (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {sections.map((s) => {
                const isActive = active?.key === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setActiveKey(s.key)}
                    style={
                      isActive
                        ? {
                            background: 'var(--purple)',
                            color: 'var(--bg2)',
                            border: '1px solid var(--purple)',
                          }
                        : {
                            background: 'var(--bg4)',
                            color: 'var(--text2)',
                            border: '1px solid var(--border)',
                          }
                    }
                  >
                    {s.icon ? `${s.icon} ` : ''}
                    {s.title}
                    <span
                      className="mono"
                      style={{
                        marginLeft: 6,
                        fontWeight: 700,
                        color: isActive ? 'var(--bg2)' : 'var(--text3)',
                      }}
                    >
                      {s.count}
                    </span>
                  </button>
                );
              })}
              {/* Module-supplied tabs sit after the /related buckets, wearing
                  the same button so the strip reads as one row of choices. */}
              {extras.map((t) => {
                const isActive = activeExtra?.key === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setActiveKey(t.key)}
                    style={
                      isActive
                        ? {
                            background: 'var(--purple)',
                            color: 'var(--bg2)',
                            border: '1px solid var(--purple)',
                          }
                        : {
                            background: 'var(--bg4)',
                            color: 'var(--text2)',
                            border: '1px solid var(--border)',
                          }
                    }
                  >
                    {t.icon ? `${t.icon} ` : ''}
                    {t.title}
                    <span
                      className="mono"
                      style={{
                        marginLeft: 6,
                        fontWeight: 700,
                        color: isActive ? 'var(--bg2)' : 'var(--text3)',
                      }}
                    >
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>
            {activeExtra ? (
              <div style={{ marginBottom: hasTimeline ? 18 : 0 }}>{activeExtra.render()}</div>
            ) : null}
            {active ? (
              <table
                className="innovic-table"
                style={{ width: '100%', marginBottom: hasTimeline ? 18 : 0 }}
              >
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name / Ref</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {active.items.map((doc) => (
                    <tr key={doc.id}>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {renderCode(doc.code, active.routeKind, doc.id, doc.linkId)}
                      </td>
                      <td className="text2" style={{ fontSize: 12 }}>
                        {doc.label ?? '—'}
                      </td>
                      <td>
                        <StatusBadge status={doc.status} />
                      </td>
                      <td className="text2" style={{ fontSize: 11 }}>
                        {doc.date ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : null}
        <Timeline events={data.timeline} />
      </div>
    </div>
  );
}
