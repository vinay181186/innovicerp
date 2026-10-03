// Against JW PO / DC picker (ADR-211) — the pure candidate table + search for
// the "Against JW PO / DC" source on +New DC. It only FINDS a return-to-vendor
// NC; picking one hands its id back to JwpoDcRtvSection (routes/create.tsx),
// which opens the existing Against-NC form, so the save is still useCreateNcDc
// (one writer for the RTV qty, one-challan-per-NC lock).

import { RTV_CANDIDATE_STATE_LABELS } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { itemCodeWithRev } from '@/lib/item-code';
import { useRtvCandidates } from '../api';

// The whole candidate set loads in one fetch (capped server-side) and scrolls;
// the search filters it client-side with the shared matchesSearchTerm across PO
// No., Sent on DC No., NC No. and the item code. Ready rows can be selected;
// rows still waiting for QC's decision show greyed with no button.
export function JwpoDcPickerBody({
  search,
  onSearchChange,
  onSelect,
}: {
  search: string;
  onSearchChange: (s: string) => void;
  onSelect: (ncId: string) => void;
}): React.JSX.Element {
  const { data, isLoading, isError } = useRtvCandidates();

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    if (search.trim() === '') return items;
    return items.filter((c) =>
      matchesSearchTerm(
        [c.poCode, c.sourceDeliveryChallanCode, c.ncCode, c.itemCode, c.itemCodeText],
        search,
      ),
    );
  }, [data, search]);

  return (
    <>
      <div className="form-grp" style={{ maxWidth: 420, marginBottom: 12 }}>
        <label className="form-label" htmlFor="dc-jwpo-search">
          PO No. / Sent on DC No.
        </label>
        <input
          id="dc-jwpo-search"
          className="innovic-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Type the JW PO No. or DC No.…"
        />
      </div>

      {isLoading ? (
        <div className="empty-state">
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NCs…
        </div>
      ) : isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          Could not load NCs. Try again.
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ color: 'var(--amber2)' }}>
          Nothing is waiting to go back to a vendor for this search.
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="innovic-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>PO No.</th>
                <th>Sent on DC No.</th>
                <th>NC No.</th>
                {/* POL = the CUSTOMER's own PO line number. */}
                <th style={{ color: 'var(--purple)' }}>POL</th>
                <th>Item Code · Name</th>
                <th className="th-num">Qty to Return</th>
                <th>Return Challan Status</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const ready = c.state === 'ready';
                // Greyed while QC has not decided — shown so the store knows the
                // pieces exist, never selectable.
                const codeColor = ready ? 'var(--blue)' : 'var(--text2)';
                return (
                  <tr key={c.ncId} style={ready ? undefined : { color: 'var(--text2)' }}>
                    <td className="mono fw-700" style={{ color: codeColor }}>
                      {c.poCode ?? '—'}
                    </td>
                    <td className="mono fw-700" style={{ color: codeColor }}>
                      {c.sourceDeliveryChallanCode ?? '—'}
                    </td>
                    <td className="mono fw-700" style={{ color: codeColor }}>
                      {c.ncCode}
                    </td>
                    <td
                      className="mono fw-700"
                      style={{ color: ready ? 'var(--purple)' : 'var(--text2)' }}
                    >
                      {c.clientPoLineNo ?? '—'}
                    </td>
                    <td>
                      <b className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {itemCodeWithRev(c.itemCode ?? c.itemCodeText, c.itemRevision)}
                      </b>
                      <div className="text2" style={{ fontSize: 11 }}>
                        {c.itemName ?? c.itemNameText ?? '—'}
                      </div>
                    </td>
                    <td
                      className="mono td-num"
                      style={{ color: ready ? 'var(--red2)' : 'var(--text2)' }}
                    >
                      {Number(c.rejectedQty)}
                    </td>
                    <td>{RTV_CANDIDATE_STATE_LABELS[c.state]}</td>
                    <td>
                      {ready ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => onSelect(c.ncId)}
                        >
                          Select
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
