// Route Card Create / Edit — header shown, or folded to one line (owner-approved
// mock-up "Route Card — Collapsible Header", 2026-11-17). Kept per browser: one
// person's convenience, never business data. Its own key, so folding here never
// folds the Job Card detail page (jc-detail-sticky.ts), and the other way round.
import { useCallback, useState } from 'react';

const COLLAPSED_KEY = 'innovic.rc-form.header-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function useRcHeaderCollapsed(): [boolean, (next: boolean) => void] {
  const [collapsed, setState] = useState(readCollapsed);
  const set = useCallback((next: boolean) => {
    setState(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
  }, []);
  return [collapsed, set];
}
