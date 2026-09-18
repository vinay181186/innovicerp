// /search?q=<text>&kind=<kind> — deep-link fallback for the header search.
//
// The header box opens results in a popup over the current page
// (components/search-popup.tsx); this route keeps a shareable URL working and
// renders the same body (components/search-results.tsx) as a plain page with
// the frozen title/summary/strip band of the other lists.

import { createRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { globalSearchKindSchema } from '@innovic/shared';
import { authenticatedRoute } from '@/routes/_authenticated';
import { openSearchResult } from '../api';
import { SearchResults } from '../components/search-results';

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
  // Unscoped: openSearchResult goes to any route in the app.
  const appNavigate = useNavigate();
  const q = (search.q ?? '').trim();

  return (
    <div>
      <SearchResults
        layout="page"
        q={q}
        kind={search.kind}
        onKindChange={(next) =>
          void navigate({ search: (prev) => ({ ...prev, kind: next }), replace: true })
        }
        onOpen={(r) => {
          openSearchResult(appNavigate, r);
        }}
      />
    </div>
  );
}
