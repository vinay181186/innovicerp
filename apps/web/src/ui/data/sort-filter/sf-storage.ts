// Sort & Filter (ADR-200) — keeping a table's sort + filters for the browser
// tab (Refresh / Back keep them). Shared by the browser and the server mode.
// Storage is not trusted: everything read back goes through sanitizeState.

import { EMPTY_STATE, sanitizeState, type SfState } from './filter-model';

export function loadSf(key: string | null): SfState {
  if (!key) return EMPTY_STATE;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? sanitizeState(JSON.parse(raw)) : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export function saveSf(key: string | null, s: SfState): void {
  if (!key) return;
  try {
    if (s.sort === null && Object.keys(s.filters).length === 0)
      window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(s));
  } catch {
    // Storage blocked (private window) — the filters still work, just not across a refresh.
  }
}
