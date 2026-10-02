// Sort & Filter (ADR-200) — the page scope that joins the "Sort & Filter"
// button (in ListHeader, before the search box) to the tables on the page.
//
// One scope per page (mounted around the router outlet, keyed by the path).
// Tables register here with their active-filter count; the button reads the
// total and toggles `enabled`, which shows the ▾ in every header. A list whose
// footer says it is showing only PART of the data (a server pager with more
// than one page, or a fetch cap that was hit) marks the scope `partial`:
// filtering the loaded rows there would give wrong answers, so the button is
// off until that list filters on the server.

import { useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface SfScopeSnapshot {
  enabled: boolean;
  /** Registered table ids, in mount order. */
  tables: string[];
  /** Sum of every table's active filters. */
  activeTotal: number;
  /** A ListHeader button is on the page (else the first table shows its own). */
  hasHeaderButton: boolean;
  /** A list on the page shows only part of its data — client filtering is off. */
  partial: boolean;
  /** Tables that sort / filter on the server — a partial footer does not stop them. */
  serverTables: number;
  /** Filters held by a page's server Sort & Filter state (counted even while its table is not drawn). */
  heldFilters: number;
  /** Bumped by "Clear filters" — every table resets when it changes. */
  clearToken: number;
}

export class SfScopeStore {
  private enabled = false;
  private tables = new Map<string, { active: number; server: boolean }>();
  private holders = new Map<string, number>();
  private headerButtons = new Set<string>();
  private partials = new Set<string>();
  private clearToken = 0;
  private snap: SfScopeSnapshot;
  private listeners = new Set<() => void>();

  constructor() {
    this.snap = this.build();
  }

  private build(): SfScopeSnapshot {
    let activeTotal = 0;
    let serverTables = 0;
    for (const t of this.tables.values()) {
      activeTotal += t.active;
      if (t.server) serverTables += 1;
    }
    let heldFilters = 0;
    for (const n of this.holders.values()) heldFilters += n;
    activeTotal += heldFilters;
    return {
      enabled: this.enabled,
      tables: [...this.tables.keys()],
      activeTotal,
      hasHeaderButton: this.headerButtons.size > 0,
      partial: this.partials.size > 0,
      serverTables,
      heldFilters,
      clearToken: this.clearToken,
    };
  }

  private emit(): void {
    this.snap = this.build();
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): SfScopeSnapshot => this.snap;

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.emit();
  }

  clearAll(): void {
    this.clearToken += 1;
    this.emit();
  }

  setTable(id: string, active: number, server = false): void {
    const had = this.tables.get(id);
    if (had && had.active === active && had.server === server) return;
    this.tables.set(id, { active, server });
    this.emit();
  }

  /** A page's server Sort & Filter state: its filter count, NOT a table (so it
   *  never takes the "first table" slot or a table's place in the guards). */
  setHolder(id: string, active: number): void {
    if (this.holders.get(id) === active) return;
    if (active === 0) this.holders.delete(id);
    else this.holders.set(id, active);
    this.emit();
  }

  removeTable(id: string): void {
    if (this.tables.delete(id)) this.emit();
  }

  setHeaderButton(id: string, on: boolean): void {
    const had = this.headerButtons.has(id);
    if (on === had) return;
    if (on) this.headerButtons.add(id);
    else this.headerButtons.delete(id);
    this.emit();
  }

  setPartial(id: string, on: boolean): void {
    const had = this.partials.has(id);
    if (on === had) return;
    if (on) this.partials.add(id);
    else this.partials.delete(id);
    this.emit();
  }
}

const Ctx = createContext<SfScopeStore | null>(null);

/** Mount once, around the router outlet. Opening another page switches the
 *  ▾ off again (tables register / unregister themselves as pages change). */
export function SortFilterScope({ children }: { children: ReactNode }): ReactElement {
  const store = useMemo(() => new SfScopeStore(), []);
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => store.setEnabled(false), [store, path]);
  return <SortFilterProvider store={store}>{children}</SortFilterProvider>;
}

/** The bare provider (no router) — for tests and isolated surfaces. */
export function SortFilterProvider({
  store,
  children,
}: {
  store: SfScopeStore;
  children: ReactNode;
}): ReactElement {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useSfStore(): SfScopeStore | null {
  return useContext(Ctx);
}

const NO_SCOPE: SfScopeSnapshot = {
  enabled: false,
  tables: [],
  activeTotal: 0,
  hasHeaderButton: false,
  partial: false,
  serverTables: 0,
  heldFilters: 0,
  clearToken: 0,
};
const noop = (): (() => void) => () => undefined;

export function useSfSnapshot(store: SfScopeStore | null): SfScopeSnapshot {
  return useSyncExternalStore(
    store ? store.subscribe : noop,
    store ? store.getSnapshot : () => NO_SCOPE,
  );
}

/**
 * ListFooter calls this: true when the list on screen is only part of the
 * data (more pages, or a fetch cap that was hit).
 */
export function useSfPartial(partial: boolean): void {
  const store = useSfStore();
  const id = useId();
  useEffect(() => {
    if (!store) return;
    store.setPartial(id, partial);
    return () => store.setPartial(id, false);
  }, [store, id, partial]);
}
