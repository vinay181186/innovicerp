// Sort & Filter (ADR-200) — the page header's "Clear filters (n)" link.
// A column's menu opens from its name, and a filtered table shows its own
// "Showing X of Y · Clear filters" strip, so this link appears ONLY when the
// page holds server filters while no server-filtered table is drawn (the
// server refused a kept filter and an error replaced the list) — so they can
// still be cleared. Other tables on the page do not hide it.

import type { ReactElement } from 'react';

import { useSfSnapshot, useSfStore } from './scope';
import './sort-filter.css';

export function HeldFiltersClear(): ReactElement | null {
  const store = useSfStore();
  const snap = useSfSnapshot(store);
  if (!store || snap.serverTables > 0 || snap.heldFilters === 0) return null;
  return (
    <button type="button" className="btn btn-ghost sf-held" onClick={() => store.clearAll()}>
      Clear filters ({snap.heldFilters})
    </button>
  );
}
