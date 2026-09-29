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
import { itemCodeWithRev } from '@/lib/item-code';
import { partyMaterialFitsJwLine } from '@/modules/party-materials/fits-jw-line';

export interface UiLine {
  partyMaterialId: string | null;
  receivedQty: string;
  /** R2 (ADR-194): compulsory incoming QC — the received qty splits into
   *  accepted (enters the party store) + rejected (never becomes stock). */
  acceptedQty: string;
  rejectedQty: string;
  rejectReason: string;
  jwLineNoText: string;
  remarks: string;
  /** Local search box value for the material picker (per-line). */
  materialSearch: string;
}

export function makeEmptyLine(): UiLine {
  return {
    partyMaterialId: null,
    receivedQty: '',
    acceptedQty: '',
    rejectedQty: '',
    rejectReason: '',
    jwLineNoText: '',
    remarks: '',
    materialSearch: '',
  };
}

/** The `<datalist>` id the material input binds to. Exported so the modal that
 *  renders the list and this row that consumes it cannot drift apart. */
export const MATERIAL_DATALIST_ID = 'dlPGrnMaterial';

export function LineRow({
  idx,
  line,
  pmAll,
  jwLines,
  jwClientMaterial,
  onChange,
  onRemove,
}: {
  idx: number;
  line: UiLine;
  pmAll: PartyMaterialListItem[];
  jwLines: JobWorkOrderLine[];
  /** ADR-195: the JWSO's customer material (-rm item code), which fits any line. */
  jwClientMaterial: string | null;
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
  // ADR-102: the material must BE the picked line's part (or, ADR-195, the
  // JWSO's own customer material). Mirrors the API guard so the user sees it
  // while typing, not after Save.
  const mismatch =
    selected != null &&
    pickedLine != null &&
    !partyMaterialFitsJwLine(selected, pickedLine.itemId, jwClientMaterial);

  // R2 (ADR-194): incoming QC split. Accepted + Rejected must equal Received.
  // Typing Received seeds Accepted = Received / Rejected = 0; editing either of
  // the two keeps the pair summing to Received (mirrors the JW DC inward split).
  const received = Number(line.receivedQty) || 0;
  const rejected = Number(line.rejectedQty) || 0;
  const rejectRequired = rejected > 0 && !line.rejectReason.trim();

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
          {/* The item reads CODE/REV — the client's drawing revision typed on
              this JWSO line travels with the code on every order-traceable row
              (user rule 2026-09-23), the same way the JWSO detail shows it. */}
          {jwLines.map((j) => (
            <option key={j.id} value={String(j.lineNo)}>
              L{j.lineNo} · {j.itemCodeText ? itemCodeWithRev(j.itemCodeText, j.revision, '') : ''}{' '}
              · {j.partName}
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
            {(selected.itemCode ?? selected.itemCodeText) ? (
              <span className="mono text3" style={{ fontSize: 11, marginLeft: 4 }}>
                ({selected.itemCode ?? selected.itemCodeText})
              </span>
            ) : null}
            {mismatch ? (
              <div style={{ fontSize: 11, fontWeight: 700 }}>
                ⚠ not L{line.jwLineNoText} — that line is {pickedLine?.partName}
              </div>
            ) : null}
          </>
        ) : (
          ''
        )}
      </td>
      <td className="td-num">
        <input
          type="number"
          min={1}
          className="innovic-input"
          value={line.receivedQty}
          onChange={(e) => {
            // Seed the QC split: everything received is accepted by default,
            // nothing rejected, until the receiver says otherwise.
            const r = e.target.value;
            const rNum = Number(r) || 0;
            onChange({
              receivedQty: r,
              acceptedQty: String(rNum),
              rejectedQty: '0',
              rejectReason: '',
            });
          }}
          placeholder="0"
          style={{
            width: '100%',
            fontSize: 14,
            fontWeight: 700,
            padding: '3px 4px',
            border: '2px solid var(--green)',
            borderRadius: 4,
          }}
        />
      </td>
      {/* R2 (ADR-194): Accepted — only this qty enters the party store. */}
      <td className="td-num">
        <input
          type="number"
          min={0}
          max={received}
          className="innovic-input"
          value={line.acceptedQty}
          onChange={(e) => {
            const a = Math.min(Math.max(0, Number(e.target.value) || 0), received);
            onChange({ acceptedQty: String(a), rejectedQty: String(received - a) });
          }}
          placeholder="0"
          style={{
            width: '100%',
            fontSize: 13,
            fontWeight: 700,
            padding: '3px 4px',
            color: 'var(--green2)',
          }}
        />
      </td>
      {/* R2 (ADR-194): Rejected — recorded with a reason, never becomes stock. */}
      <td className="td-num">
        <input
          type="number"
          min={0}
          max={received}
          className="innovic-input"
          value={line.rejectedQty}
          onChange={(e) => {
            const x = Math.min(Math.max(0, Number(e.target.value) || 0), received);
            onChange({ rejectedQty: String(x), acceptedQty: String(received - x) });
          }}
          placeholder="0"
          style={{
            width: '100%',
            fontSize: 13,
            fontWeight: 700,
            padding: '3px 4px',
            color: 'var(--red2)',
          }}
        />
      </td>
      {/* Reject reason — required only when something is rejected. */}
      <td>
        <input
          type="text"
          className="innovic-input"
          placeholder={rejected > 0 ? 'Reason (required)…' : '—'}
          disabled={rejected === 0}
          value={line.rejectReason}
          onChange={(e) => onChange({ rejectReason: e.target.value })}
          style={{
            width: '100%',
            fontSize: 11,
            padding: '4px 6px',
            ...(rejectRequired ? { border: '2px solid var(--amber)' } : {}),
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
            color: 'var(--red2)',
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
