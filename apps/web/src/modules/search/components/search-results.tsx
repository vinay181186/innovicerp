// Search results body — summary line + count strip + the 7-column table, with
// every state (short term / Searching… / error / no results / truncated).
//
// Used by the header search popup (search-popup.tsx, layout 'popup': a flex
// column so the table is the one scroller, see `.gs-overlay` CSS) and, for
// deep links, by the /search route (routes/results.tsx, layout 'page': the
// title + summary + strip sit in a frozen band, PR-list pattern, and the
// table scrolls under it). The API (`GET /global-search`, contract in
// @innovic/shared schemas/global-search.ts) already limits rows and counts to
// what the caller may view, so no permission check is repeated — a hidden
// kind simply never appears.

import { useMemo } from 'react';
import {
  GLOBAL_SEARCH_KINDS,
  GLOBAL_SEARCH_KIND_META,
  GLOBAL_SEARCH_MIN_CHARS,
} from '@innovic/shared';
import type { GlobalSearchKind, GlobalSearchResult } from '@innovic/shared';
import { StatStrip, type StatStripItem } from '@/components/shared/stat-strip';
import { useGlobalSearch } from '../api';
import { RESULT_COLUMNS, ResultsTable } from './results-table';

export function SearchResults({
  layout,
  q,
  kind,
  onKindChange,
  onOpen,
}: {
  layout: 'page' | 'popup';
  /** Trimmed search term. */
  q: string;
  kind: GlobalSearchKind | undefined;
  onKindChange: (next: GlobalSearchKind | undefined) => void;
  onOpen: (r: GlobalSearchResult) => void;
}): React.JSX.Element {
  const hasQuery = q.length >= GLOBAL_SEARCH_MIN_CHARS;

  // Two queries, one key when no kind is picked (react-query dedupes them):
  // the count strip always reflects ALL kinds for this term, so picking one
  // kind never collapses the strip to that kind alone; the rows come from the
  // kind-filtered fetch.
  const all = useGlobalSearch({ q });
  const filtered = useGlobalSearch({ q, kind });
  const rows = kind ? filtered : all;

  // keepPreviousData keeps the LAST term's rows in `data` while the new fetch
  // runs. Those must never show under the new term, so placeholder data counts
  // as "still searching".
  const searching = hasQuery && (!rows.data || rows.isPlaceholderData);
  const countsReady = hasQuery && !!all.data && !all.isPlaceholderData;
  const counts = countsReady && all.data ? all.data.counts : undefined;

  const total = useMemo(
    () => (counts ? Object.values(counts).reduce((s, n) => s + (n ?? 0), 0) : 0),
    [counts],
  );

  // Only kinds present in `counts` with a count > 0 — a hidden kind is absent
  // from the response and must never be listed; an empty one is noise.
  const stripItems: StatStripItem[] = [];
  if (counts) {
    stripItems.push({
      key: 'all',
      label: 'All',
      count: total,
      color: 'var(--cyan)',
      active: kind === undefined,
      onClick: () => onKindChange(undefined),
      title: 'Show every type',
    });
    for (const k of GLOBAL_SEARCH_KINDS) {
      const n = counts[k];
      if (n === undefined || n <= 0) continue;
      stripItems.push({
        key: k,
        label: GLOBAL_SEARCH_KIND_META[k].label,
        count: n,
        active: kind === k,
        onClick: () => onKindChange(kind === k ? undefined : k),
      });
    }
  }

  // Never render a kind this build does not know — the API deploys separately
  // and a newer one could add a kind before the web learns its label/route.
  // Only the rows are dropped; the counts / "N matches" line stay the API's.
  const items = useMemo(
    () =>
      !searching && rows.data
        ? rows.data.items.filter((r) => r.kind in GLOBAL_SEARCH_KIND_META)
        : [],
    [searching, rows.data],
  );

  // ── Table body states ────────────────────────────────────────────────────
  let body: React.ReactNode | undefined;
  if (rows.isError) {
    body = (
      <tr>
        <td colSpan={RESULT_COLUMNS} style={{ color: 'var(--red2)', whiteSpace: 'normal' }}>
          {rows.error.message}
        </td>
      </tr>
    );
  } else if (searching) {
    body = (
      <tr>
        <td colSpan={RESULT_COLUMNS} className="text3">
          Searching…
        </td>
      </tr>
    );
  } else if (items.length === 0) {
    body = (
      <tr>
        <td colSpan={RESULT_COLUMNS} className="text3" style={{ whiteSpace: 'normal' }}>
          No results for &ldquo;{q}&rdquo;
          {kind ? <> in {GLOBAL_SEARCH_KIND_META[kind].label}</> : null}
        </td>
      </tr>
    );
  }

  const truncated = !searching && rows.data?.truncated === true;

  const summary = (
    <div className="text3" style={{ fontSize: 12 }}>
      {!hasQuery ? null : !countsReady ? (
        <>Searching for &ldquo;{q}&rdquo;…</>
      ) : (
        <>
          Results for &ldquo;<span className="text2">{q}</span>&rdquo; — {total}{' '}
          {total === 1 ? 'match' : 'matches'}
          {kind ? (
            <>
              {' '}
              · <span className="text2">{GLOBAL_SEARCH_KIND_META[kind].label}</span> only
            </>
          ) : null}
        </>
      )}
    </div>
  );
  const strip = stripItems.length > 0 ? <StatStrip items={stripItems} /> : null;

  const table = !hasQuery ? (
    <div className="empty-state">
      Type at least {GLOBAL_SEARCH_MIN_CHARS} characters in the search box above (Ctrl+K)
    </div>
  ) : (
    <ResultsTable items={items} body={body} onOpen={onOpen} />
  );
  const note = truncated ? (
    <div className="text3" style={{ fontSize: 12, marginTop: 8 }}>
      Showing the first {items.length} — narrow it down or pick a type above.
    </div>
  ) : null;

  if (layout === 'page') {
    return (
      <div>
        {/* Frozen header band — same shape as the Purchase Requests list: title +
            summary + the count strip stay pinned; the rows scroll under them.
            `#content` is the scroll container, so the background must be the
            opaque `--bg` or rows show through. */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            background: 'var(--bg)',
            paddingBottom: 8,
            marginBottom: 10,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ marginBottom: strip ? 10 : 0 }}>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              Search
            </div>
            <div style={{ marginTop: 2 }}>{summary}</div>
          </div>
          {strip}
        </div>
        {table}
        {note}
      </div>
    );
  }

  // Popup: `.gs-overlay .gs-results-body` makes this a flex column; the summary
  // and strip keep their height, the table takes the rest and scrolls.
  return (
    <div className="gs-results-body">
      <div style={{ flex: '0 0 auto', marginBottom: 10 }}>{summary}</div>
      {strip ? <div style={{ flex: '0 0 auto', marginBottom: 10 }}>{strip}</div> : null}
      {table}
      {note ? <div style={{ flex: '0 0 auto' }}>{note}</div> : null}
    </div>
  );
}
