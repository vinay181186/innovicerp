// JW Delivery Challan (Store slice 3) — outward + inward registers in one route
// with a tab switcher. Mirrors legacy renderJWDC (HTML L24434).
//
// This file is the ROUTE + the tab shell only. Each register lives on the shared
// FIT DataTable in its own sibling under ../components (ADR-199, table standard
// 2026-10-01): outward-register / inward-register, their columns, and the two
// create modals.

import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { InwardView } from '../components/inward-register';
import { OutwardView } from '../components/outward-register';

type TabKey = 'outward' | 'inward';

const searchSchema = z.object({
  tab: z.enum(['outward', 'inward']).optional(),
  // Deep-link seed for Global Search: `?tab=inward&search=IN-JDI-26-0001`
  // pre-fills the active view's search box. Read ONCE by the Outward / Inward
  // views below; typing afterwards stays local.
  search: z.string().optional(),
  // `?jw=<jwsoId>` (JWSO detail → "JW DC"): opens New Outward DC straight
  // away, naming that JWSO. A malformed id is ignored.
  jw: z.string().uuid().optional().catch(undefined),
});

export const jwDcListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jw-dc',
  validateSearch: (search) => searchSchema.parse(search),
  component: JwDcPage,
});

function JwDcPage(): React.JSX.Element {
  const search = jwDcListRoute.useSearch();
  const navigate = jwDcListRoute.useNavigate();
  const tab: TabKey = search.tab ?? 'outward';

  const setTab = (next: TabKey): void => {
    // ?search is dropped on a tab switch: it was a seed for the tab the user
    // landed on, and carrying it over would filter the other tab by it.
    void navigate({ search: { tab: next === 'outward' ? undefined : next } });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        <TabButton
          active={tab === 'outward'}
          color="var(--purple)"
          onClick={() => setTab('outward')}
        >
          Outward (to Vendor)
        </TabButton>
        <TabButton active={tab === 'inward'} color="var(--green)" onClick={() => setTab('inward')}>
          Inward (Return from Vendor)
        </TabButton>
      </div>

      {tab === 'outward' ? (
        <OutwardView key={search.jw ?? ''} forJwId={search.jw} initialSearch={search.search} />
      ) : (
        <InwardView initialSearch={search.search} />
      )}
    </div>
  );
}

function TabButton({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={onClick}
      style={{
        fontWeight: 700,
        background: active ? color : 'var(--bg4)',
        color: active ? 'var(--bg2)' : 'var(--text2)',
        border: `1px solid ${active ? color : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  );
}
