// Search page — the full-screen results for the header search box.
//
// `/search?q=<text>&kind=<kind>`. The header box (components/shared/
// global-search.tsx) writes `q`; the count strip here toggles `kind`. The API
// (`GET /global-search`, contract in @innovic/shared schemas/global-search.ts)
// already limits the rows and the counts to what the caller may view, so no
// permission check is repeated here — a hidden kind simply never appears.
//
// Layout follows the Purchase Requests list: a frozen header band (title +
// summary line + StatStrip) with the results table scrolling under it.

import { createRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';
import {
  GLOBAL_SEARCH_KINDS,
  GLOBAL_SEARCH_KIND_META,
  GLOBAL_SEARCH_MIN_CHARS,
  globalSearchKindSchema,
} from '@innovic/shared';
import type { GlobalSearchKind } from '@innovic/shared';
import { StatStrip, type StatStripItem } from '@/components/shared/stat-strip';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useGlobalSearch } from '../api';
import { RESULT_COLUMNS, ResultsTable } from '../components/results-table';

const searchSchema = z.object({
  q: z.string().optional(),
  kind: globalSearchKindSchema.optional(),
});

export const searchRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'search',
  validateSearch: searchSchema,
  component: SearchPage,
});

function SearchPage(): React.JSX.Element {
  const search = searchRoute.useSearch();
  const navigate = searchRoute.useNavigate();
  const q = (search.q ?? '').trim();
  const kind = search.kind;
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

  function setKind(next: GlobalSearchKind | undefined): void {
    void navigate({ search: (prev) => ({ ...prev, kind: next }), replace: true });
  }

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
      onClick: () => setKind(undefined),
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
        onClick: () => setKind(kind === k ? undefined : k),
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
        <td colSpan={RESULT_COLUMNS} style={{ color: 'var(--red)', whiteSpace: 'normal' }}>
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
        <div style={{ marginBottom: 10 }}>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            Search
          </div>
          <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
            {!hasQuery ? (
              <>Type at least {GLOBAL_SEARCH_MIN_CHARS} characters in the search box above</>
            ) : !countsReady ? (
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
        </div>
        {stripItems.length > 0 ? <StatStrip items={stripItems} /> : null}
      </div>

      {!hasQuery ? (
        <div className="empty-state">
          Type at least {GLOBAL_SEARCH_MIN_CHARS} characters in the search box above (Ctrl+K)
        </div>
      ) : (
        <>
          <ResultsTable items={items} body={body} />
          {truncated ? (
            <div className="text3" style={{ fontSize: 12, marginTop: 8 }}>
              Showing the first {items.length} — narrow it down or pick a type above.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
