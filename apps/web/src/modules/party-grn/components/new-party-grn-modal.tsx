// New Party Material GRN — client-supplied material received against a JW order.
//
// ADR-203 (owner D4): the receipt and the QC are TWO steps. This modal records
// only what arrived — per JWSO line, the Received Qty. The customer material
// itself is not picked: it is the line's own Customer RM (`<item>-RM`), so it
// can never mismatch the part. Accepted / Rejected are entered afterwards by
// Incoming QC (row ⋯ "Incoming QC" on the list → party-grn-qc-modal.tsx).
//
// Lines with no Customer RM yet (a JWSO saved before ADR-203) are shown greyed
// and cannot be received until the JWSO is saved again. Lines with nothing
// Pending are greyed too, with the reason (Waiting QC / Fully received).
//
// Every receivable line must carry a Received Qty; a line not on this challan
// is Deleted from the list (same button as SO creation) and can be restored.

import {
  LINE_REMARKS_MAX,
  type CreatePartyGrnInput,
  type CreatePartyGrnLineInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/ui/forms';
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
  // JWSO line ids the user Deleted — not rendered, not sent.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [err, setErr] = useState<string | null>(null);

  const nextCodeQ = useNextPartyGrnCode();
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    // Only JWSOs with at least one line still to receive.
    receivable: true,
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

  // ADR-203 — the server's receipt cap per line: Pending = Order Qty −
  // (Accepted + received still Waiting QC). Rejected pieces do not count. The
  // server sends each line's Waiting QC qty (rmWaitingQcQty).
  const waitingReady = true;
  const waitingOf = (lineId: string): number =>
    jwLines.find((x) => x.id === lineId)?.rmWaitingQcQty ?? 0;
  const pendingOf = (l: { id: string; orderQty: number; rmAcceptedQty: number }): number =>
    Math.max(0, l.orderQty - l.rmAcceptedQty - waitingOf(l.id));
  // A line can take material only with a Customer RM and something Pending.
  const canReceive = (l: {
    id: string;
    orderQty: number;
    rmAcceptedQty: number;
    partyMaterialId: string | null;
  }): boolean => Boolean(l.partyMaterialId) && pendingOf(l) > 0;
  const receivableCount = jwLines.filter(canReceive).length;
  const nothingToReceive = jwDetail !== null && receivableCount === 0;
  const visibleLines = jwLines.filter((l) => !removed.has(l.id));

  // R2 — one idempotency key per open modal, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const createMut = useCreatePartyGrn(saveKey);

  const dirty =
    jwId !== (initialJwId ?? null) ||
    removed.size > 0 ||
    Boolean(dcNo.trim() || remarks.trim()) ||
    Object.values(entries).some((e) => Boolean(e.receivedQty.trim() || e.remarks.trim()));
  const guard = useDiscardGuard(dirty, onClose);

  const onJwChange = (id: string | null): void => {
    setJwId(id);
    // The typed quantities belong to the old JWSO's lines — never carry them over.
    setEntries({});
    setRemoved(new Set());
  };

  const onDeleteLine = (lineId: string): void => {
    setRemoved((prev) => new Set(prev).add(lineId));
    // A deleted line's typed qty + remarks go with it.
    setEntries((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== lineId)));
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
    if (!dcNo.trim()) {
      setErr('Customer Challan No. is required.');
      return;
    }
    const validLines: CreatePartyGrnLineInput[] = [];
    for (const l of jwLines) {
      // Greyed lines take nothing; Deleted lines were not on this challan.
      if (!canReceive(l) || removed.has(l.id)) continue;
      const e = entries[l.id];
      const raw = e?.receivedQty.trim() ?? '';
      const q = Number(raw);
      if (!raw || !Number.isInteger(q) || q <= 0) {
        setErr(`JWSO line ${l.lineNo}: enter Received Qty (1 or more), or Delete the line.`);
        return;
      }
      const pending = pendingOf(l);
      if (q > pending) {
        setErr(
          `JWSO line ${l.lineNo}: Received Qty ${q} is more than Pending ${pending} ` +
            `(Order Qty ${l.orderQty} − Accepted ${l.rmAcceptedQty} − Waiting QC ${waitingOf(l.id)}).`,
        );
        return;
      }
      const ln: CreatePartyGrnLineInput = { jwLineId: l.id, receivedQty: q };
      if (e?.remarks.trim()) ln.remarks = e.remarks.trim();
      validLines.push(ln);
    }
    if (validLines.length === 0) {
      setErr('Keep at least one line with a Received Qty.');
      return;
    }
    const input: CreatePartyGrnInput = {
      grnDate: date,
      jobWorkOrderId: jwId,
      dcNo: dcNo.trim(),
      lines: validLines,
    };
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
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-cpo">
              Client PO No.
            </label>
            {/* A second way to pick the SAME JWSO: by the customer's PO. Both
                boxes set jwId, so they can never disagree; the shared search
                already matches Client PO No. on the server. A JWSO with no
                Client PO is left out here but stays in the JWSO No. picker. */}
            <SearchableSelect
              id="pgrn-cpo"
              value={jwId}
              onChange={onJwChange}
              onSearch={setJwSearch}
              loading={jwQuery.isFetching}
              error={jwQuery.error}
              placeholder="🔍 Select Client PO No.…"
              options={jwHeaders
                .filter((j) => (j.clientPoNo ?? '').trim() !== '')
                .map((j) => ({
                  id: j.jwId,
                  code: j.clientPoNo,
                  name: `${j.code} · ${j.customerName ?? ''}`,
                }))}
              selectedLabel={(o) => o.code ?? o.name}
              valueLabel={jwClientPoNo || undefined}
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-jwso">
              JWSO No.<span className="req">★</span>
            </label>
            <SearchableSelect
              id="pgrn-jwso"
              value={jwId}
              onChange={onJwChange}
              onSearch={setJwSearch}
              loading={jwQuery.isFetching}
              error={jwQuery.error}
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
            <label className="form-label" htmlFor="pgrn-dc">
              Customer Challan No.<span className="req">★</span>
            </label>
            <input
              id="pgrn-dc"
              type="text"
              className="innovic-input"
              autoComplete="off"
              maxLength={64}
              value={dcNo}
              onChange={(e) => setDcNo(e.target.value)}
              style={{ maxWidth: '24ch' }}
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="pgrn-remarks">
              GRN Remarks
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>
            Line Items
            <span className="text3" style={{ fontWeight: 400, marginLeft: 8 }}>
              Delete the lines not on this challan. Accepted / Deviated are entered later by
              Incoming QC.
            </span>
          </span>
          {removed.size > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRemoved(new Set())}
            >
              ↺ Restore deleted lines ({removed.size})
            </button>
          ) : null}
        </div>

        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th className="th-num">Ln</th>
                <th style={{ color: 'var(--purple)' }}>POL</th>
                <th>Item Code</th>
                <th>Customer RM</th>
                <th className="th-num">Order Qty</th>
                <th className="th-num">Accepted</th>
                <th className="th-num">Waiting QC</th>
                <th className="th-num">Pending</th>
                <th className="th-num">
                  Received Qty <span className="req">★</span>
                </th>
                <th>Remarks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!jwId ? (
                <tr>
                  <td colSpan={11} className="empty-state" style={{ padding: 14 }}>
                    Select Client PO No. / JWSO No.
                  </td>
                </tr>
              ) : jwDetailQ.isLoading ? (
                <tr>
                  <td colSpan={11} className="empty-state" style={{ padding: 14 }}>
                    <Loader2 size={13} className="inline animate-spin" /> Loading lines…
                  </td>
                </tr>
              ) : jwDetailQ.isError ? (
                <tr>
                  <td
                    colSpan={11}
                    className="empty-state"
                    style={{ color: 'var(--red2)', padding: 14 }}
                  >
                    {jwDetailQ.error instanceof Error
                      ? jwDetailQ.error.message
                      : 'Could not load the JWSO lines.'}
                  </td>
                </tr>
              ) : (
                <>
                  {nothingToReceive && jwDetail ? (
                    <tr>
                      <td colSpan={11} className="empty-state" style={{ padding: 14 }}>
                        Nothing left to receive on {jwDetail.code}. All customer material is
                        received or waiting QC.
                      </td>
                    </tr>
                  ) : null}
                  {jwLines.length > 0 && visibleLines.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="empty-state" style={{ padding: 14 }}>
                        All lines deleted — use Restore deleted lines.
                      </td>
                    </tr>
                  ) : null}
                  {visibleLines.map((l) => {
                    const noRm = !l.partyMaterialId;
                    const receivable = canReceive(l);
                    const e = entries[l.id];
                    return (
                      <tr key={l.id} style={receivable ? undefined : { opacity: 0.55 }}>
                        <td className="td-num mono">{l.lineNo}</td>
                        <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                          {l.clientPoLineNo ?? '—'}
                        </td>
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
                        <td className="td-num mono">{waitingReady ? waitingOf(l.id) : '…'}</td>
                        <td className="td-num mono fw-700">{waitingReady ? pendingOf(l) : '…'}</td>
                        <td className="td-num">
                          {receivable ? (
                            <input
                              type="number"
                              min={1}
                              step={1}
                              {...(waitingReady ? { max: pendingOf(l) } : {})}
                              className="innovic-input"
                              aria-label={`Received Qty, line ${l.lineNo}`}
                              value={e?.receivedQty ?? ''}
                              onChange={(ev) => setEntry(l.id, { receivedQty: ev.target.value })}
                              placeholder="—"
                              style={{ maxWidth: '12ch' }}
                            />
                          ) : noRm ? (
                            '—'
                          ) : (
                            <span className="text3" style={{ fontSize: 11 }}>
                              {waitingOf(l.id) > 0 ? 'Waiting QC' : 'Fully received'}
                            </span>
                          )}
                        </td>
                        <td>
                          {receivable ? (
                            <input
                              type="text"
                              className="innovic-input"
                              aria-label={`Remarks, line ${l.lineNo}`}
                              autoComplete="off"
                              placeholder="Remarks"
                              maxLength={LINE_REMARKS_MAX}
                              title={e?.remarks || undefined}
                              value={e?.remarks ?? ''}
                              onChange={(ev) => setEntry(l.id, { remarks: ev.target.value })}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {receivable ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm red"
                              onClick={() => onDeleteLine(l.id)}
                              aria-label={`Remove line ${l.lineNo}`}
                            >
                              Delete
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </>
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
            disabled={createMut.isPending || nothingToReceive}
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
