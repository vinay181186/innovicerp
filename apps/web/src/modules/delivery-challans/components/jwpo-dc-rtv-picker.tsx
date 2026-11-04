// Against JW PO / DC picker (ADR-211) — the candidate tick list + search for
// the "Against JW PO / DC" source on +New DC. It only FINDS return-to-vendor
// NCs; the ticked ones go to the shared return-DC form (nc-dc-form.tsx), so the
// save is still the NC endpoint (one writer for the RTV qty, one-challan-per-NC
// lock). Owner 2026-11-01: several NCs of the same SO going to the same vendor
// may be ticked for ONE DC — see lib/nc-dc-pick.ts.

import type { NcRegister } from '@innovic/shared';
import { RTV_CANDIDATE_STATE_LABELS } from '@innovic/shared';
import { useMemo } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import type { DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useEligibleRtvNcs, useRtvCandidates } from '../api';
import { type PickNc, pickFromCandidate } from '../lib/nc-dc-pick';
import { NcDcPickTable } from './nc-dc-pick-table';

const LEAD: DataTableColumn<PickNc>[] = [
  {
    id: 'poNo',
    header: 'PO No.',
    kind: 'code',
    className: 'mono fw-700',
    render: (r) => r.poCode ?? '—',
    filterValue: (r) => r.poCode,
  },
  {
    id: 'sentOnDcNo',
    header: 'Sent on DC No.',
    kind: 'code',
    className: 'mono fw-700',
    render: (r) => r.sourceDcCode ?? '—',
    filterValue: (r) => r.sourceDcCode,
  },
];
const TAIL: DataTableColumn<PickNc>[] = [
  {
    id: 'returnChallanStatus',
    header: 'Return Challan Status',
    kind: 'badge',
    render: (r) => (r.ready ? RTV_CANDIDATE_STATE_LABELS.ready : (r.notReadyReason ?? '—')),
  },
];

// The whole candidate set loads in one fetch (capped server-side) and scrolls;
// the search filters it client-side with the shared matchesSearchTerm across
// every column shown. Ready rows can be ticked; rows still waiting for QC's
// decision show greyed with a disabled tick.
export function JwpoDcPickerBody({
  search,
  onSearchChange,
  ticked,
  onTickedChange,
  onNext,
}: {
  search: string;
  onSearchChange: (s: string) => void;
  ticked: string[];
  onTickedChange: (ids: string[]) => void;
  onNext: (picked: PickNc[]) => void;
}): React.JSX.Element {
  const cand = useRtvCandidates();
  // The candidate carries no SO; the same NC's eligible row does (same cache
  // as the Against NC picker).
  const eligible = useEligibleRtvNcs();

  const allRows = useMemo(() => {
    const ncById = new Map<string, NcRegister>((eligible.data?.items ?? []).map((n) => [n.id, n]));
    return (cand.data?.items ?? []).map((c) => pickFromCandidate(c, ncById.get(c.ncId)));
  }, [cand.data, eligible.data]);

  const rows = useMemo(() => {
    if (search.trim() === '') return allRows;
    return allRows.filter((r) =>
      matchesSearchTerm(
        [
          r.poCode,
          r.sourceDcCode,
          r.ncCode,
          r.soLabel,
          r.clientPoLineNo,
          r.itemCodeLabel,
          r.itemName,
          r.vendorCode,
          r.vendorName,
        ],
        search,
      ),
    );
  }, [allRows, search]);

  const loading = cand.isLoading || eligible.isLoading;

  return (
    <>
      <div className="form-grp" style={{ maxWidth: 420, marginBottom: 'var(--sp-3)' }}>
        <label className="form-label" htmlFor="dc-jwpo-search">
          PO No. / Sent on DC No.
        </label>
        <input
          id="dc-jwpo-search"
          className="innovic-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Type the JW PO No., DC No., NC No., SO No. or item…"
        />
      </div>
      <NcDcPickTable
        tableKey={TABLE_KEYS.dcRtvJwpoPick}
        rows={rows}
        allRows={allRows}
        ticked={ticked}
        onTickedChange={onTickedChange}
        onNext={onNext}
        extra={{ lead: LEAD, tail: TAIL }}
        showPoColumn={false}
        loading={loading}
        error={cand.isError}
        emptyText="Nothing is waiting to go back to a vendor for this search."
      />
    </>
  );
}
