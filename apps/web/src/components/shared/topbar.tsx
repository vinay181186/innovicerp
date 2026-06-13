// Innovic ERP top bar — port of the legacy HTML's #topbar.
// 54px fixed height, white surface, page title on the left,
// sync indicator + sign-out on the right.
//
// Page title is derived from the current pathname via a static map.
// Routes not in the map fall back to a humanized version of the
// pathname (e.g. /sales-orders/abc → "Sales Order").

import { useLocation } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { INNOVIC_LOGO_DATA_URI } from '@/lib/print/letterhead-logo';
import { signOut } from '@/lib/session';

const TITLE_MAP: Record<string, string> = {
  '/': 'Dashboard',
  '/job-cards': 'Job Cards',
  '/sales-orders': 'Sales Orders',
  '/job-work-orders': 'Job-Work Orders',
  '/delivery-challans': 'Delivery Challans',
  '/clients': 'Client Master',
  '/goods-receipt-notes': 'Goods Receipt Notes',
  '/items': 'Item Master',
  '/store-transactions': 'Stock Ledger',
  '/op-entry': 'Op Entry',
  '/machines': 'Machine Master',
  '/operators': 'Operator Master',
  '/qc-dashboard': 'QC Dashboard',
  '/nc-register': 'NC Register',
  '/purchase-requests': 'Purchase Requests',
  '/purchase-orders': 'Purchase Orders',
  '/vendors': 'Vendor Master',
  '/alerts': 'Alerts',
  '/activity-log': 'Activity Log',
  '/reports': 'Reports',
  '/saved-reports': 'Saved Reports',
  '/bom-masters': 'BOM Master',
  '/route-cards': 'Route Card Master',
};

function deriveTitle(pathname: string): string {
  // Exact match first.
  if (TITLE_MAP[pathname]) return TITLE_MAP[pathname];
  // Longest-prefix match (e.g. /sales-orders/abc → "Sales Orders").
  const segments = pathname.split('/').filter(Boolean);
  for (let i = segments.length; i > 0; i--) {
    const prefix = '/' + segments.slice(0, i).join('/');
    if (TITLE_MAP[prefix]) return TITLE_MAP[prefix];
  }
  // Fallback — humanize the first segment.
  const first = segments[0] ?? 'page';
  return first.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TopBar(): React.JSX.Element {
  const { pathname } = useLocation();
  const title = deriveTitle(pathname);

  return (
    <div id="topbar">
      <img
        src={INNOVIC_LOGO_DATA_URI}
        alt="Innovic"
        style={{ height: 30, width: 'auto', flexShrink: 0 }}
      />
      <div className="tb-title" id="pageTitle">
        {title}
      </div>
      <div className="tb-sync" title="Connection status">
        <span className="sync-dot" />
        SYNCED
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => void signOut()}
        title="Sign out"
      >
        <LogOut size={14} />
        <span>Sign out</span>
      </button>
    </div>
  );
}
