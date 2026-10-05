// One instrument (ADR-193 phase 4a): header facts, calibration history and the
// actions its Instrument Status allows — In Store: Send for Calibration /
// Record Calibration / Scrap; At Calibration: Record Calibration; any live
// piece: Edit. A pending write-off hides Send and Scrap (the server refuses both).
import { INSTRUMENT_STATUS_LABELS } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import { useInstrument } from '../api';
import { DUE_COLOUR, INSTRUMENT_STATUS_BADGE, dueTone } from '../lib/instrument-ui';
import { type InstrumentAction, InstrumentActionForm } from './instrument-action-forms';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span>
      {label} <b>{children}</b>
    </span>
  );
}

export function InstrumentDetailModal({
  instrumentId,
  canAct,
  onClose,
}: {
  instrumentId: string;
  canAct: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { data: ins, isLoading, isError, error } = useInstrument(instrumentId);
  const [mode, setMode] = useState<InstrumentAction | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // ADR-202 — does this instrument have an edit waiting for approval? Shown as an
  // amber chip in the header (there is no detail page to carry per-field chips).
  const pendingEdit = usePendingEditForDoc('Instrument', instrumentId);
  const hasPendingEdit = (pendingEdit.data?.rows.length ?? 0) > 0;

  const start = (m: InstrumentAction): void => {
    setMode(m);
    setMsg(null);
  };
  const tone = ins ? dueTone(ins.calibrationDueOn, ins.isCalibrationOverdue) : 'none';
  const live = ins ? ins.status !== 'lost' && ins.status !== 'scrapped' : false;

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 900, width: '96vw' }}>
        <div className="modal-hdr">
          <span className="modal-title">
            Instrument{' '}
            {ins ? (
              <>
                <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                  {ins.itemCode}
                </span>{' '}
                · <span className="mono fw-700">{ins.serialNo}</span>
              </>
            ) : null}
            {hasPendingEdit ? (
              <span
                className="tag b-amber"
                style={{ marginLeft: 8 }}
                title="An edit to this instrument is waiting for approval"
              >
                edit pending
              </span>
            ) : null}
          </span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {isLoading ? (
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          ) : isError || !ins ? (
            <div style={{ color: 'var(--red2)', fontSize: 12 }}>
              {error instanceof Error ? error.message : 'Could not load the instrument.'}
            </div>
          ) : (
            <>
              <div
                className="text2"
                style={{ fontSize: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}
              >
                <Fact label="Item Name">{ins.itemName || '—'}</Fact>
                <span>
                  Instrument Status{' '}
                  <span className={`badge ${INSTRUMENT_STATUS_BADGE[ins.status]}`}>
                    {INSTRUMENT_STATUS_LABELS[ins.status]}
                  </span>
                  {ins.writeoffPending ? (
                    <span className="badge b-red" style={{ marginLeft: 6 }}>
                      Write-off pending
                    </span>
                  ) : null}
                </span>
                <Fact label="Calibration Interval (days)">
                  {ins.calibrationIntervalDays ?? '—'}
                </Fact>
                <Fact label="Last Calibrated">{fmtDate(ins.lastCalibratedOn)}</Fact>
                <span>
                  Calibration Due{' '}
                  <b style={{ color: DUE_COLOUR[tone] }}>
                    {fmtDate(ins.calibrationDueOn)}
                    {tone === 'overdue' ? ' · Overdue' : ''}
                  </b>
                </span>
                <Fact label="Location">{ins.location || '—'}</Fact>
                {ins.status === 'issued' ? (
                  <Fact label="Held By">
                    {ins.heldBy || '—'}
                    {ins.toolIssueCode ? (
                      <span className="mono" style={{ marginLeft: 6, color: 'var(--purple)' }}>
                        {ins.toolIssueCode}
                      </span>
                    ) : null}
                  </Fact>
                ) : null}
              </div>
              {ins.remarks ? (
                <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>
                  Remarks: {ins.remarks}
                </div>
              ) : null}

              <div className="fw-700" style={{ fontSize: 12, margin: '14px 0 6px' }}>
                Calibration history
              </div>
              <div className="tbl-wrap">
                <table className="innovic-table tbl-grid">
                  <thead>
                    <tr>
                      <th>Calibrated On</th>
                      <th>Calibration Result</th>
                      <th>Certificate No.</th>
                      <th>Agency</th>
                      <th>Calibration Due</th>
                      <th>Recorded By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ins.calibrations.map((c) => (
                      <tr key={c.id} title={c.remarks ?? ''}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.calibratedOn)}</td>
                        <td>
                          <span className={`badge ${c.result === 'pass' ? 'b-green' : 'b-red'}`}>
                            {c.result === 'pass' ? 'Pass' : 'Fail'}
                          </span>
                        </td>
                        <td className="mono">{c.certificateNo || '—'}</td>
                        <td>{c.agency || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.nextDueOn)}</td>
                        <td>{c.recordedByName || '—'}</td>
                      </tr>
                    ))}
                    {ins.calibrations.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="empty-state">
                          No calibration recorded yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {mode ? (
                <InstrumentActionForm
                  key={mode}
                  ins={ins}
                  mode={mode}
                  onBack={() => setMode(null)}
                  onDone={(m) => {
                    setMode(null);
                    setMsg(m);
                  }}
                />
              ) : null}
              {msg ? (
                <div className="text2" style={{ marginTop: 10, fontSize: 12 }}>
                  ✓ {msg}
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          {ins && canAct && !mode && live ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => start('edit')}>
                Edit
              </button>
              {ins.status === 'in_store' && !ins.writeoffPending ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => start('scrap')}>
                    Scrap
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => start('missing')}
                    title="Cannot be found (e.g. at a stock count) — Lost write-off for approval"
                  >
                    Mark Missing
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => start('send')}>
                    Send for Calibration
                  </button>
                </>
              ) : null}
              {ins.status === 'in_store' || ins.status === 'at_calibration' ? (
                <button type="button" className="btn btn-primary" onClick={() => start('record')}>
                  Record Calibration
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
