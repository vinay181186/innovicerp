// ui/navigation — the navigation primitives.
//
// TopNav is deliberately NOT here: the app shell is Phase 3 and
// components/shared/top-nav.tsx is load-bearing (document.body menu portals,
// capture-phase outside-click listeners, the global search, the sync dot,
// per-item access gating — audit/02 §D.8).
//
// APPEND to this barrel, never overwrite it: other groups add their own files
// to ui/ while this one is being written.

export { PageTabs } from './PageTabs';
export type { PageTab, PageTabsProps, PageTabRenderLink, PageTabRenderLinkArgs } from './PageTabs';

export { Breadcrumbs } from './Breadcrumbs';
export type { Crumb, BreadcrumbsProps } from './Breadcrumbs';

export { TabStrip } from './TabStrip';
export type { TabStripTab, TabStripProps } from './TabStrip';

export { FilterBar } from './FilterBar';
export type { FilterBarProps, FilterDef } from './FilterBar';
