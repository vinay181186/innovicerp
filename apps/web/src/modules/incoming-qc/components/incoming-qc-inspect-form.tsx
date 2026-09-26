// THE Incoming QC inspect form — one GRN line, accept / reject, QC By, remarks
// and an optional report, posted to POST /incoming-qc/:id/inspect.
//
// It is drawn in two places and must behave identically in both:
//   • inline, inside the expanded pending row on the QC Call Register
//     (qc-call-rows.tsx IncomingPendingRow), exactly where it has always been;
//   • in the "🔬 Inspect" popup on the Incoming QC page
//     (incoming-qc-inspect-modal.tsx), which owns no logic of its own.
// Everything about the entry — state, defaults, validation messages, the POST
// body, the invalidations (via useSubmitIncomingQc) and the post-submit reset —
// lives HERE and nowhere else, so the two screens cannot drift.
//
// `onDirtyChange` is a courtesy to the popup: it reports whether anything has
// been typed or attached since the form opened, so a stray ESC or click
// outside can ask before throwing that away. The register does not use it.
//
// Two layers on purpose. `useIncomingQcInspect` holds the state and the
// submit; `IncomingQcInspectFormView` draws it. The register's row calls the
// hook ITSELF and only draws the view while the row is expanded — the sheet
// unmounts the expanded area on collapse, and the state has always lived on
// the row, so a half-typed qty survives Close ▾ / Inspect ▸ exactly as it did
// before this split. The popup uses the composed `IncomingQcInspectForm`.

import { type IncomingQcPendingRow, shortName } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { QcReportAttach } from '@/components/shared/qc-report-attach';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { useQcUserOptions } from '@/modules/qc-users/api';
import { NO_SERVER_SEARCH, qcSelectedLabel, toQcSearchOptions } from '@/modules/qc-users/options';
import { useSubmitIncomingQc } from '../api';

function todayIso(): string {
  return todayLocal();
}

export interface IncomingQcInspectState {
  o: IncomingQcPendingRow;
  canEntry: boolean;
  /** True while any field differs from its opening value or a report is
   *  attached. */
  dirty: boolean;
  companyId: string | null;
  qcDate: string;
  setQcDate: (v: string) => void;
  accept: string;
  setAccept: (v: string) => void;
  reject: string;
  setReject: (v: string) => void;
  qcBy: string;
  qcById: string | null;
  pickQcBy: (id: string | null) => void;
  qcOptions: ReturnType<typeof toQcSearchOptions>;
  qcOptionsLoading: boolean;
  remarks: string;
  setRemarks: (v: string) => void;
  qcReportName: string | null;
  setReport: (path: string | null, name: string | null) => void;
  err: string | null;
  submitting: boolean;
  doSubmit: () => Promise<void>;
}

/** State + submit for one GRN line. Call it where the state should LIVE (the
 *  register row keeps it across collapse; the popup keeps it for its lifetime). */
export function useIncomingQcInspect(props: {
  o: IncomingQcPendingRow;
  /** After a successful submit, once the form has reset itself. */
  onDone: () => void;
}): IncomingQcInspectState {
  const { o, onDone } = props;
  const submit = useSubmitIncomingQc();
  const session = useSession().data;
  const companyId = session?.companyId ?? null;
  // Incoming material is its OWN form key — this row sits on the QC Call
  // Register, but accepting a GRN line is qc_incoming `entry` (what
  // incoming-qc's submitIncomingQc enforces), not qc_submit. Money on this
  // screen is untouched: the server nulls it via canSeeFormPrice.
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_incoming').entry;
  // The date the form OPENED with, captured once. `dirty` below compares
  // against this, not a fresh todayIso() — otherwise an untouched form left
  // open across midnight would start counting as "changed".
  const [openedOn] = useState(todayIso());
  const [qcDate, setQcDate] = useState(openedOn);
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  // QC By is now picked from the people Access Control marks as QC, not typed.
  // Both halves are kept: `qcBy` is the name that has always been saved on the
  // record, `qcById` is the user it now links to. They only ever move together,
  // in `pickQcBy` below (the picker's onChange).
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

  // DIRTY = anything moved off its opening value. The opening values are the
  // defaults above: today's date, blank accept, reject 0, no picked QC user,
  // no remarks, no report. The pre-filled QC By NAME is not counted on its own
  // — it was put there by the form, not the user — but picking someone in the
  // dropdown is.
  const dirty =
    qcDate !== openedOn ||
    accept !== '' ||
    reject !== '0' ||
    qcById !== null ||
    remarks !== '' ||
    qcReportPath !== null;

  function pickQcBy(id: string | null): void {
    setQcById(id);
    // Read the SHORTENED list, not the raw one, so the field and
    // the dropdown agree -- and so the name stamped on the record
    // is the one the person actually saw.
    const picked = qcOptions.find((u) => u.id === id);
    setQcBy(picked ? qcSelectedLabel(picked) : '');
  }

  function setReport(path: string | null, name: string | null): void {
    setQcReportPath(path);
    setQcReportName(name);
  }

  async function doSubmit(): Promise<void> {
    setErr(null);
    const acc = Number(accept || '0');
    const rej = Number(reject || '0');
    if (!Number.isInteger(acc) || acc < 0 || !Number.isInteger(rej) || rej < 0) {
      setErr('Accepted and Rejected must be whole numbers, 0 or more.');
      return;
    }
    if (acc + rej <= 0) {
      setErr('Enter the Accepted and/or Rejected qty.');
      return;
    }
    if (acc + rej > o.pendingQty) {
      setErr(
        `Accepted + Rejected (${acc + rej}) cannot be more than QC Pending (${o.pendingQty}).`,
      );
      return;
    }
    if (!qcBy.trim()) {
      setErr('Inspected By is required.');
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
      setErr(e instanceof Error ? e.message : 'Could not save QC Inspection. Try again.');
    }
  }

  return {
    o,
    canEntry,
    dirty,
    companyId,
    qcDate,
    setQcDate,
    accept,
    setAccept,
    reject,
    setReject,
    qcBy,
    qcById,
    pickQcBy,
    qcOptions,
    qcOptionsLoading: qcUsers.isFetching,
    remarks,
    setRemarks,
    qcReportName,
    setReport,
    err,
    submitting: submit.isPending,
    doSubmit,
  };
}

