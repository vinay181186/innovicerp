// Tick-box selection for the Purchase Request FIT table (ADR-199). Keeps the
// one-vendor-per-PO rule the card era enforced: a tick survives paging (the Map
// records each PR's vendor), and a PR of a different vendor than the first-ticked
// one cannot be ticked. Returns the props <DataTable> needs plus the locked
// vendor + a clear action for the selection strip.
// ADR-316: one PO also takes PRs of ONE SO only — the first ticked PR (blank-SO
// included: blank is its own group) locks the order, and a PR of another order
// cannot be ticked. The server refuses the same mix on save.

import { useCallback, useMemo, useState } from 'react';
import type { PurchaseRequestListItem } from '@innovic/shared';
import { prOrderBalance } from './pr-balance';
import { prVendorKey } from './pr-vendor-key';
import { PR_DIFFERENT_ORDER_TIP, prOrderKey, prOrderLabel } from './pr-order-key';

/** Tip on a PR that cannot join the ticked PRs because its vendor differs. */
export const PR_DIFFERENT_VENDOR_TIP = 'Different vendor — one PO takes PRs of one vendor only';

/** The tick gate (unchanged): not cancelled and still has quantity to order. */
function isOrderable(pr: PurchaseRequestListItem): boolean {
  return pr.status !== 'cancelled' && prOrderBalance(pr).balance > 0;
}

interface SelectedPr {
  id: string;
  /** null = vendor still TBD: fits any vendor. */
  vendorKey: string | null;
  vendorLabel: string;
  /** ADR-316 order group ('' = no SO). */
  orderKey: string;
  orderLabel: string;
}

function toSelected(pr: PurchaseRequestListItem): SelectedPr {
  return {
    id: pr.id,
    vendorKey: prVendorKey(pr),
    vendorLabel: pr.vendorName ?? pr.vendorCodeText ?? '—',
    orderKey: prOrderKey(pr),
    orderLabel: prOrderLabel(pr),
  };
}

export interface PrSelection {
  selectedKeys: ReadonlySet<string>;
  selectedIds: string[];
  selectedCount: number;
  lockedVendor: { key: string; label: string } | null;
  /** ADR-316: the SO every ticked PR shares (key '' = no SO), from the first tick. */
  lockedOrder: { key: string; label: string } | null;
  /** Why an orderable PR cannot be ticked (vendor first, then SO), or null. */
  blockReason: (pr: PurchaseRequestListItem) => string | null;
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
  const lockedOrder = useMemo(() => {
    for (const s of selected.values()) return { key: s.orderKey, label: s.orderLabel };
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
          const candidates = rows.filter((pr) => keySet.has(pr.id));
          // One PO = one vendor: select-all ties to the already-locked vendor, or
          // to the first real vendor among the candidates; a PR of a different
          // vendor is skipped (vendor-TBD rows fit any and are always included).
          // ADR-316: the same for the SO — tie to the locked order, or the first
          // candidate's order (blank SO is a group too); other orders are skipped.
          let lock = lockedVendor?.key ?? null;
          let orderLock: string | null = lockedOrder?.key ?? null;
          for (const pr of candidates) {
            const key = prVendorKey(pr);
            const vendorFits = key === null || lock === null || key === lock;
            const orderKey = prOrderKey(pr);
            const orderFits = orderLock === null || orderKey === orderLock;
            if (!vendorFits || !orderFits) continue;
            if (key !== null && lock === null) lock = key;
            if (orderLock === null) orderLock = orderKey;
            nm.set(pr.id, toSelected(pr));
          }
        } else {
          for (const k of keySet) nm.delete(k);
        }
        return nm;
      });
    },
    [rows, lockedVendor, lockedOrder],
  );

  const blockReason = useCallback(
    (pr: PurchaseRequestListItem): string | null => {
      if (selected.has(pr.id)) return null;
      const key = prVendorKey(pr);
      if (lockedVendor && key !== null && key !== lockedVendor.key) return PR_DIFFERENT_VENDOR_TIP;
      if (lockedOrder && prOrderKey(pr) !== lockedOrder.key) return PR_DIFFERENT_ORDER_TIP;
      return null;
    },
    [lockedVendor, lockedOrder, selected],
  );

  const isRowSelectable = useCallback(
    (pr: PurchaseRequestListItem): boolean => {
      if (!canCreatePo || !isOrderable(pr)) return false;
      if (selected.has(pr.id)) return true;
      // A different vendor or SO than the one already locked cannot join this PO.
      return blockReason(pr) === null;
    },
    [canCreatePo, selected, blockReason],
  );

  const clear = useCallback(() => setSelected(new Map()), []);

  return {
    selectedKeys,
    selectedIds,
    selectedCount: selected.size,
    lockedVendor,
    lockedOrder,
    blockReason,
    isRowSelectable,
    onToggleRow,
    onToggleAll,
    clear,
  };
}
