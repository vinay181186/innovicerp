// renderRowMenuLink — the shared RenderLink for the row ⋯ menu (RowMenu,
// RowActions) when an item's `to` carries a query, e.g.
// `/op-entry?jobCardId=…&opId=…` or `/access-control?configure=<id>`.
//
// The router's <Link> wants the query as `search`, not glued onto `to`, so the
// string is split back into path + search. The result is still a real link:
// Ctrl/middle-click open a new tab and the target route reads its search
// params normally. Every other RenderLinkArgs field (role="menuitem",
// className, title, onClick that closes the menu) passes straight through.
//
// ui/ normally stays router-free (see layout/link-slot.tsx); this file is the
// deliberate exception — it is only used by callers that already sit under
// the router, exactly like `(p) => <Link {...p} />`.

import { Link } from '@tanstack/react-router';
import type { RenderLink } from '../layout/link-slot';

/** Split a menu `to` into the route path and its query as a plain object.
 *  No `?` (or an empty query) → `search` is undefined. */
export function splitRowMenuTo(to: string): {
  path: string;
  search: Record<string, string> | undefined;
} {
  const q = to.indexOf('?');
  if (q < 0) return { path: to, search: undefined };
  const qs = to.slice(q + 1);
  const path = to.slice(0, q);
  if (!qs) return { path, search: undefined };
  return { path, search: Object.fromEntries(new URLSearchParams(qs)) };
}

/** RenderLink for the ⋯ menu that understands `to` strings with a `?query`. */
export const renderRowMenuLink: RenderLink = ({ to, ...rest }) => {
  const { path, search } = splitRowMenuTo(to);
  if (search === undefined) return <Link {...rest} to={path} />;
  return <Link {...rest} to={path} search={search} />;
};
