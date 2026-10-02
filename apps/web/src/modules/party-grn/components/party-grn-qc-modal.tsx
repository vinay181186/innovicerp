// Incoming QC on a Party GRN (ADR-203, owner D4) — the separate step after the
// receipt. One row per line still waiting for QC: Received (read-only),
// Accepted, Rejected and a Reject Reason. Accepted + Rejected must equal
// Received, and a reason is required when anything is rejected — the same
// refine the shared schema (partyGrnQcLineInputSchema) enforces, shown before
// Save. Only the accepted qty enters the customer-material register; rejected
// pieces are HELD until a Customer Material Return sends them back.
//
// Opened from the list's row ⋯ "Incoming QC", which is shown only to a user
// holding qc_incoming · entry. The server checks the same permission. The QC
// Call Register opens it too, for one Party GRN line (`onlyLineId`): the popup
// then lists and posts that line alone.

import type { PartyGrnListItem, PartyGrnQcInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDiscardGuard } from '../../store-inventory/components/discard-guard';
import { usePartyGrnDetail, useQcPartyGrn } from '../api';

type QcEntry = { accepted: string; rejected: string; reason: string };

/** The GRN header facts the popup shows — a list row carries them, and the
 *  QC Call Register builds the same shape off its Party GRN row. */
export type PartyGrnQcHeader = Pick<
  PartyGrnListItem,
  'id' | 'code' | 'jwCodeText' | 'clientName' | 'clientCodeText'
>;

