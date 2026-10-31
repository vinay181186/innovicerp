// Incoming QC on a Party GRN (ADR-203, owner D4) — the separate step after the
// receipt. PARTIAL (0233, owner 2026-10-31): one row per line with QC Pending
// > 0 — received 60, inspect 6 now and 54 later. Received, Inspected So Far and
// QC Pending are read-only; Accepted prefills to the QC Pending and Deviated
// follows it (owner D2). A line left at 0 / 0 is skipped (inspect it later);
// at least one line must carry a qty. Accepted + Deviated <= QC Pending, and a
// reason is required when anything is deviated — the shared refine
// (partyGrnQcLineInputSchema) plus the server's limit, shown before Save. Only
// the accepted qty enters the customer-material register; deviated pieces are
// HELD until a Customer Material Return sends them back.
//
// Opened from the list's row ⋯ "Incoming QC", which is shown only to a user
// holding qc_incoming · entry. The server checks the same permission. The QC
// Call Register opens it too, for one Party GRN line (`onlyLineId`): the popup
// then lists and posts that line alone.

import type { PartyGrnListItem, PartyGrnQcInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { useDiscardGuard } from '../../store-inventory/components/discard-guard';
import { usePartyGrnDetail, useQcPartyGrn } from '../api';
import { qcPendingQtyOf } from '../lib/qc-state';

/** `seed` = the QC Pending the row was prefilled with (dirty compares to it). */
type QcEntry = {
  accepted: string;
  rejected: string;
  reason: string;
  qcRemarks: string;
  seed: string;
};

const isPristine = (e: QcEntry): boolean =>
  e.accepted === e.seed && e.rejected === '0' && e.reason === '' && e.qcRemarks === '';

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
   *  with QC Pending > 0. */
  onlyLineId?: string | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const detailQ = usePartyGrnDetail(row.id);
  const pending = useMemo(
    () =>
      (detailQ.data?.lines ?? [])
        // Partial QC (0233): every live line with something still to inspect.
        // Pre-QC (0173-grandfathered) lines carry accepted = received → 0 pending.
        .filter((l) => qcPendingQtyOf(l) > 0 && !l.deletedAt)
        .filter((l) => !onlyLineId || l.id === onlyLineId)
        .sort((a, b) => a.lineNo - b.lineNo),
    [detailQ.data, onlyLineId],
  );
  const [entries, setEntries] = useState<Record<string, QcEntry>>({});
  const [err, setErr] = useState<string | null>(null);
  // ADR-172 — one save key for this popup; a retry after a timeout replays.
  const saveKey = useSaveKey();
  const qcMut = useQcPartyGrn(saveKey);
  // §20.1 — an instant in-flight latch: isPending only disables the button
  // after a re-render, so a fast double-click could send two requests.
  const inFlight = useRef(false);

  // Default (owner D2): the whole QC Pending is accepted. Seeded once the lines
  // arrive; a refetch that moves QC Pending re-seeds only rows nobody typed in.
  useEffect(() => {
    if (pending.length === 0) return;
    setEntries((prev) => {
      const next = { ...prev };
      for (const l of pending) {
        const seed = String(qcPendingQtyOf(l));
        const cur = next[l.id];
        if (!cur || (cur.seed !== seed && isPristine(cur)))
          next[l.id] = { accepted: seed, rejected: '0', reason: '', qcRemarks: '', seed };
      }
      return next;
    });
  }, [pending]);

  const dirty = pending.some((l) => {
    const e = entries[l.id];
    return e ? !isPristine(e) : false;
  });
  const guard = useDiscardGuard(dirty, onClose);

  const setEntry = (id: string, patch: Partial<QcEntry>): void => {
    setEntries((prev) => {
      const cur = prev[id] ?? { accepted: '', rejected: '0', reason: '', qcRemarks: '', seed: '' };
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
      // Partial QC: a line left at 0 / 0 (or cleared) is skipped — inspect
      // line 1 now and line 2 later. Only an all-skipped save is refused.
      const zeroOrBlank = (v: string): boolean => v === '' || Number(v) === 0;
      if (zeroOrBlank(accRaw) && zeroOrBlank(rejRaw)) continue;
      // A blank box is not a 0 — Number('') would quietly read it as one.
      if (accRaw === '' || rejRaw === '') {
        setErr(`Line ${l.lineNo}: Enter Accepted and Deviated (0 if none).`);
        return;
      }
      const accepted = Number(accRaw);
      const rejected = Number(rejRaw);
      if (!Number.isInteger(accepted) || !Number.isInteger(rejected)) {
        setErr(`Line ${l.lineNo}: Accepted and Deviated — whole numbers only.`);
        return;
      }
      if (accepted < 0 || rejected < 0) {
        setErr(`Line ${l.lineNo}: Accepted and Deviated cannot be negative.`);
        return;
      }
      const qcPending = qcPendingQtyOf(l);
      if (accepted + rejected > qcPending) {
        setErr(
          `Line ${l.lineNo}: Accepted + Deviated (${accepted + rejected}) cannot be more than QC Pending (${qcPending}).`,
        );
        return;
      }
      const reason = e?.reason.trim() ?? '';
      const qcRemarks = e?.qcRemarks.trim() ?? '';
      if (rejected > 0 && !reason) {
        setErr(`Line ${l.lineNo}: give a deviation reason — ${rejected} deviated.`);
        return;
      }
      lines.push({
        lineId: l.id,
        acceptedQty: accepted,
        rejectedQty: rejected,
        ...(rejected > 0 ? { rejectReason: reason } : {}),
        // QC Remarks — any line, deviated or not; sent only when typed.
        ...(qcRemarks ? { qcRemarks } : {}),
      });
    }
    if (lines.length === 0) {
      setErr(
        pending.length === 0
          ? 'No line has QC Pending.'
          : 'Enter the Accepted and/or Deviated qty.',
      );
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    qcMut.mutate(
      { id: row.id, lines },
      {
        onSettled: () => {
          inFlight.current = false;
        },
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
          width: 'min(1100px, 96vw)',
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
          stock. Deviated pieces raise an NC automatically — QC Head decides Use As Is, Return to
          Customer or Scrap in the NC Register.
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
            No line has QC Pending.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th className="th-num">Ln</th>
                  <th>Customer RM</th>
                  <th className="th-num">Received Qty</th>
                  <th className="th-num">Inspected So Far</th>
                  <th className="th-num">QC Pending</th>
                  <th className="th-num">
                    Accepted Qty<span className="req">★</span>
                  </th>
                  <th className="th-num">Deviated Qty</th>
                  <th>Deviation Reason</th>
                  <th>QC Remarks</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((l) => {
                  const e = entries[l.id];
                  const rejectedNum = Number(e?.rejected || '0');
                  const qcPending = qcPendingQtyOf(l);
                  return (
                    <tr key={l.id}>
                      <td className="td-num mono">{l.lineNo}</td>
                      <td title={l.partyMaterialName ?? ''}>
                        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                          {l.partyMaterialCodeText}
                        </span>
                      </td>
                      <td className="td-num mono fw-700">{l.receivedQty}</td>
                      <td
                        className="td-num mono"
                        title={`Accepted ${l.acceptedQty} / Deviated ${l.rejectedQty}`}
                      >
                        <span style={{ color: 'var(--green2)' }}>{l.acceptedQty}</span>
                        {' / '}
                        <span style={{ color: l.rejectedQty > 0 ? 'var(--red2)' : 'var(--text3)' }}>
                          {l.rejectedQty}
                        </span>
                      </td>
                      <td className="td-num mono fw-700">{qcPending}</td>
                      <td className="td-num">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="innovic-input"
                          aria-label={`Accepted Qty, line ${l.lineNo}`}
                          value={e?.accepted ?? ''}
                          onChange={(ev) => {
                            // Keep the pair adding up to QC Pending: Deviated follows Accepted.
                            const a = ev.target.value;
                            const n = Number(a);
                            setEntry(l.id, {
                              accepted: a,
                              ...(a.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= qcPending
                                ? { rejected: String(qcPending - n) }
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
                          aria-label={`Deviated Qty, line ${l.lineNo}`}
                          value={e?.rejected ?? '0'}
                          onChange={(ev) => setEntry(l.id, { rejected: ev.target.value })}
                          style={{ maxWidth: '12ch' }}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="innovic-input"
                          aria-label={`Deviation Reason, line ${l.lineNo}`}
                          autoComplete="off"
                          disabled={!(rejectedNum > 0)}
                          placeholder={rejectedNum > 0 ? 'Required' : ''}
                          value={e?.reason ?? ''}
                          onChange={(ev) => setEntry(l.id, { reason: ev.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="innovic-input"
                          aria-label={`QC Remarks, line ${l.lineNo}`}
                          autoComplete="off"
                          maxLength={2000}
                          placeholder="Observations…"
                          value={e?.qcRemarks ?? ''}
                          onChange={(ev) => setEntry(l.id, { qcRemarks: ev.target.value })}
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
          <button type="button" className="btn btn-ghost" onClick={guard.requestClose}>
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
