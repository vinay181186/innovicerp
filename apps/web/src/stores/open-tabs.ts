// Open-pages tab bar state (ERP-style). Tracks the routes the user has visited
// as browser-like tabs, persisted to localStorage so the set survives a reload.
// This is the app's first Zustand store; `persist` mirrors how the topbar/
// breadcrumb chrome is meant to feel continuous across sessions.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface OpenTab {
  /** Nav base route (e.g. "/job-work-orders") — the dedupe key and how the
   *  active tab is matched against the current location. One tab per section,
   *  not one per detail URL, so visiting many details never floods the bar. */
  base: string;
  /** Human label from the sidebar nav (e.g. "JWSO Master"). */
  label: string;
  /** Emoji icon from the sidebar nav. */
  icon: string;
  /** Exact last-visited path under this base — the tab's click target, so
   *  clicking a tab returns you to where you were in that section. */
  path: string;
}

interface OpenTabsState {
  tabs: OpenTab[];
  /** Record the page just visited: insert a new tab, or refresh an existing
   *  one's click target/label in place (position preserved — no reorder jitter). */
  openTab: (tab: OpenTab) => void;
  /** Remove a tab by its base route. */
  closeTab: (base: string) => void;
  /** Drop every tab. */
  clear: () => void;
}

export const useOpenTabs = create<OpenTabsState>()(
  persist(
    (set) => ({
      tabs: [],
      openTab: (tab) =>
        set((s) => {
          const i = s.tabs.findIndex((t) => t.base === tab.base);
          if (i === -1) return { tabs: [...s.tabs, tab] };
          const next = s.tabs.slice();
          next[i] = { ...next[i], ...tab };
          return { tabs: next };
        }),
      closeTab: (base) => set((s) => ({ tabs: s.tabs.filter((t) => t.base !== base) })),
      clear: () => set({ tabs: [] }),
    }),
    { name: 'innovic-open-tabs' },
  ),
);
