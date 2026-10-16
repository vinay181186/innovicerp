// ADR-234 — a next-step link that checks the page it OPENS, not the page it
// sits on. "Create PRO →" on a Plan, "Create GRN" on a PO, "Create Invoice" on
// a Dispatch: each used to check its own page's tick (or none), so a user saw
// the button and then landed on "You do not have permission". Wrap such a link
// in <ActionLink> (or ask useCanOpen) and it shows only when the destination's
// rule in PAGE_ACCESS (packages/shared/src/lib/page-access.ts) is met.

import { canOpenPage, canWriteAnything } from '@innovic/shared';
import { Link, type LinkProps } from '@tanstack/react-router';
import { useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';

/** Super Admin = role admin (seed admin) or the L6 Full Access flag. */
export function useIsSuperAdmin(): boolean {
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  return me?.role === 'admin' || !!eff?.fullAccess;
}

/** May this person open `href`? False while access is still loading, so a
 *  button never flashes on and then off. */
export function useCanOpen(): (href: string) => boolean {
  const { data: eff } = useMyAccess();
  const isSuperAdmin = useIsSuperAdmin();
  return (href: string) => (eff || isSuperAdmin ? canOpenPage(eff, isSuperAdmin, href) : false);
}

/** May this person save anything at all (not an Auditor, not unconfigured)?
 *  For personal writes with no page tick: own tasks, own saved reports. */
export function useCanWrite(): boolean {
  const { data: eff } = useMyAccess();
  const isSuperAdmin = useIsSuperAdmin();
  return isSuperAdmin || canWriteAnything(eff);
}

type ActionLinkProps = LinkProps & {
  /** The URL to check, when `to` is a pattern with params, e.g.
   *  to="/production-orders/new" needs no check; to="/plans/$id/edit" with
   *  params → pass check="/plans/x/edit" or rely on the pattern itself. */
  check?: string;
  className?: string;
  title?: string;
  children?: React.ReactNode;
};

/** A router <Link> that renders nothing when the user cannot open its page. */
export function ActionLink({ check, ...props }: ActionLinkProps): React.JSX.Element | null {
  const canOpen = useCanOpen();
  const target = check ?? String(props.to ?? '');
  if (!canOpen(target)) return null;
  return <Link {...(props as LinkProps)} />;
}

/** A stored path may carry a query ('/nc-register?tab=capa&capa=CAPA-3'). The
 *  router wants the query as a `search` object, not inside `to`. */
export function hrefLink(href: string): { to: string; search?: Record<string, string> } {
  const q = href.indexOf('?');
  if (q < 0) return { to: href };
  return {
    to: href.slice(0, q),
    search: Object.fromEntries(new URLSearchParams(href.slice(q + 1))),
  };
}
