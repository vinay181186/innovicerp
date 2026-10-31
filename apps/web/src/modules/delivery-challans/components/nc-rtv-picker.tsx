// Against NC picker on +New DC — the NCs ready for a return-to-vendor challan
// (disposition return_to_vendor, status disposed, no challan yet:
// useEligibleRtvNcs, the pendingRtvChallan predicate). Owner 2026-11-01: tick
// several NCs of the SAME SO going to the SAME vendor and make ONE DC for them
// (rule: lib/nc-dc-pick.ts). The whole eligible set loads in one fetch and
// scrolls; the search box filters it client-side across every visible column
// via the shared matchesSearchTerm helper (universal-search standard).

import { useEffect, useMemo, useRef } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useEligibleRtvNcs } from '../api';
import { type PickNc, pickFromNc, pretickable } from '../lib/nc-dc-pick';
import { NcDcPickTable } from './nc-dc-pick-table';

export function NcPickerBody({
  search,
  onSearchChange,
  ticked,
  onTickedChange,
  onNext,
  initialTicks,
}: {
  search: string;
  onSearchChange: (s: string) => void;
  ticked: string[];
  onTickedChange: (ids: string[]) => void;
  onNext: (picked: PickNc[]) => void;
  /** ADR-219 — the NCs the Against PO warning handed over: pre-ticked once
   *  loaded, but only when ALL of them fit one DC (same SO, same vendor). */
  initialTicks?: string[] | undefined;
}): React.JSX.Element {
  const { data, isLoading, isError } = useEligibleRtvNcs();
  const allRows = useMemo(() => (data?.items ?? []).map(pickFromNc), [data]);

  const rows = useMemo(() => {
    if (search.trim() === '') return allRows;
    return allRows.filter((r) =>
      matchesSearchTerm(
        [
          r.ncCode,
          r.soLabel,
          r.clientPoLineNo,
          r.itemCodeLabel,
          r.itemName,
          r.qtyToReturn,
          r.poCode,
          r.vendorCode,
          r.vendorName,
        ],
        search,
      ),
    );
  }, [allRows, search]);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || isLoading || !initialTicks?.length) return;
    seeded.current = true;
    const ids = pretickable(initialTicks, allRows);
    if (ids.length > 0) onTickedChange(ids);
  }, [isLoading, initialTicks, allRows, onTickedChange]);

  return (
    <>
      <div className="form-grp" style={{ maxWidth: 420, marginBottom: 12 }}>
        <label className="form-label" htmlFor="dc-nc-search">
          Search this list
        </label>
        <input
          id="dc-nc-search"
          className="innovic-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="NC no, SO no, item code, item name, JW PO, vendor…"
        />
      </div>
      <NcDcPickTable
        tableKey={TABLE_KEYS.dcRtvNcPick}
        rows={rows}
        allRows={allRows}
        ticked={ticked}
        onTickedChange={onTickedChange}
        onNext={onNext}
        showPoColumn
        loading={isLoading}
        error={isError}
        emptyText={`No NC is awaiting a return-to-vendor challan${
          search.trim() ? ' for this search' : ''
        }. Dispose an NC as “Return to Vendor” first.`}
      />
    </>
  );
}
