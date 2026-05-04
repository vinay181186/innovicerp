import { Link, createRoute } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  ClipboardList,
  Cog,
  Factory,
  FileText,
  Inbox,
  ListOrdered,
  HardHat,
  type LucideIcon,
  LogOut,
  Package,
  Send,
  Truck,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOut, useSession } from '@/lib/session';
import { DashboardTilesGrid } from '@/modules/dashboard/components/dashboard-tiles-grid';
import { authenticatedRoute } from './_authenticated';

const MASTER_LINKS = [
  {
    to: '/op-entry',
    icon: Wrench,
    title: 'Op Entry (JC-wise)',
    subtitle: 'Log work against a job card',
  },
  {
    to: '/op-entry/machines',
    icon: Cog,
    title: 'Op Entry (machine-first)',
    subtitle: 'Pick a machine, see what runs there',
  },
  {
    to: '/op-entry/running',
    icon: Activity,
    title: 'Live operations board',
    subtitle: 'Sessions running right now',
  },
  {
    to: '/sales-orders',
    icon: ClipboardList,
    title: 'Sales orders',
    subtitle: 'Customer orders, lines, and status',
  },
  {
    to: '/job-work-orders',
    icon: Truck,
    title: 'Job-work orders',
    subtitle: 'Customer-supplied material → finished parts',
  },
  {
    to: '/job-cards',
    icon: Factory,
    title: 'Job cards',
    subtitle: 'Production batches with computed status + source link',
  },
  {
    to: '/purchase-requests',
    icon: FileText,
    title: 'Purchase requests',
    subtitle: 'Procurement intent — bridges plan / outsource to a PO',
  },
  {
    to: '/purchase-orders',
    icon: ClipboardList,
    title: 'Purchase orders',
    subtitle: 'Vendor orders with line-level receipt + QC tracking',
  },
  {
    to: '/goods-receipt-notes',
    icon: Inbox,
    title: 'Goods receipt notes',
    subtitle: 'Material received against POs · QC accept writes stock-in',
  },
  {
    to: '/store-transactions',
    icon: ListOrdered,
    title: 'Store transactions',
    subtitle: 'Append-only stock-movement ledger · per-item on-hand from v_item_stock',
  },
  {
    to: '/nc-register',
    icon: AlertTriangle,
    title: 'NC register',
    subtitle: 'Non-conformance log — QC rejections by JC + op (disposition workflow in T-040b)',
  },
  {
    to: '/delivery-challans',
    icon: Send,
    title: 'Delivery challans',
    subtitle: 'Outbound DCs against JW POs — read-only in T-040a',
  },
  { to: '/items', icon: Package, title: 'Items master', subtitle: 'Components and assemblies' },
  { to: '/clients', icon: Building2, title: 'Clients master', subtitle: 'Customers we sell to' },
  { to: '/vendors', icon: Truck, title: 'Vendors master', subtitle: 'Suppliers we buy from' },
  { to: '/machines', icon: Cog, title: 'Machines master', subtitle: 'Shop-floor equipment' },
  { to: '/operators', icon: HardHat, title: 'Operators master', subtitle: 'Shop-floor workers' },
] as const satisfies ReadonlyArray<{
  to: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}>;

export const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: IndexPage,
});

function IndexPage() {
  const { data: me, isLoading } = useSession();

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">Innovic ERP</h1>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading session&hellip;</p>
            ) : me ? (
              <p className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{me.email}</span> ·{' '}
                <span className="font-mono text-xs">{me.role}</span>
                {me.isActive ? null : ' · inactive'}
              </p>
            ) : (
              <p className="text-sm text-destructive">No session.</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            <LogOut />
            Sign out
          </Button>
        </div>

        <DashboardTilesGrid />

        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Modules
          </h2>
          <nav className="grid gap-3 md:grid-cols-2">
            {MASTER_LINKS.map(({ to, icon: Icon, title, subtitle }) => (
              <Link
                key={to}
                to={to}
                className="group flex items-center justify-between rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{subtitle}</span>
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
}
