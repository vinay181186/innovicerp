// TPI — one pending TPI call as an expandable card with the inline TPI entry
// form (accept/reject + Inspector/Organisation/Cert No). The submit reuses
// op-entry submitQcLog with isTpi + tpi metadata (op_log, migration 0037).
// Split out of tpi-view.tsx (ADR-201) so that file stays under 400 lines.

import {
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
  type SubmitQcLogInput,
  type TpiPendingRow,
  opSrNo,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { QcReportAttach } from '@/components/shared/qc-report-attach';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { fmtDate, todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { useSubmitQcLog } from '@/modules/op-entry/api';
import { qcHistoryKeys } from '@/modules/qc-history/api';
import { tpiKeys } from '../api';
import { TpiDetailsBox } from './tpi-details-box';

export function PendingTpi(props: {
  o: TpiPendingRow;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { o, open, onToggle, onDone } = props;
  const submit = useSubmitQcLog();
  const queryClient = useQueryClient();
  const companyId = useSession().data?.companyId ?? null;
  // TPI posts through op-entry's submitQcLog, which now enforces BOTH qc_submit
  // `entry` (ordinary QC accept/reject) AND tpi_submit `entry` (the TPI-specific
  // gate). The QC tier grants tpi_submit by default, so this only bites when an
  // admin switches TPI OFF for someone — mirror that here so the button hides
  // exactly when the server would refuse.
  const { data: eff } = useMyAccess();
  const canEntry =
    effectiveFormPerms(eff, 'qc_submit').entry && effectiveFormPerms(eff, 'tpi_submit').entry;
  const [logDate, setLogDate] = useState(todayLocal());
  const [shift, setShift] = useState<Shift>('day');
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  const [inspector, setInspector] = useState('');
  const [organization, setOrganization] = useState('');
  const [certNo, setCertNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function send(): Promise<void> {
    setErr(null);
    const acc = Number(accept || '0');
    const rej = Number(reject || '0');
    if (!Number.isInteger(acc) || acc < 0 || !Number.isInteger(rej) || rej < 0) {
      setErr('Accepted and Deviated must be whole numbers, 0 or more.');
      return;
    }
    if (acc + rej <= 0) {
      setErr('Enter the Accepted and/or Deviated qty.');
      return;
    }
    if (acc + rej > o.qcPending) {
      setErr(`Accepted + Deviated (${acc + rej}) cannot be more than QC Pending (${o.qcPending}).`);
      return;
    }
    if (!inspector.trim() || !organization.trim()) {
      setErr('Inspector Name and Organisation are required.');
      return;
    }
    const input: SubmitQcLogInput = {
      jcOpId: o.jcOpId,
      qty: acc,
      rejectQty: rej,
      logDate,
      shift,
      operatorName: inspector.trim(),
      isTpi: true,
      tpiInspector: inspector.trim(),
      tpiOrganization: organization.trim(),
      ...(certNo.trim() ? { tpiCertNo: certNo.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      ...(qcReportPath ? { qcReportPath, qcReportName } : {}),
    };
    try {
      await submit.mutateAsync(input);
      // useSubmitQcLog only refreshes the op-entry views. Refresh the TPI list
      // and the QC register too (as the QC popup does) so this card drops its
      // old QC Pending at once — otherwise the inspector thinks it failed and
      // submits again.
      void queryClient.invalidateQueries({ queryKey: tpiKeys.all });
      void queryClient.invalidateQueries({ queryKey: qcHistoryKeys.all });
      // Clear what was just booked so re-opening the card after a partial TPI
      // does not show the last qty / cert no. again (easy to double-book).
      // Inspector, organisation, date and shift stay — usually the same visit.
      setAccept('');
      setReject('0');
      setCertNo('');
      setRemarks('');
      setQcReportPath(null);
      setQcReportName(null);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save TPI Inspection. Try again.');
    }
  }

  return (
    <div
      style={{
        border: `1px solid ${open ? 'var(--green)' : 'var(--border)'}`,
        borderRadius: 8,
        marginBottom: 8,
        background: 'var(--bg2)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        onClick={onToggle}
      >
        <div>
          <b className="cyan" style={{ fontSize: 13 }}>
            {o.jcCode}
          </b>{' '}
          <span className="text3" style={{ fontSize: 11 }}>
            Op {opSrNo(o.opSeq)} — {o.operation}
          </span>
          {o.waitDays > 1 ? (
            <span style={{ fontSize: 11, color: 'var(--red2)', fontWeight: 700, marginLeft: 8 }}>
              ⚠ Waiting {o.waitDays} days
            </span>
          ) : null}
          <div className="text2" style={{ fontSize: 11 }}>
            {o.soCode ? soNoWithInternal(o.soCode, o.soInternalNo) : '—'} •{' '}
            {/* The item code is the value the inspector matches against the
                drawing, so it is the darkest text token and bold. The rest of
                the line — the SO code, the part name, the order quantity —
                stays on the muted line colour, which is what makes the code
                stand out at a glance. */}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {itemCodeWithRev(o.itemCode, o.itemRevision)}
            </span>
            {/* The inspector reads this line to know what is on the table in
                front of him, and a job-card number plus a part number does not
                tell him that — the part has to be named. It is `inline-block`
                because this line is ordinary flowing text, and an inline span
                ignores a width cap and would let a long name push "Order: N pcs"
                onto a second line. A name the join could not resolve prints
                nothing, leaving the line exactly as it has always read. */}
            {o.itemName ? (
              <>
                {' • '}
                <span
                  className="fw-700"
                  style={{
                    display: 'inline-block',
                    maxWidth: 260,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    verticalAlign: 'bottom',
                  }}
                  title={o.itemName}
                >
                  {o.itemName}
                </span>
              </>
            ) : null}{' '}
            • Order: {o.orderQty} pcs
          </div>
          {o.callDate ? (
            <div style={{ fontSize: 11, color: 'var(--amber2)' }}>
              Called: {fmtDate(o.callDate)}
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--amber2)' }}>{o.qcPending}</div>
          <div className="text3" style={{ fontSize: 11 }}>
            QC Pending
          </div>
        </div>
      </div>

      {/* No `entry` → the form is simply not drawn. No notice either: an
          expanded row that shows only its figures reads as view-only on its own. */}
      {open && canEntry ? (
        <div
          style={{
            padding: 14,
            background: 'rgba(34,197,94,0.04)',
            borderTop: '2px solid var(--green)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green2)', marginBottom: 12 }}>
            TPI Entry
          </div>

          {/* Legacy L21413-21416: Date | Shift */}
          <div className="form-grid" style={{ gap: 10, marginBottom: 12 }}>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 11 }}>
                TPI Date
              </label>
              <input
                type="date"
                className="innovic-input"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 11 }}>
                Shift
              </label>
              <select
                className="innovic-select"
                value={shift}
                onChange={(e) => setShift(e.target.value as Shift)}
              >
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Legacy L21417-21420: the big centred Accept / Reject qty inputs */}
          <div className="form-grid" style={{ gap: 10, marginBottom: 12 }}>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 11, color: 'var(--green2)' }}>
                ✅ Accepted (max {o.qcPending})
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.qcPending}
                value={accept}
                onChange={(e) => setAccept(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--green2)',
                  textAlign: 'center',
                  padding: 8,
                  border: '2px solid var(--green)',
                  background: 'var(--bg)',
                }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 11, color: 'var(--red2)' }}>
                ❌ Deviated
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.qcPending}
                value={reject}
                onChange={(e) => setReject(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--red2)',
                  textAlign: 'center',
                  padding: 8,
                  border: '2px solid var(--red)',
                  background: 'var(--bg)',
                }}
              />
            </div>
          </div>

          <TpiDetailsBox
            jcOpId={o.jcOpId}
            inspector={inspector}
            setInspector={setInspector}
            organization={organization}
            setOrganization={setOrganization}
            certNo={certNo}
            setCertNo={setCertNo}
            remarks={remarks}
            setRemarks={setRemarks}
          />

          {/* Legacy L21429-21433: attach row sits between the details box and the
              action buttons. QcReportAttach renders the same picker + × Remove. */}
          <div style={{ marginBottom: 12 }}>
            <QcReportAttach
              companyId={companyId}
              fileName={qcReportName}
              onUploaded={(path, name) => {
                setQcReportPath(path);
                setQcReportName(name);
              }}
              onClear={() => {
                setQcReportPath(null);
                setQcReportName(null);
              }}
            />
          </div>

          {err ? (
            <div role="alert" style={{ color: 'var(--red2)', fontSize: 12, marginBottom: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-success"
              style={{
                fontWeight: 700,
                fontSize: 13,
                padding: '8px 24px',
              }}
              disabled={submit.isPending}
              onClick={() => void send()}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Submit TPI
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
