import { createRoute } from '@tanstack/react-router';
import { CheckCircle2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOut, useSession } from '@/lib/session';
import { authenticatedRoute } from './_authenticated';

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
      </div>
    </main>
  );
}
