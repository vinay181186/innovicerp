// New Party Material GRN — client-supplied material received against a JW order.
//
// ADR-203 (owner D4): the receipt and the QC are TWO steps. This modal records
// only what arrived — per JWSO line, the Received Qty. The customer material
// itself is not picked: it is the line's own Customer RM (`<item>-RM`), so it
// can never mismatch the part. Accepted / Rejected are entered afterwards by
// Incoming QC (row ⋯ "Incoming QC" on the list → party-grn-qc-modal.tsx).
//
// Lines with no Customer RM yet (a JWSO saved before ADR-203) are shown greyed
// and cannot be received until the JWSO is saved again.

import type { CreatePartyGrnInput, CreatePartyGrnLineInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSaveKey } from '@/lib/use-save-key';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useDiscardGuard } from '../../store-inventory/components/discard-guard';
import { useCreatePartyGrn, useNextPartyGrnCode } from '../api';

/** What the user typed per JWSO line, keyed by the line id. */
type LineEntry = { receivedQty: string; remarks: string };

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
  const [entries, setEntries] = useState<Record<string, LineEntry>>({});
  const [err, setErr] = useState<string | null>(null);

  const nextCodeQ = useNextPartyGrnCode();
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];
  const selectedJw = useMemo(
    () => jwHeaders.find((j) => j.jwId === jwId) ?? null,
    [jwHeaders, jwId],
  );
  // The picked JWSO's lines (with their Customer RM) come from its detail. A
  // `?jw=` deep link may name a JWSO not on the picker's first page.
  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwDetail = jwDetailQ.data && jwDetailQ.data.id === jwId ? jwDetailQ.data : null;
  const jwCustomerName = selectedJw?.customerName ?? jwDetail?.customerName ?? '';
  const jwClientPoNo = selectedJw?.clientPoNo ?? jwDetail?.clientPoNo ?? '';
  // Only lines still open take material; closed / cancelled lines are left out.
  const jwLines = useMemo(
    () =>
      (jwDetail?.lines ?? [])
        .filter((l) => l.status !== 'closed' && l.status !== 'cancelled')
        .sort((a, b) => a.lineNo - b.lineNo),
    [jwDetail],
  );

  // R2 — one idempotency key per open modal, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const createMut = useCreatePartyGrn(saveKey);

  const dirty =
    jwId !== (initialJwId ?? null) ||
    Boolean(dcNo.trim() || remarks.trim()) ||
    Object.values(entries).some((e) => Boolean(e.receivedQty.trim() || e.remarks.trim()));
  const guard = useDiscardGuard(dirty, onClose);

  const onJwChange = (id: string | null): void => {
    setJwId(id);
    // The typed quantities belong to the old JWSO's lines — never carry them over.
    setEntries({});
  };

  const setEntry = (lineId: string, patch: Partial<LineEntry>): void => {
    setEntries((prev) => {
      const cur = prev[lineId] ?? { receivedQty: '', remarks: '' };
      return { ...prev, [lineId]: { ...cur, ...patch } };
    });
  };

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('JWSO No. is required.');
      return;
    }
    const validLines: CreatePartyGrnLineInput[] = [];
    for (const l of jwLines) {
      const e = entries[l.id];
      const raw = e?.receivedQty.trim() ?? '';
      if (!raw) continue; // blank = this line did not arrive on this challan
      if (!l.partyMaterialId) {
        setErr(`JWSO line ${l.lineNo}: no customer RM — save the JWSO first.`);
        return;
      }
      const q = Number(raw);
      if (!Number.isInteger(q) || q <= 0) {
        setErr(`JWSO line ${l.lineNo}: Received Qty must be a whole number, 1 or more.`);
        return;
      }
      const ln: CreatePartyGrnLineInput = { jwLineId: l.id, receivedQty: q };
      if (e?.remarks.trim()) ln.remarks = e.remarks.trim();
      validLines.push(ln);
    }
    if (validLines.length === 0) {
      setErr('Enter the Received Qty on at least one line.');
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
      onClick={(e) => {
        // Only the dim backdrop itself — not the exit question rendered inside it.
        if (e.target === e.currentTarget) guard.requestClose();
      }}
    >
      {guard.dialog}
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(1000px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 12 }}>
          New Party GRN
        </div>

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
              style={{ fontWeight: 700, color: 'var(--cyan)', maxWidth: '18ch' }}
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
              style={{ maxWidth: '18ch' }}
            />
          </div>
          <div className="form-grp form-full">
            <label className="form-label" htmlFor="pgrn-jwso">
              JWSO No.<span className="req">★</span>
            </label>
            <SearchableSelect
              id="pgrn-jwso"
              value={jwId}
              onChange={onJwChange}
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
              style={{ maxWidth: '24ch' }}
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
              style={{ maxWidth: '24ch' }}
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
            fontSize: 11,
            color: 'var(--cyan)',
            fontFamily: 'var(--mono)',
            fontWeight: 700,
          }}
        >
          Line Items
          <span className="text3" style={{ fontWeight: 400, marginLeft: 8 }}>
            Enter Received Qty for the lines on this challan — leave blank to skip. Accepted /
            Rejected are entered later by Incoming QC.
          </span>
        </div>

        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th className="th-num">Ln</th>
                <th>Item Code</th>
                <th>Customer RM</th>
                <th className="th-num">Order Qty</th>
                <th className="th-num">Accepted So Far</th>
                <th className="th-num">Received Qty</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {!jwId ? (
                <tr>
                  <td colSpan={7} className="empty-state" style={{ padding: 14 }}>
                    Pick the JWSO first.
                  </td>
                </tr>
              ) : jwDetailQ.isLoading ? (
                <tr>
                  <td colSpan={7} className="empty-state" style={{ padding: 14 }}>
                    <Loader2 size={13} className="inline animate-spin" /> Loading lines…
                  </td>
                </tr>
              ) : jwLines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state" style={{ padding: 14 }}>
                    No open lines on this JWSO.
                  </td>
                </tr>
              ) : (
                jwLines.map((l) => {
                  const noRm = !l.partyMaterialId;
                  const e = entries[l.id];
                  return (
                    <tr key={l.id} style={noRm ? { opacity: 0.55 } : undefined}>
                      <td className="td-num mono">{l.lineNo}</td>
                      <td title={l.partName}>
                        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                          {itemCodeWithRev(l.itemCodeText, l.revision)}
                        </span>
                      </td>
                      <td>
                        {noRm ? (
                          <span className="text3" style={{ fontSize: 11 }}>
                            No customer RM — save the JWSO first
                          </span>
                        ) : (
                          <span
                            className="mono fw-700"
                            style={{ color: 'var(--text)' }}
                            title={l.partyMaterialCode ?? ''}
                          >
                            {l.rmItemCode ?? l.partyMaterialCode ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="td-num mono">
                        {l.orderQty} {l.uom}
                      </td>
                      <td className="td-num mono">{l.rmAcceptedQty}</td>
                      <td className="td-num">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="innovic-input"
                          aria-label={`Received Qty, line ${l.lineNo}`}
                          disabled={noRm}
                          value={e?.receivedQty ?? ''}
                          onChange={(ev) => setEntry(l.id, { receivedQty: ev.target.value })}
                          placeholder="—"
                          style={{ maxWidth: '12ch' }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="innovic-input"
                          aria-label={`Remarks, line ${l.lineNo}`}
                          disabled={noRm}
                          autoComplete="off"
                          value={e?.remarks ?? ''}
                          onChange={(ev) => setEntry(l.id, { remarks: ev.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })
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
