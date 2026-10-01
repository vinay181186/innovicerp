// Tick-box selection for the Purchase Request FIT table (ADR-199). Keeps the
// one-vendor-per-PO rule the card era enforced: a tick survives paging (the Map
// records each PR's vendor), and a PR of a different vendor than the first-ticked
// one cannot be ticked. Returns the props <DataTable> needs plus the locked
// vendor + a clear action for the selection strip.

import { useCallback, useMemo, useState } from 'react';
import type { PurchaseRequestListItem } from '@innovic/shared';
import { prOrderBalance } from './pr-balance';
import { prVendorKey } from './pr-vendor-key';

/** The tick gate (unchanged): not cancelled and still has quantity to order. */
function isOrderable(pr: PurchaseRequestListItem): boolean {
  return pr.status !== 'cancelled' && prOrderBalance(pr).balance > 0;
}

interface SelectedPr {
  id: string;
  /** null = vendor still TBD: fits any vendor. */
  vendorKey: string | null;
  vendorLabel: string;
}

function toSelected(pr: PurchaseRequestListItem): SelectedPr {
  return {
    id: pr.id,
    vendorKey: prVendorKey(pr),
    vendorLabel: pr.vendorName ?? pr.vendorCodeText ?? '—',
  };
}

export interface PrSelection {
  selectedKeys: ReadonlySet<string>;
  selectedIds: string[];
  selectedCount: number;
  lockedVendor: { key: string; label: string } | null;
  isRowSelectable: (pr: PurchaseRequestListItem) => boolean;
  onToggleRow: (key: string | number, pr: PurchaseRequestListItem) => void;
  onToggleAll: (next: boolean, keys: (string | number)[]) => void;
  clear: () => void;
}

export function usePrSelection(rows: PurchaseRequestListItem[], canCreatePo: boolean): PrSelection {
  const [selected, setSelected] = useState<Map<string, SelectedPr>>(() => new Map());

  const selectedKeys = useMemo<ReadonlySet<string>>(() => new Set(selected.keys()), [selected]);
  const selectedIds = useMemo(() => [...selected.keys()], [selected]);
  const lockedVendor = useMemo(() => {
    for (const s of selected.values()) {
      if (s.vendorKey !== null) return { key: s.vendorKey, label: s.vendorLabel };
    }
    return null;
  }, [selected]);

  const onToggleRow = useCallback((key: string | number, pr: PurchaseRequestListItem): void => {
    setSelected((m) => {
      const nm = new Map(m);
      if (nm.has(String(key))) nm.delete(String(key));
      else nm.set(pr.id, toSelected(pr));
      return nm;
    });
  }, []);

  const onToggleAll = useCallback(
    (next: boolean, keys: (string | number)[]): void => {
      setSelected((m) => {
        const nm = new Map(m);
        const keySet = new Set(keys.map(String));
        if (next) {
          for (const pr of rows) if (keySet.has(pr.id)) nm.set(pr.id, toSelected(pr));
        } else {
          for (const k of keySet) nm.delete(k);
        }
        return nm;
      });
    },
    [rows],
  );

  const isRowSelectable = useCallback(
    (pr: PurchaseRequestListItem): boolean => {
      if (!canCreatePo || !isOrderable(pr)) return false;
      if (selected.has(pr.id)) return true;
      const key = prVendorKey(pr);
      // A different vendor than the one already locked cannot join this PO.
      return !(lockedVendor && key !== null && key !== lockedVendor.key);
    },
    [canCreatePo, lockedVendor, selected],
  );

  const clear = useCallback(() => setSelected(new Map()), []);

  return {
    selectedKeys,
    selectedIds,
    selectedCount: selected.size,
    lockedVendor,
    isRowSelectable,
    onToggleRow,
    onToggleAll,
    clear,
  };
}
