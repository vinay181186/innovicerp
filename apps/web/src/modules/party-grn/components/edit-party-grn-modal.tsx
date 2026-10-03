// Edit Party Material GRN (ADR-202 Phase 3) — the existing-receipt sibling of
// new-party-grn-modal.tsx. A receipt's JWSO and its set of lines are fixed once
// saved, so this modal changes only the header (GRN Date · Customer Challan No. ·
// Received By · Remarks) and, per line still WAITING Incoming QC, that line's
// Received Qty + line remarks. Lines already QC'd are shown read-only — their
// accepted/rejected split is settled and must not move here.
//
// Edit-approval: when the gate is on and this receipt is live, the PATCH returns
// a DocumentEditStagedResult instead of the updated detail — nothing changed, the
// edit is waiting for approval. We show a neutral "Sent for approval" notice and
// close; the row-expand then carries the amber pending chips.

import type { PartyGrnLine, PartyGrnListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { isStagedResult } from '@/modules/document-edits/api';
import { useDiscardGuard } from '../../store-inventory/components/discard-guard';
import { usePartyGrnDetail, useUpdatePartyGrn, type UpdatePartyGrnInput } from '../api';

/** What the user has typed for one editable (waiting-QC) line. */
type LineEntry = { receivedQty: string; remarks: string };

export function EditPartyGrnModal({
  row,
  onClose,
}: {
  row: PartyGrnListItem;
  onClose: () => void;
}): React.JSX.Element {
  const detailQ = usePartyGrnDetail(row.id);
  const d = detailQ.data;

  const [grnDate, setGrnDate] = useState('');
  const [dcNo, setDcNo] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [entries, setEntries] = useState<Record<string, LineEntry>>({});
  const [err, setErr] = useState<string | null>(null);
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);

  // Seed the form from the loaded detail, once.
  const seeded = useRef(false);
  useEffect(() => {
    if (!d || seeded.current) return;
    seeded.current = true;
    setGrnDate(d.grnDate);
    setDcNo(d.dcNo ?? '');
    setReceivedBy(d.receivedByText ?? '');
    setRemarks(d.remarks ?? '');
    const seed: Record<string, LineEntry> = {};
    for (const l of d.lines) {
      if (l.qcAt == null) {
        seed[l.id] = { receivedQty: String(l.receivedQty), remarks: l.remarks ?? '' };
      }
    }
    setEntries(seed);
  }, [d]);

  const lines = useMemo(
    () => (d?.lines ?? []).slice().sort((a, b) => a.lineNo - b.lineNo),
    [d],
  );
  // Only lines still waiting for Incoming QC are editable here.
  const isWaiting = (l: PartyGrnLine): boolean => l.qcAt == null;

  const saveKey = useSaveKey();
  const update = useUpdatePartyGrn(row.id, saveKey);

  const dirty = useMemo(() => {
    if (!d) return false;
    if (grnDate !== d.grnDate) return true;
    if (dcNo !== (d.dcNo ?? '')) return true;
    if (receivedBy !== (d.receivedByText ?? '')) return true;
    if (remarks !== (d.remarks ?? '')) return true;
    return lines.some((l) => {
      if (!isWaiting(l)) return false;
      const e = entries[l.id];
      if (!e) return false;
      return e.receivedQty.trim() !== String(l.receivedQty) || e.remarks !== (l.remarks ?? '');
    });
  }, [d, grnDate, dcNo, receivedBy, remarks, lines, entries]);

  const guard = useDiscardGuard(dirty, onClose);

  const setEntry = (lineId: string, patch: Partial<LineEntry>): void => {
    setEntries((prev) => {
      const cur = prev[lineId] ?? { receivedQty: '', remarks: '' };
      return { ...prev, [lineId]: { ...cur, ...patch } };
    });
  };

  const onSave = (): void => {
    setErr(null);
    if (!d) return;

    const payloadLines: UpdatePartyGrnInput['lines'] = [];
    for (const l of lines) {
      if (!isWaiting(l)) continue; // QC'd lines are read-only
      const e = entries[l.id];
      if (!e) continue;
      const raw = e.receivedQty.trim();
      const q = Number(raw);
      if (!raw || !Number.isInteger(q) || q <= 0) {
        setErr(`Line ${l.lineNo}: Received Qty must be a whole number, 1 or more.`);
        return;
      }
      payloadLines.push({ id: l.id, receivedQty: q, remarks: e.remarks.trim() });
    }

    const input: UpdatePartyGrnInput = {
      grnDate,
      dcNo: dcNo.trim() || undefined,
      receivedBy: receivedBy.trim() || undefined,
      remarks: remarks.trim() || undefined,
      lines: payloadLines,
      expectedUpdatedAt: d.updatedAt,
    };

    update.mutate(input, {
      onSuccess: (saved) => {
        if (isStagedResult(saved)) {
          // Gate on and this receipt is live: nothing changed — the edit is
          // waiting for approval. Say so, then close (the expand shows chips).
          setStagedNotice(
            'Sent for approval — your changes will apply once an approver signs off.',
          );
          window.setTimeout(() => onClose(), 1400);
          return;
        }
        onClose();
      },
      onError: (e) =>
        setErr(e instanceof Error ? e.message : 'Could not save changes. Try again.'),
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
          Edit Party GRN — {row.code}
        </div>

        {detailQ.isError ? (
          <div className="empty-state" style={{ color: 'var(--red2)', padding: 14 }}>
            Could not load this GRN. Close and try again.
          </div>
        ) : detailQ.isLoading || !d ? (
          <div className="text3" style={{ fontSize: 12, padding: 14 }}>
            <Loader2 size={13} className="inline animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="form-grid">
              <div className="form-grp">
                <label className="form-label" htmlFor="epgrn-code">
                  GRN No.
                </label>
                <input
                  id="epgrn-code"
                  type="text"
                  className="innovic-input"
                  readOnly
                  value={d.code}
                  style={{ fontWeight: 700, color: 'var(--cyan)', maxWidth: '18ch' }}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="epgrn-date">
                  GRN Date
                </label>
                <input
                  id="epgrn-date"
                  type="date"
                  className="innovic-input"
                  value={grnDate}
                  onChange={(e) => setGrnDate(e.target.value)}
                  style={{ maxWidth: '18ch' }}
                />
              </div>
              <div className="form-grp form-full">
                <label className="form-label" htmlFor="epgrn-jwso">
                  JWSO No.
                </label>
                <input
                  id="epgrn-jwso"
                  type="text"
                  className="innovic-input"
                  readOnly
                  value={d.jwCodeText ?? '—'}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="epgrn-client">
                  Customer
                </label>
                <input
                  id="epgrn-client"
                  type="text"
                  className="innovic-input"
                  readOnly
                  value={d.clientName ?? d.clientCodeText ?? ''}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="epgrn-cpo">
                  Client PO No.
                </label>
                <input
                  id="epgrn-cpo"
                  type="text"
                  className="innovic-input"
                  readOnly
                  value={d.clientPoNo ?? ''}
                  style={{ maxWidth: '24ch' }}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="epgrn-dc">
                  Customer Challan No.
                </label>
                <input
                  id="epgrn-dc"
                  type="text"
                  className="innovic-input"
                  autoComplete="off"
                  value={dcNo}
                  onChange={(e) => setDcNo(e.target.value)}
                  style={{ maxWidth: '24ch' }}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="epgrn-recvby">
                  Received By
                </label>
                <input
                  id="epgrn-recvby"
                  type="text"
                  className="innovic-input"
                  autoComplete="off"
                  value={receivedBy}
                  onChange={(e) => setReceivedBy(e.target.value)}
                  style={{ maxWidth: '24ch' }}
                />
              </div>
              <div className="form-grp form-full">
                <label className="form-label" htmlFor="epgrn-remarks">
                  Remarks
                </label>
                <input
                  id="epgrn-remarks"
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
                Only lines still waiting for Incoming QC can be changed. Lines already QC'd are
                shown read-only.
              </span>
            </div>

            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th className="th-num">Ln</th>
                    <th>JWSO Line</th>
                    <th>Customer RM</th>
                    <th className="th-num">Received Qty</th>
                    <th>Remarks</th>
                    <th>QC Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-state" style={{ padding: 14 }}>
                        No lines.
                      </td>
                    </tr>
                  ) : (
                    lines.map((l) => {
                      const waiting = isWaiting(l);
                      const e = entries[l.id];
                      return (
                        <tr key={l.id} style={waiting ? undefined : { opacity: 0.6 }}>
                          <td className="td-num mono">{l.lineNo}</td>
                          <td>
                            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                              {l.jwLineNoText ? `L${l.jwLineNoText}` : '—'}
                            </span>
                          </td>
                          <td title={l.partyMaterialName ?? ''}>
                            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                              {l.partyMaterialCodeText}
                            </span>
                          </td>
                          <td className="td-num">
                            {waiting ? (
                              <input
                                type="number"
                                min={1}
                                step={1}
                                className="innovic-input"
                                aria-label={`Received Qty, line ${l.lineNo}`}
                                value={e?.receivedQty ?? ''}
                                onChange={(ev) =>
                                  setEntry(l.id, { receivedQty: ev.target.value })
                                }
                                style={{ maxWidth: '12ch' }}
                              />
                            ) : (
                              <span className="mono">{l.receivedQty}</span>
                            )}
                          </td>
                          <td>
                            {waiting ? (
                              <input
                                type="text"
                                className="innovic-input"
                                aria-label={`Remarks, line ${l.lineNo}`}
                                autoComplete="off"
                                value={e?.remarks ?? ''}
                                onChange={(ev) => setEntry(l.id, { remarks: ev.target.value })}
                              />
                            ) : (
                              <span className="text3">{l.remarks ?? '—'}</span>
                            )}
                          </td>
                          <td>
                            {waiting ? (
                              <span className="badge b-amber">Waiting QC</span>
                            ) : (
                              <span className="badge b-green">QC done</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
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
        {stagedNotice ? (
          <div
            style={{
              marginTop: 12,
              color: 'var(--green2)',
              background: 'var(--green3)',
              border: '1px solid var(--green)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            {stagedNotice}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={() => guard.requestClose()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={update.isPending || !d || !dirty}
            onClick={onSave}
          >
            {update.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
