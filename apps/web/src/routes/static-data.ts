// Per-route flags the app shell reads through TanStack Router's `staticData`.
//
//   ownCrumbs — the page prints its own breadcrumb trail, so the shell's
//               generic "Home › Section › Screen" line (components/shared/
//               breadcrumbs.tsx) is left out. Set on the Reports pages
//               (modules/reports/routes/list.tsx and run.tsx).
//
// Module augmentation: TanStack types `staticData` through this interface.
import '@tanstack/react-router';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    ownCrumbs?: boolean;
  }
}

export {};
