import { Link, createRoute } from '@tanstack/react-router';
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Cog,
  HardHat,
  type LucideIcon,
  LogOut,
  Package,
  Truck,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOut, useSession } from '@/lib/session';
import { authenticatedRoute } from './_authenticated';

const MASTER_LINKS = [
  { to: '/op-entry', icon: Wrench, title: 'Op Entry (JC-wise)', subtitle: 'Log work against a job card' },
  { to: '/op-entry/machines', icon: Cog, title: 'Op Entry (machine-first)', subtitle: 'Pick a machine, see what runs there' },
  { to: '/op-entry/running', icon: Activity, title: 'Live operations board', subtitle: 'Sessions running right now' },
  { to: '/sales-orders', icon: ClipboardList, title: 'Sales orders', subtitle: 'Customer orders, lines, and status' },
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
    <main className="container max-w-2xl py-16">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">Innovic ERP</h1>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading session&hellip;</p>
            ) : me ? (
              <p className="text-sm text-muted-foreground">
                Signed in as{' '}
                <span className="font-medium text-foreground">{me.email}</span> ·{' '}
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

        <div className="rounded-lg border bg-card p-6 text-card-foreground space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-green-600" />
            <span>API /me round-trip working</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-green-600" />
            <span>Auth guard active (unauthenticated → /login)</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-green-600" />
            <span>Token attached to API requests</span>
          </div>
        </div>

        <nav className="grid gap-3">
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
    </main>
  );
}