/** Hook + view in one, for a host that has nowhere else to keep the state
 *  (the Incoming QC popup). Draws nothing without qc_incoming `entry`. */
export function IncomingQcInspectForm(props: {
  o: IncomingQcPendingRow;
  /** The form's own Cancel button. */
  onCancel: () => void;
  /** After a successful submit, once the form has reset itself. */
  onDone: () => void;
  /** Optional — only the popup listens. */
  onDirtyChange?: (dirty: boolean) => void;
}): React.JSX.Element | null {
  const { o, onCancel, onDone, onDirtyChange } = props;
  const form = useIncomingQcInspect({ o, onDone });
  const { dirty } = form;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  if (!form.canEntry) return null;
  return <IncomingQcInspectFormView form={form} onCancel={onCancel} />;
}

/** The markup. Same classes, labels and messages as the inline register form
 *  has always had — this IS that form, moved. */
export function IncomingQcInspectFormView(props: {
  form: IncomingQcInspectState;
  onCancel: () => void;
}): React.JSX.Element {
  const { form, onCancel } = props;
  const { o } = form;

  return (
    <div style={{ padding: '14px 16px', borderTop: '2px solid var(--green)' }}>
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
          Stock only — not linked to a JC op. Wrong GRN?
        </div>
      )}
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 10 }}>
            QC Date
          </label>
          <input
            type="date"
            className="innovic-input"
            value={form.qcDate}
            onChange={(e) => form.setQcDate(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 10 }}>
            👤 Inspected By ★
          </label>
          {/* The whole QC list comes back in one small response, so the
              picker filters it in the browser and there is no ?search= to
              round-trip. */}
          <SearchableSelect
            value={form.qcById}
            onChange={form.pickQcBy}
            options={form.qcOptions}
            onSearch={NO_SERVER_SEARCH}
            loading={form.qcOptionsLoading}
            valueLabel={form.qcBy}
            selectedLabel={qcSelectedLabel}
            placeholder="🔍 Select QC person…"
            emptyText="No QC users — set them up in Access Control"
          />
        </div>
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 10, color: 'var(--green)' }}>
            ✅ Accepted (max {o.pendingQty})
          </label>
          <input
            type="number"
            className="innovic-input"
            min={0}
            max={o.pendingQty}
            value={form.accept}
            onChange={(e) => form.setAccept(e.target.value)}
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
            ❌ Rejected
          </label>
          <input
            type="number"
            className="innovic-input"
            min={0}
            max={o.pendingQty}
            value={form.reject}
            onChange={(e) => form.setReject(e.target.value)}
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
            value={form.remarks}
            onChange={(e) => form.setRemarks(e.target.value)}
            placeholder="NC reason, observations..."
          />
        </div>
        <div className="form-grp form-full">
          <QcReportAttach
            companyId={form.companyId}
            fileName={form.qcReportName}
            onUploaded={(path, name) => form.setReport(path, name)}
            onClear={() => form.setReport(null, null)}
          />
        </div>
      </div>
      {form.err ? (
        <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
          {form.err}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-success"
          disabled={form.submitting}
          onClick={() => void form.doSubmit()}
        >
          {form.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Submit Inspection
        </button>
      </div>
    </div>
  );
}