export function PartyGrnQcModal({
  row,
  onlyLineId,
  onClose,
}: {
  row: PartyGrnQcHeader;
  /** Focus one line: only it is listed and posted. Omitted = every line
   *  still waiting for QC. */
  onlyLineId?: string | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const detailQ = usePartyGrnDetail(row.id);
  const pending = useMemo(
    () =>
      (detailQ.data?.lines ?? [])
        // Same rule as the server (isPendingQc): no QC date AND nothing booked —
        // pre-QC (0173-grandfathered) lines carry accepted = received.
        .filter((l) => l.qcAt == null && l.acceptedQty === 0 && l.rejectedQty === 0 && !l.deletedAt)
        .filter((l) => !onlyLineId || l.id === onlyLineId)
        .sort((a, b) => a.lineNo - b.lineNo),
    [detailQ.data, onlyLineId],
  );
  const [entries, setEntries] = useState<Record<string, QcEntry>>({});
  const [err, setErr] = useState<string | null>(null);
  const qcMut = useQcPartyGrn();

  // Default: everything received is accepted. Seeded once the lines arrive;
  // a line already typed into is never overwritten by a refetch.
  useEffect(() => {
    if (pending.length === 0) return;
    setEntries((prev) => {
      const next = { ...prev };
      for (const l of pending) {
        if (!next[l.id])
          next[l.id] = { accepted: String(l.receivedQty), rejected: '0', reason: '' };
      }
      return next;
    });
  }, [pending]);

  const dirty = pending.some((l) => {
    const e = entries[l.id];
    return e
      ? e.accepted !== String(l.receivedQty) || e.rejected !== '0' || e.reason !== ''
      : false;
  });
  const guard = useDiscardGuard(dirty, onClose);

  const setEntry = (id: string, patch: Partial<QcEntry>): void => {
    setEntries((prev) => {
      const cur = prev[id] ?? { accepted: '', rejected: '0', reason: '' };
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  };

  const onSave = (): void => {
    setErr(null);
    const lines: PartyGrnQcInput['lines'] = [];
    for (const l of pending) {
      const e = entries[l.id];
      const accRaw = e?.accepted.trim() ?? '';
      const rejRaw = e?.rejected.trim() ?? '';
      // A blank box is not a 0 — Number('') would quietly read it as one.
      if (accRaw === '' || rejRaw === '') {
        setErr(`Line ${l.lineNo}: Enter Accepted and Rejected (0 if none).`);
        return;
      }
      const accepted = Number(accRaw);
      const rejected = Number(rejRaw);
      if (!Number.isInteger(accepted) || !Number.isInteger(rejected)) {
        setErr(`Line ${l.lineNo}: Accepted and Rejected — whole numbers only.`);
        return;
      }
      if (
        !Number.isInteger(accepted) ||
        !Number.isInteger(rejected) ||
        accepted < 0 ||
        rejected < 0 ||
        accepted + rejected !== l.receivedQty
      ) {
        setErr(`Line ${l.lineNo}: Accepted + Rejected must equal Received (${l.receivedQty}).`);
        return;
      }
      const reason = e?.reason.trim() ?? '';
      if (rejected > 0 && !reason) {
        setErr(`Line ${l.lineNo}: give a reject reason — ${rejected} rejected.`);
        return;
      }
      lines.push({
        lineId: l.id,
        acceptedQty: accepted,
        rejectedQty: rejected,
        ...(rejected > 0 ? { rejectReason: reason } : {}),
      });
    }
    if (lines.length === 0) {
      setErr('No line is waiting for QC.');
      return;
    }
    qcMut.mutate(
      { id: row.id, lines },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not save Incoming QC. Try again.'),
      },
    );
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
          width: 'min(900px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 6 }}>
          Incoming QC — {row.code}
        </div>
        <div className="text3" style={{ fontSize: 12, marginBottom: 12 }}>
          JWSO <span className="mono fw-700">{row.jwCodeText ?? '—'}</span> ·{' '}
          {row.clientName ?? row.clientCodeText ?? '—'}. Only the accepted qty enters customer
          stock; rejected pieces are held for return to the customer.
        </div>

        {detailQ.isError ? (
          <div className="empty-state" style={{ color: 'var(--red2)', padding: 8 }}>
            Could not load lines. Try again.
          </div>
        ) : detailQ.isLoading ? (
          <div className="text3" style={{ fontSize: 12 }}>
            <Loader2 size={13} className="inline animate-spin" /> Loading lines…
          </div>
        ) : pending.length === 0 ? (
          <div className="empty-state" style={{ padding: 14 }}>
            No line is waiting for QC.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th className="th-num">Ln</th>
                  <th>Customer RM</th>
                  <th className="th-num">Received Qty</th>
                  <th className="th-num">
                    Accepted Qty<span className="req">★</span>
                  </th>
                  <th className="th-num">Rejected Qty</th>
                  <th>Reject Reason</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((l) => {
                  const e = entries[l.id];
                  const rejectedNum = Number(e?.rejected || '0');
                  return (
                    <tr key={l.id}>
                      <td className="td-num mono">{l.lineNo}</td>
                      <td title={l.partyMaterialName ?? ''}>
                        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                          {l.partyMaterialCodeText}
                        </span>
                      </td>
                      <td className="td-num mono fw-700">{l.receivedQty}</td>
                      <td className="td-num">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="innovic-input"
                          aria-label={`Accepted Qty, line ${l.lineNo}`}
                          value={e?.accepted ?? ''}
                          onChange={(ev) => {
                            // Keep the pair adding up: Rejected follows Accepted.
                            const a = ev.target.value;
                            const n = Number(a);
                            setEntry(l.id, {
                              accepted: a,
                              ...(a.trim() !== '' &&
                              Number.isInteger(n) &&
                              n >= 0 &&
                              n <= l.receivedQty
                                ? { rejected: String(l.receivedQty - n) }
                                : {}),
                            });
                          }}
                          style={{ maxWidth: '12ch' }}
                        />
                      </td>
                      <td className="td-num">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="innovic-input"
                          aria-label={`Rejected Qty, line ${l.lineNo}`}
                          value={e?.rejected ?? '0'}
                          onChange={(ev) => setEntry(l.id, { rejected: ev.target.value })}
                          style={{ maxWidth: '12ch' }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="innovic-input"
                          aria-label={`Reject Reason, line ${l.lineNo}`}
                          autoComplete="off"
                          disabled={!(rejectedNum > 0)}
                          placeholder={rejectedNum > 0 ? 'Required' : ''}
                          value={e?.reason ?? ''}
                          onChange={(ev) => setEntry(l.id, { reason: ev.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

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
            disabled={qcMut.isPending || pending.length === 0}
            onClick={onSave}
          >
            {qcMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save QC'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
