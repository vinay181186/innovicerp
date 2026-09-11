// Incoming-QC rows for the unified QC Call Register. LEFT-pane pending GRN lines
// with an inline accept/reject form (credits accepted qty to stock via
// POST /incoming-qc/:id/inspect), and RIGHT-pane completed-inspection rows.
// Extracted so the QC Call Register can show incoming-material QC alongside
// process (JC-op) QC on a single approval screen.

import type { IncomingQcCompletedRow, IncomingQcPendingRow } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QcReportAttach, QcReportLink } from '@/components/shared/qc-report-attach';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtDate } from '@/lib/print/doc-print';
import { todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { useQcUserOptions } from '@/modules/qc-users/api';
import { NO_SERVER_SEARCH, qcSelectedLabel, toQcSearchOptions } from '@/modules/qc-users/options';
import { useSubmitIncomingQc } from '../api';

function todayIso(): string {
  return todayLocal();
}

export function IncomingPendingRow(props: {
  o: IncomingQcPendingRow;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { o, open, onToggle, onDone } = props;
  const submit = useSubmitIncomingQc();
  const session = useSession().data;
  const companyId = session?.companyId ?? null;
  // Incoming material is its OWN form key — this row sits on the QC Call
  // Register, but accepting a GRN line is qc_incoming `entry` (what
  // incoming-qc's submitIncomingQc enforces), not qc_submit. Money on this
  // screen is untouched: the server nulls it via canSeeFormPrice.
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_incoming').entry;
  const [qcDate, setQcDate] = useState(todayIso());
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  // QC By is now picked from the people Access Control marks as QC, not typed.
  // Both halves are kept: `qcBy` is the name that has always been saved on the
  // record, `qcById` is the user it now links to. They only ever move together,
  // in the picker's onChange below.
  const [qcBy, setQcBy] = useState(session?.fullName ?? session?.email ?? '');
  const [qcById, setQcById] = useState<string | null>(null);
  const qcUsers = useQcUserOptions();
  const qcOptions = useMemo(
    () => toQcSearchOptions(qcUsers.data?.options ?? []),
    [qcUsers.data?.options],
  );
  const [remarks, setRemarks] = useState('');
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function doSubmit(): Promise<void> {
    setErr(null);
    const acc = Number(accept || '0');
    const rej = Number(reject || '0');
    if (!Number.isInteger(acc) || acc < 0 || !Number.isInteger(rej) || rej < 0) {
      setErr('Accept/Reject must be non-negative integers.');
      return;
    }
    if (acc + rej <= 0) {
      setErr('Enter an accept and/or reject qty.');
      return;
    }
    if (acc + rej > o.pendingQty) {
      setErr(`Total ${acc + rej} exceeds pending ${o.pendingQty}.`);
      return;
    }
    if (!qcBy.trim()) {
      setErr('Enter who did the QC (QC By).');
      return;
    }
    try {
      await submit.mutateAsync({
        grnLineId: o.grnLineId,
        input: {
          acceptedQty: acc,
          rejectedQty: rej,
          qcInspectedByName: qcBy.trim(),
          // Only sent when the name came from the dropdown — a seeded or
          // legacy name has no user behind it to link.
          ...(qcById ? { qcInspectedByUserId: qcById } : {}),
          qcDate,
          ...(remarks.trim() ? { qcRemarks: remarks.trim() } : {}),
          ...(qcReportPath ? { qcReportPath, ...(qcReportName ? { qcReportName } : {}) } : {}),
        },
      });
      // Reset the form so reopening this row (e.g. to clear a remaining pending
      // balance after a partial accept) starts blank, not the just-typed qty.
      setAccept('');
      setReject('0');
      setRemarks('');
      setQcReportPath(null);
      setQcReportName(null);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'QC submit failed');
    }
  }

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        background: open ? 'rgba(34,197,94,0.06)' : undefined,
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        onClick={onToggle}
      >
        <div style={{ minWidth: 0 }}>
          <div>
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: 'var(--purple)',
                border: '1px solid var(--purple)',
                borderRadius: 3,
                padding: '0 5px',
                marginRight: 6,
              }}
            >
              INCOMING
            </span>
            <b className="cyan" style={{ fontSize: 13 }}>
              {/* An OSP return traces to an SO line and shows CODE/REV; a vendor's
                  raw-material receipt has no SO behind it and correctly shows the
                  bare code. The "NO JOB CARD" tag below says which is which. */}
              {itemCodeWithRev(o.itemCode, o.itemRevision)}
            </b>{' '}
            <span className="text2" style={{ fontSize: 12 }}>
              {o.itemName ?? ''}
            </span>
          </div>
          <div className="text3" style={{ fontSize: 10 }}>
            🏭 {o.vendorName ?? '—'} · SO <b className="mono">{o.soCode ?? '—'}</b>
            <span style={{ marginLeft: 6, opacity: 0.6 }}>· GRN {o.grnNo}</span>
          </div>
          <div style={{ fontSize: 10, marginTop: 2 }}>
            {o.jcCode ? (
              <span className="text2">
                → <b className="mono">{o.jcCode}</b> Op {o.opSeq}
                {o.opName ? ` · ${o.opName}` : ''}
              </span>
            ) : (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: 'var(--amber)',
                  border: '1px solid var(--amber)',
                  borderRadius: 3,
                  padding: '0 5px',
                }}
              >
                NO JOB CARD
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--amber)' }}>{o.pendingQty}</div>
          <div className="text3" style={{ fontSize: 9 }}>
            PENDING
          </div>
        </div>
      </div>

      {/* No `entry` → the form is simply not drawn. No notice either: an
          expanded row that shows only its figures reads as view-only on its own. */}
      {open && canEntry ? (
        <div
          style={{
            padding: '14px 12px',
            background: 'rgba(34,197,94,0.04)',
            borderTop: '2px solid var(--green)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 10 }}>
            ✅ Inspect — {itemCodeWithRev(o.itemCode, o.itemRevision, o.itemName ?? 'Item')} ·{' '}
            <span
              style={{ background: 'rgba(34,197,94,0.15)', padding: '2px 8px', borderRadius: 4 }}
            >
              GRN {o.grnNo}
            </span>
            {o.jcCode ? (
              <span className="text2" style={{ fontWeight: 600 }}>
                {' '}
                · {o.jcCode} Op {o.opSeq}
              </span>
            ) : null}
          </div>
          {/* Two items can share a name (PLUNGER 554117145000 vs …163000), so the
              item line alone doesn't prove you opened the right GRN. This says
              plainly when the line feeds no operation — the one signal that
              distinguishes a raw-material receipt from an OSP return. */}
          {o.jcCode ? null : (
            <div
              role="note"
              style={{
                fontSize: 11,
                color: 'var(--amber)',
                border: '1px solid var(--amber)',
                background: 'rgba(245,158,11,0.08)',
                borderRadius: 4,
                padding: '6px 8px',
                marginBottom: 10,
              }}
            >
              This line feeds <b>no job card operation</b> — accepting it credits stock only. If you
              meant to clear a job-card operation, you are on the wrong GRN.
            </div>
          )}
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10 }}>
                QC date
              </label>
              <input
                type="date"
                className="innovic-input"
                value={qcDate}
                onChange={(e) => setQcDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10 }}>
                👤 QC By ★
              </label>
              {/* The whole QC list comes back in one small response, so the
                  picker filters it in the browser and there is no ?search= to
                  round-trip. */}
              <SearchableSelect
                value={qcById}
                onChange={(id) => {
                  setQcById(id);
                  setQcBy(qcUsers.data?.options.find((u) => u.id === id)?.name ?? '');
                }}
                options={qcOptions}
                onSearch={NO_SERVER_SEARCH}
                loading={qcUsers.isFetching}
                valueLabel={qcBy}
                selectedLabel={qcSelectedLabel}
                placeholder="🔍 Select QC person…"
                emptyText="No QC users — set them up in Access Control"
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10, color: 'var(--green)' }}>
                ✅ Accept Qty (max {o.pendingQty})
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.pendingQty}
                value={accept}
                onChange={(e) => setAccept(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--green)',
                  border: '2px solid var(--green)',
                  textAlign: 'center',
                }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10, color: 'var(--red)' }}>
                ❌ Reject Qty
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.pendingQty}
                value={reject}
                onChange={(e) => setReject(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--red)',
                  border: '2px solid var(--red)',
                  textAlign: 'center',
                }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" style={{ fontSize: 10 }}>
                Remarks
              </label>
              <input
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="NC reason, observations..."
              />
            </div>
            <div className="form-grp form-full">
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
          </div>
          {err ? (
            <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={submit.isPending}
              onClick={() => void doSubmit()}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}✓ Submit QC
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function IncomingCompletedRow({ l }: { l: IncomingQcCompletedRow }): React.JSX.Element {
  const dispColor =
    l.disposition === 'Rejected'
      ? 'var(--red)'
      : l.disposition === 'Partial Accept'
        ? 'var(--amber)'
        : 'var(--green)';
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: 'var(--purple)',
              border: '1px solid var(--purple)',
              borderRadius: 3,
              padding: '0 5px',
              marginRight: 6,
            }}
          >
            INCOMING
          </span>
          <b className="cyan">{itemCodeWithRev(l.itemCode, l.itemRevision)}</b>{' '}
          <span className="text3" style={{ fontSize: 10 }}>
            {l.itemName ?? ''}
          </span>
          <div className="text2" style={{ fontSize: 11 }}>
            GRN <span className="mono">{l.grnNo}</span> · {l.vendorName ?? '—'}
          </div>
          <div style={{ fontSize: 10, marginTop: 2 }}>
            <span className="text3">Received: {fmtDate(l.grnDate)}</span>
            {l.qcDate ? (
              <>
                {' → '}
                <span>
                  Inspected: <b style={{ color: 'var(--green)' }}>{fmtDate(l.qcDate)}</b>
                </span>
                {l.respDays != null ? (
                  <span
                    style={{
                      fontWeight: 700,
                      marginLeft: 6,
                      color: l.respDays <= 0 ? 'var(--green)' : 'var(--amber)',
                    }}
                  >
                    (
                    {l.respDays <= 0 ? 'Same day' : `${l.respDays} day${l.respDays > 1 ? 's' : ''}`}
                    )
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>{l.acceptedQty} ✓</span>
          {l.rejectedQty > 0 ? (
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>{l.rejectedQty} ✗</span>
          ) : null}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: dispColor,
              border: `1px solid ${dispColor}`,
              borderRadius: 3,
              padding: '1px 6px',
            }}
          >
            {l.disposition}
          </span>
        </div>
      </div>
      <div
        className="text3"
        style={{ display: 'flex', gap: 10, fontSize: 10, marginTop: 3, flexWrap: 'wrap' }}
      >
        <span className="text2">👤 {l.qcInspectedBy ?? '—'}</span>
        {l.qcReportPath ? (
          <QcReportLink path={l.qcReportPath} name={l.qcReportName} label={l.qcReportName ?? '⬇'} />
        ) : null}
        {l.qcRemarks ? <span className="text2">{l.qcRemarks}</span> : null}
      </div>
    </div>
  );
}
