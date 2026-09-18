// Incoming-QC pending row for the unified QC Call Register: a GRN line awaiting
// inspection with an inline accept/reject form (credits accepted qty to stock
// via POST /incoming-qc/:id/inspect). Extracted so the QC Call Register can
// show incoming-material QC alongside process (JC-op) QC on a single approval
// screen. The collapsed line is drawn by the register's ruled sheet
// (qc-call-register/components/qc-sheet.tsx PendingSheetRow); only the
// expanded form lives here. Completed incoming rows are drawn by the sheet
// directly (CompletedIncomingSheetRow).

import { type IncomingQcPendingRow, opSrNo, shortName } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QcReportAttach } from '@/components/shared/qc-report-attach';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { todayLocal } from '@/lib/date';
import { PendingSheetRow } from '@/modules/qc-call-register/components/qc-sheet';
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
  const [qcBy, setQcBy] = useState(shortName(session?.fullName ?? session?.email ?? ''));
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
    <PendingSheetRow
      code={
        <Link
          to="/goods-receipt-notes/$id"
          params={{ id: o.grnId }}
          title="Open this GRN"
          style={{ color: 'inherit' }}
        >
          {o.grnNo}
        </Link>
      }
      partName={o.itemName}
      // An OSP return traces to an SO line and shows CODE/REV; a vendor's
      // raw-material receipt has no SO behind it and correctly shows the bare
      // code. The "no job card" line below says which is which.
      itemCode={itemCodeWithRev(o.itemCode, o.itemRevision)}
      context={
        <>
          {o.vendorName ?? '—'} · GRN <span className="mono">{o.grnNo}</span>
          {o.soCode ? (
            <>
              {' '}
              · SO <span className="mono">{o.soCode}</span>
            </>
          ) : null}
        </>
      }
      contextLine2={
        o.jcCode ? (
          <>
            → <span className="mono">{o.jcCode}</span> Op {o.opSeq != null ? opSrNo(o.opSeq) : ''}
            {o.opName ? ` · ${o.opName}` : ''}
          </>
        ) : (
          <span style={{ color: 'var(--amber)', fontWeight: 700 }}>No job card</span>
        )
      }
      qty={o.pendingQty}
      calledDate={o.grnDate}
      waitDays={o.waitDays}
      overdue={false}
      stage="incoming"
      open={open}
      onToggle={onToggle}
    >
      {/* No `entry` → the form is simply not drawn. No notice either: an
          expanded row that shows only its figures reads as view-only on its own. */}
      {canEntry ? (
        <div style={{ padding: '14px 16px', borderTop: '2px solid var(--green)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 10 }}>
            ✅ Inspect — {itemCodeWithRev(o.itemCode, o.itemRevision, o.itemName ?? 'Item')} ·{' '}
            <span className="mono">GRN {o.grnNo}</span>
            {o.jcCode ? (
              <span className="text2" style={{ fontWeight: 600 }}>
                {' '}
                · {o.jcCode} Op {o.opSeq != null ? opSrNo(o.opSeq) : ''}
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
                  // Read the SHORTENED list, not the raw one, so the field and
                  // the dropdown agree -- and so the name stamped on the record
                  // is the one the person actually saw.
                  const picked = qcOptions.find((u) => u.id === id);
                  setQcBy(picked ? qcSelectedLabel(picked) : '');
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
    </PendingSheetRow>
  );
}
