import { createRoute, Link } from '@tanstack/react-router';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { rootRoute } from './__root';

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});

function IndexPage() {
  return (
    <main className="container max-w-2xl py-16">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Innovic ERP</h1>
          <p className="text-muted-foreground">
            React shell up. Auth wiring lands in T-008.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 text-card-foreground space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-green-600" />
            <span>Vite dev server</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-green-600" />
            <span>Tailwind + shadcn/ui</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-green-600" />
            <span>TanStack Router + Query</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button>Default</Button>
          <Button variant="outline" asChild>
            <Link to="/">Home</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
