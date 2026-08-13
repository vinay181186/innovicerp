// One inward line inside the New Party GRN modal. Split out of routes/list.tsx,
// which was 969 lines — four components and two modals in one file, well past
// the 400-line rule.
//
// The two conditional borders are kept exactly as they were: 2px amber on the
// JWSO-line select while it is empty (it is mandatory — the order-qty cap and
// the first-op material gate both key off it) and 2px green on the qty box.
// They carry state, not decoration.

import type { JobWorkOrderLine, PartyMaterialListItem } from '@innovic/shared';
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';

export interface UiLine {
  partyMaterialId: string | null;
  receivedQty: string;
  jwLineNoText: string;
  remarks: string;
  /** Local search box value for the material picker (per-line). */
  materialSearch: string;
}

export function makeEmptyLine(): UiLine {
  return { partyMaterialId: null, receivedQty: '', jwLineNoText: '', remarks: '', materialSearch: '' };
}

/** The `<datalist>` id the material input binds to. Exported so the modal that
 *  renders the list and this row that consumes it cannot drift apart. */
export const MATERIAL_DATALIST_ID = 'dlPGrnMaterial';

export function LineRow({
  idx,
  line,
  pmAll,
  jwLines,
  onChange,
  onRemove,
}: {
  idx: number;
  line: UiLine;
  pmAll: PartyMaterialListItem[];
  jwLines: JobWorkOrderLine[];
  onChange: (patch: Partial<UiLine>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const selected = useMemo(
    () => pmAll.find((p) => p.id === line.partyMaterialId) ?? null,
    [pmAll, line.partyMaterialId],
  );
  const pickedLine = useMemo(
    () => jwLines.find((j) => String(j.lineNo) === line.jwLineNoText) ?? null,
    [jwLines, line.jwLineNoText],
  );
  // ADR-102: the material must BE the picked line's part. Mirrors the API
  // guard so the user sees it while typing, not after Save.
  const mismatch =
    selected != null &&
    pickedLine != null &&
    selected.itemId != null &&
    pickedLine.itemId != null &&
    selected.itemId !== pickedLine.itemId;

  return (
    <tr>
      <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
        {idx + 1}
      </td>
      {/* ADR-102: a real <select> of THIS JWSO's lines, not free text. Every
          downstream check keys off this value; a typed line number that did not
          exist silently disabled the order-qty cap. */}
      <td>
        <select
          className="innovic-select"
          value={line.jwLineNoText}
          onChange={(e) => onChange({ jwLineNoText: e.target.value })}
          style={{
            width: '100%',
            fontSize: 11,
            padding: '4px 6px',
            ...(line.jwLineNoText ? {} : { border: '2px solid var(--amber)' }),
          }}
        >
          <option value="">{jwLines.length ? 'Select…' : 'Pick a JWSO first'}</option>
          {jwLines.map((j) => (
            <option key={j.id} value={String(j.lineNo)}>
              L{j.lineNo} · {j.itemCodeText ?? ''} · {j.partName}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="text"
          className="innovic-input"
          list={MATERIAL_DATALIST_ID}
          placeholder={pmAll.length ? '🔍 Pick material code…' : 'Pick a JWSO first'}
          disabled={pmAll.length === 0}
          value={selected ? selected.code : line.materialSearch}
          onChange={(e) => {
            const v = e.target.value;
            const match = pmAll.find((p) => p.code.toLowerCase() === v.trim().toLowerCase());
            onChange({ partyMaterialId: match ? match.id : null, materialSearch: v });
          }}
          style={{
            width: '100%',
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 6px',
            color: mismatch ? 'var(--red)' : 'var(--purple)',
          }}
        />
      </td>
      {/* ADR-102: show the material's linked item code next to its name, and
          flag a part mismatch before the user hits Save.
          The table is `tableLayout: fixed`, and `.innovic-table td` is
          `white-space: nowrap`, so a long material name would spill into the
          next column — clipped with an ellipsis and the full text on hover. */}
      <td
        style={{
          fontSize: 11,
          color: mismatch ? 'var(--red)' : 'var(--text2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={selected ? selected.name : ''}
      >
        {selected ? (
          <>
            {selected.name}
            {selected.itemCode ?? selected.itemCodeText ? (
              <span className="mono text3" style={{ fontSize: 10, marginLeft: 4 }}>
                ({selected.itemCode ?? selected.itemCodeText})
              </span>
            ) : null}
            {mismatch ? (
              <div style={{ fontSize: 10, fontWeight: 700 }}>
                ⚠ not L{line.jwLineNoText} — that line is {pickedLine?.partName}
              </div>
            ) : null}
          </>
        ) : (
          ''
        )}
      </td>
      <td>
        <input
          type="number"
          min={1}
          className="innovic-input"
          value={line.receivedQty}
          onChange={(e) => onChange({ receivedQty: e.target.value })}
          placeholder="0"
          style={{
            width: '100%',
            fontSize: 14,
            fontWeight: 700,
            textAlign: 'center',
            padding: '3px 4px',
            border: '2px solid var(--green)',
            borderRadius: 4,
          }}
        />
      </td>
      <td className="td-ctr" style={{ fontSize: 11, color: 'var(--text3)' }}>
        {selected?.uom ?? 'NOS'}
      </td>
      <td>
        <input
          type="text"
          className="innovic-input"
          placeholder="Remarks"
          value={line.remarks}
          onChange={(e) => onChange({ remarks: e.target.value })}
          style={{ width: '100%', fontSize: 11, padding: '4px 6px' }}
        />
      </td>
      <td className="td-ctr">
        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: 'transparent',
            color: 'var(--red)',
            border: '1px solid var(--red)',
            padding: '3px 6px',
          }}
          onClick={onRemove}
          title="Remove"
          aria-label={`Remove line ${idx + 1}`}
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}
