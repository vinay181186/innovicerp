// Tick-box selection for "Set Return to Vendor" on the NC Register list. A tick
// survives paging (same shape as use-pr-selection): the Map keeps what the
// confirm popup lists, because a ticked NC on another page is not in `rows`.

import { useCallback, useMemo, useState } from 'react';
import type { NcRegisterListItem } from '@innovic/shared';
import { ncItemCode } from '../components/nc-list-columns';
import { ncOpenQty } from '../nc-qty';

/** May this NC take the tick? The same NCs dispose-nc-panel accepts: still NC
 *  Raised, not customer material, a vendor behind it, something open, and whole
 *  pieces on a job-card NC. A hint only: the server decides on every POST. */
export function canBulkRtv(nc: NcRegisterListItem): boolean {
  return (
    nc.status === 'pending' &&
    nc.partyGrnLineId == null &&
    nc.sourceVendorId != null &&
    ncOpenQty(nc) > 0 &&
    (nc.jobCardId == null || Number.isInteger(ncOpenQty(nc)))
  );
}

export interface NcRtvTick {
  id: string;
  code: string;
  itemCode: string;
  openQty: number;
}

function toTick(nc: NcRegisterListItem): NcRtvTick {
  return { id: nc.id, code: nc.code, itemCode: ncItemCode(nc), openQty: ncOpenQty(nc) };
}

export function useNcRtvSelection(rows: readonly NcRegisterListItem[] | undefined) {
  const [selected, setSelected] = useState<Map<string, NcRtvTick>>(() => new Map());

  const selectedKeys = useMemo<ReadonlySet<string>>(() => new Set(selected.keys()), [selected]);
  const ticks = useMemo(() => [...selected.values()], [selected]);

  const onToggleRow = useCallback(
    (_key: string | number, nc: NcRegisterListItem, next: boolean): void => {
      setSelected((m) => {
        const nm = new Map(m);
        if (next) nm.set(nc.id, toTick(nc));
        else nm.delete(nc.id);
        return nm;
      });
    },
    [],
  );

  const onToggleAll = useCallback(
    (next: boolean, keys: (string | number)[]): void => {
      setSelected((m) => {
        const nm = new Map(m);
        const keySet = new Set(keys.map(String));
        if (next) {
          for (const nc of rows ?? []) {
            if (keySet.has(nc.id) && canBulkRtv(nc)) nm.set(nc.id, toTick(nc));
          }
        } else {
          for (const k of keySet) nm.delete(k);
        }
        return nm;
      });
    },
    [rows],
  );

  // A ticked row keeps its box even after it stops qualifying (someone else
  // disposed it, so this attempt failed and it stayed ticked): without the box
  // the only way to drop that one tick would be to clear them all.
  const isRowSelectable = useCallback(
    (nc: NcRegisterListItem): boolean => selected.has(nc.id) || canBulkRtv(nc),
    [selected],
  );

  const untick = useCallback((ids: readonly string[]): void => {
    setSelected((m) => {
      const nm = new Map(m);
      for (const id of ids) nm.delete(id);
      return nm;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Map()), []);

  return { ticks, selectedKeys, isRowSelectable, onToggleRow, onToggleAll, untick, clear };
}
