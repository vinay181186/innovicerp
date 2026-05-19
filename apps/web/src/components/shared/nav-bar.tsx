// Global app nav bar — ISSUE-006. Rendered above every authenticated page
// via the _authenticated route's component wrapper. Provides:
//   - Home link → /
//   - Current user email + role chip
//   - Sign out button
//
// Deliberately minimal — no hamburger / mega-menu / search. The /
// landing page already exposes all module links as a grid; this bar
// just gets users BACK to that grid from anywhere in the app.

import { Link, useLocation } from '@tanstack/react-router';
import { Home, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOut, useSession } from '@/lib/session';

export function NavBar(): React.JSX.Element {
  const { data: me } = useSession();
  const { pathname } = useLocation();
  const onHome = pathname === '/' || pathname === '';

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex h-12 max-w-7xl items-center justify-between gap-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight transition-colors hover:text-foreground/80"
          aria-current={onHome ? 'page' : undefined}
        >
          <Home className="h-4 w-4" />
          <span>Innovic ERP</span>
        </Link>

        <div className="flex items-center gap-3">
          {me ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {me.email}
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {me.role}
              </span>
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void signOut()}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
