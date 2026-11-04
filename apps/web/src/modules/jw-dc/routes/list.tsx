// JW Delivery Challan (Store slice 3) — outward + inward registers in one route
// with a tab switcher. Mirrors legacy renderJWDC (HTML L24434).
//
// This file is the ROUTE + the tab shell only. Each register lives on the shared
// FIT DataTable in its own sibling under ../components (ADR-199, table standard
// 2026-10-01): outward-register / inward-register and their columns. The two
// create forms are their own pages (routes/outward-create, routes/inward-create).

import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { TabStrip } from '@/ui/navigation';
import { InwardView } from '../components/inward-register';
import { OutwardView } from '../components/outward-register';

type TabKey = 'outward' | 'inward';

const searchSchema = z.object({
  tab: z.enum(['outward', 'inward']).optional(),
  // Deep-link seed for Global Search: `?tab=inward&search=IN-JDI-26-0001`
  // pre-fills the active view's search box. Read ONCE by the Outward / Inward
  // views below; typing afterwards stays local.
  search: z.string().optional(),
  // `?jw=<jwsoId>` (an old link; JWSO detail now goes straight to the page):
  // forwards to New Outward DC, naming that JWSO. A malformed id is ignored.
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

  const tabBar = (
    <TabStrip
      label="JW DC direction"
      tabs={[
        { key: 'outward', label: 'Outward (to Vendor)' },
        { key: 'inward', label: 'Inward (Return from Vendor)' },
      ]}
      activeKey={tab}
      onChange={(k) => setTab(k === 'inward' ? 'inward' : 'outward')}
    />
  );

  return (
    <div>
      {tab === 'outward' ? (
        <OutwardView
          key={search.jw ?? ''}
          forJwId={search.jw}
          initialSearch={search.search}
          tabs={tabBar}
        />
      ) : (
        <InwardView initialSearch={search.search} tabs={tabBar} />
      )}
    </div>
  );
}
