// New Party Material GRN — client-supplied material received against a JW order.
// Split out of routes/list.tsx (969 lines, over the 400-line rule).
//
// Styling pass 2026-08-13 against SO Master. The header fields were a raw
// `display: grid; 1fr 1fr` reimplementing `.form-grid` by hand, losing its
// ≤768px single-column collapse; they now use the class. The line editor was a
// bare `<table>` in an `overflow: hidden` box, which CLIPPED rather than
// scrolled once the columns outgrew it; it is now `.innovic-table` with
// `tableLayout: fixed` + percentage widths. Overlay z-index 100 → 200, matching
// the SO Master dialogs. No validation, payload, query or mutation behaviour
// changed — every message string is verbatim.

import type { CreatePartyGrnInput, CreatePartyGrnLineInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { usePartyMaterialsList } from '../../party-materials/api';
import { useCreatePartyGrn, useNextPartyGrnCode } from '../api';
import { LineRow, MATERIAL_DATALIST_ID, makeEmptyLine, type UiLine } from './party-grn-line-row';

export function NewPartyGrnModal({
  onClose,
  initialJwId,
}: {
  onClose: () => void;
  /** `?jw=` deep link — the modal opens with this JWSO already picked. */
  initialJwId?: string | undefined;
}): React.JSX.Element {
  const [date, setDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(initialJwId ?? null);
  const [dcNo, setDcNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<UiLine[]>([makeEmptyLine()]);
  const [err, setErr] = useState<string | null>(null);

  const nextCodeQ = useNextPartyGrnCode();
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const jwData = jwQuery.data;
  // The JW list is one row per JWSO (#6); no dedupe needed.
  const jwHeaders = jwData?.items ?? [];
  const selectedJw = useMemo(
    () => jwHeaders.find((j) => j.jwId === jwId) ?? null,
    [jwHeaders, jwId],
  );
  // Bug 3.3: once a JWSO is picked, surface ITS line item codes so the user can
  // see/pick them in the JW Line box. Lines come from the JWSO detail (the
  // master list no longer carries per-line rows).
  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwLinesForSelected = jwDetailQ.data?.lines ?? [];
  // The picked JWSO's client / PO, from the open-JWSO page when it is on it and
  // from the JWSO detail otherwise — a `?jw=` deep link may name a JWSO that
  // is not in the first page of the picker's list.
  const jwDetail = jwDetailQ.data && jwDetailQ.data.id === jwId ? jwDetailQ.data : null;
  const jwClientId = selectedJw?.clientId ?? jwDetail?.clientId ?? null;
  const jwCustomerName = selectedJw?.customerName ?? jwDetail?.customerName ?? '';
  const jwClientPoNo = selectedJw?.clientPoNo ?? jwDetail?.clientPoNo ?? '';

  // ADR-102: only the selected JWSO's client's materials. Party material is
  // customer-owned — showing every client's codes invited receiving one
  // client's material against another's order (the API refuses it now, but the
  // picker should not offer it in the first place). Disabled until a JWSO is
  // picked, so the client is always known.
  const { data: pmData } = usePartyMaterialsList(
    {
      search: undefined,
      clientId: jwClientId ?? undefined,
      limit: 200,
      offset: 0,
    },
    { enabled: Boolean(jwClientId) },
  );
  const pmAll = pmData?.items ?? [];

  const createMut = useCreatePartyGrn();

  const setLine = (idx: number, patch: Partial<UiLine>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLine = (): void => {
    setLines((prev) => [...prev, makeEmptyLine()]);
  };

  const removeLine = (idx: number): void => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  // "Add this client's materials": one line per party material of the picked
  // JWSO's client that is not on a line already, Received left blank for the
  // storekeeper to fill. A still-blank first line is replaced rather than left
  // behind. When exactly one JWSO line is for the material's part, that line
  // is pre-picked (still editable); otherwise it is left to choose.
  const addClientMaterials = (): void => {
    setLines((prev) => {
      const isBlank = (l: UiLine): boolean =>
        !l.partyMaterialId && !l.materialSearch.trim() && !l.receivedQty.trim() && !l.jwLineNoText;
      const kept = prev.filter((l) => !isBlank(l));
      const have = new Set(kept.map((l) => l.partyMaterialId).filter(Boolean));
      const added = pmAll
        .filter((p) => !have.has(p.id))
        .map((p): UiLine => {
          const forPart =
            p.itemId != null ? jwLinesForSelected.filter((j) => j.itemId === p.itemId) : [];
          const only = forPart.length === 1 ? forPart[0] : undefined;
          return {
            ...makeEmptyLine(),
            partyMaterialId: p.id,
            materialSearch: p.code,
            jwLineNoText: only ? String(only.lineNo) : '',
          };
        });
      const next = [...kept, ...added];
      return next.length > 0 ? next : prev;
    });
  };

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('JWSO No. is required.');
      return;
    }
    const validLines: CreatePartyGrnLineInput[] = [];
    for (const [i, l] of lines.entries()) {
      // Bug 3.4: a typed-but-not-clicked material left partyMaterialId null and
      // blocked save. Resolve the typed text to a material id by exact code/name
      // match (case-insensitive) before giving up.
      let pmId = l.partyMaterialId;
      if (!pmId) {
        const typed = l.materialSearch.trim().toLowerCase();
        const match = typed
          ? pmAll.find((p) => p.code.toLowerCase() === typed || p.name.toLowerCase() === typed)
          : undefined;
        if (match) pmId = match.id;
      }
      if (!pmId) {
        setErr(
          `Line ${i + 1}: pick a material from the list, or type an exact material code. Not listed? Add it in Party Material Master first.`,
        );
        return;
      }
      const q = Number(l.receivedQty);
      if (!Number.isFinite(q) || q <= 0) {
        setErr(`Line ${i + 1}: Received must be 1 or more.`);
        return;
      }
      // ADR-102: the JWSO line is mandatory — the order-qty cap and the
      // first-op material gate both key off it.
      const lnNo = l.jwLineNoText.trim();
      if (!lnNo) {
        setErr(`Line ${i + 1}: pick which JWSO line this material is for.`);
        return;
      }
      const jwLine = jwLinesForSelected.find((j) => String(j.lineNo) === lnNo);
      // ADR-102: refuse a material that is not that line's part.
      const pm = pmAll.find((p) => p.id === pmId);
      if (
        jwLine &&
        pm &&
        pm.itemId != null &&
        jwLine.itemId != null &&
        pm.itemId !== jwLine.itemId
      ) {
        setErr(
          `Line ${i + 1}: ${pm.code} is "${pm.name}", but JWSO line ${lnNo} is "${jwLine.partName}". Pick the material for this part, or pick the line this material belongs to.`,
        );
        return;
      }
      const ln: CreatePartyGrnLineInput = {
        partyMaterialId: pmId,
        receivedQty: q,
        jwLineNoText: lnNo,
      };
      if (l.remarks.trim()) ln.remarks = l.remarks.trim();
      validLines.push(ln);
    }
    if (validLines.length === 0) {
      setErr('Add at least one line.');
      return;
    }
    const input: CreatePartyGrnInput = {
      grnDate: date,
      jobWorkOrderId: jwId,
      lines: validLines,
    };
    if (dcNo.trim()) input.dcNo = dcNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) =>
        setErr(
          e instanceof Error ? e.message : 'Could not save GRN. Check the lines and try again.',
        ),
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(1100px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 12 }}>
          New Party GRN
        </div>

        {/* Native <datalist> rather than a custom absolute dropdown: a custom one
            was clipped by the modal's and the table's own overflow. */}
        <datalist id={MATERIAL_DATALIST_ID}>
          {pmAll.map((p) => (
            <option key={p.id} value={p.code}>
              {p.name}
              {p.material ? ` · ${p.material}` : ''}
            </option>
          ))}
        </datalist>

        <div className="form-grid">
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-code">
              GRN No.
            </label>
            <input
              id="pgrn-code"
              type="text"
              className="innovic-input"
              readOnly
              value={nextCodeQ.data?.code ?? ''}
              style={{ fontWeight: 700, color: 'var(--cyan)' }}
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-date">
              GRN Date
            </label>
            <input
              id="pgrn-date"
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="form-grp form-full">
            <label className="form-label" htmlFor="pgrn-jwso">
              JWSO No.<span className="req">★</span>
            </label>
            <SearchableSelect
              id="pgrn-jwso"
              value={jwId}
              onChange={setJwId}
              onSearch={setJwSearch}
              loading={jwQuery.isFetching}
              placeholder="🔍 Select JWSO — type number or customer…"
              options={jwHeaders.map((j) => ({
                id: j.jwId,
                code: j.code,
                name: j.customerName ?? '',
              }))}
              valueLabel={
                jwDetail ? `${jwDetail.code} — ${jwDetail.customerName ?? ''}` : undefined
              }
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-client">
              Customer
            </label>
            <input
              id="pgrn-client"
              type="text"
              className="innovic-input"
              readOnly
              value={jwCustomerName}
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-cpo">
              Client PO No.
            </label>
            <input
              id="pgrn-cpo"
              type="text"
              className="innovic-input"
              readOnly
              value={jwClientPoNo}
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-dc">
              Customer Challan No.
            </label>
            <input
              id="pgrn-dc"
              type="text"
              className="innovic-input"
              autoComplete="off"
              value={dcNo}
              onChange={(e) => setDcNo(e.target.value)}
              placeholder="Customer's challan no."
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-remarks">
              Remarks
            </label>
            <input
              id="pgrn-remarks"
              type="text"
              className="innovic-input"
              autoComplete="off"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        <div
          style={{
            margin: '14px 0 8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--cyan)',
                fontFamily: 'var(--mono)',
                fontWeight: 700,
              }}
            >
              Line Items
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {jwId && pmAll.length > 0 ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addClientMaterials}
                title="Add one line for every party material of this JWSO's customer (Received left blank)"
              >
                + Add this client&apos;s materials
              </button>
            ) : null}
            <button type="button" className="btn btn-primary btn-sm" onClick={addLine}>
              + Add Line
            </button>
          </div>
        </div>

        {/* `overflow: visible`, not hidden — the old box clipped the columns
            instead of letting them fit, so a wide row simply disappeared. */}
        <div style={{ overflow: 'visible', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table
            className="innovic-table"
            style={{ width: '100%', tableLayout: 'fixed', minWidth: 900 }}
          >
            <thead>
              <tr>
                <th style={{ width: '4%' }}>Ln</th>
                <th style={{ width: '20%' }}>
                  JWSO Line<span className="req">★</span>
                </th>
                <th style={{ width: '17%' }}>
                  Material<span className="req">★</span>
                </th>
                <th style={{ width: '22%' }}>Material Name</th>
                <th style={{ width: '10%', color: 'var(--green2)' }} className="th-num">
                  Received<span className="req">★</span>
                </th>
                <th style={{ width: '7%' }} className="td-ctr">
                  UOM
                </th>
                <th style={{ width: '16%' }}>Remarks</th>
                <th style={{ width: '4%' }} />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state" style={{ padding: 14 }}>
                    No line items — click <strong>+ Add Line</strong>.
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => (
                  <LineRow
                    key={i}
                    idx={i}
                    line={l}
                    pmAll={pmAll}
                    jwLines={jwLinesForSelected}
                    onChange={(patch) => setLine(i, patch)}
                    onRemove={() => removeLine(i)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 12,
              color: 'var(--red2)',
              background: 'var(--red3)',
              border: '1px solid var(--red)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={onSave}
          >
            {createMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save GRN'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
