// THE in-process QC entry form — one job-card operation, accept / reject, QC
// By, remarks and an optional report, posted to POST /op-entry/qc-log via
// op-entry's useSubmitQcLog.
//
// This is the form the QC Call Register used to draw inline inside an expanded
// pending row (routes/index.tsx PendingCall). It now opens as a popup over the
// register (qc-call-inspect-modal.tsx), the same way the Incoming QC page's
// "🔬 Inspect" does (incoming-qc/components/incoming-qc-inspect-form.tsx +
// -modal.tsx). Everything about the entry — state, defaults, validation
// messages, the POST body and the session-user link — lives HERE and nowhere
// else. Moved, not changed: the labels, placeholders, classes and messages are
// the ones the inline form always had.
//
// Two layers on purpose, mirroring the incoming form: `useQcCallInspect` holds
// the state and the submit; `QcCallInspectFormView` draws it; the composed
// `QcCallInspectForm` is what the popup mounts. `onDirtyChange` reports whether
// anything has been typed or attached since the form opened, so a stray ESC or
// click outside can ask before throwing that away.

import {
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
  type SubmitQcLogInput,
  type QcHistoryPendingRow,
  opSrNo,
  shortName,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { QcReportAttach } from '@/components/shared/qc-report-attach';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { useSubmitQcLog } from '@/modules/op-entry/api';
import { qcHistoryKeys } from '@/modules/qc-history/api';
import { useQcUserOptions } from '@/modules/qc-users/api';
import { NO_SERVER_SEARCH, qcSelectedLabel, toQcSearchOptions } from '@/modules/qc-users/options';
import { tpiKeys } from '@/modules/tpi/api';

function todayIso(): string {
  return todayLocal();
}

export interface QcCallInspectState {
  o: QcHistoryPendingRow;
  canEntry: boolean;
  /** True while any field differs from its opening value or a report is
   *  attached. */
  dirty: boolean;
  companyId: string | null;
  logDate: string;
  setLogDate: (v: string) => void;
  shift: Shift;
  setShift: (v: Shift) => void;
  accept: string;
  setAccept: (v: string) => void;
  reject: string;
  setReject: (v: string) => void;
  inspector: string;
  inspectorId: string | null;
  pickInspector: (id: string | null) => void;
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

/** State + submit for one pending job-card operation. */
export function useQcCallInspect(props: {
  o: QcHistoryPendingRow;
  /** After a successful submit. */
  onDone: () => void;
}): QcCallInspectState {
  const { o, onDone } = props;
  const submitQc = useSubmitQcLog();
  const queryClient = useQueryClient();
  const session = useSession().data;
  const companyId = session?.companyId ?? null;
  // Tier-driven, per department. Recording accept/reject qty is `entry` on
  // qc_submit (QC). op-entry's submitQcLog already refuses without it, but this
  // screen had no check at all — an L1 Viewer was handed the whole form and only
  // discovered the 403 on click. The session below still legitimately prefills
  // the inspector name; only the form is gated.
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_submit').entry;
  // The date the form OPENED with, captured once. `dirty` below compares
  // against this, not a fresh todayIso() — otherwise an untouched form left
  // open across midnight would start counting as "changed".
  const [openedOn] = useState(todayIso());
  const [logDate, setLogDate] = useState(openedOn);
  const [shift, setShift] = useState<Shift>('day');
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  // Seeded with the signed-in person (the common case: the QC person on this
  // screen is the one inspecting). `inspectorId` is the Access Control user
  // behind that name once it is picked from the dropdown; the two are only ever
  // set together.
  const [inspector, setInspector] = useState(shortName(session?.fullName ?? session?.email ?? ''));
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  // People for the "QC By" picker. Legacy L4164 filled this from db.operators
  // (status==='Active'), which named the wrong crowd: operators are shop-floor
  // machinists. It now comes from the QC people the user defines in Access
  // Control, so an inspection can be linked to the person who signed it.
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
  // defaults above: today's date, day shift, blank accept, reject 0, no picked
  // QC user, no remarks, no report. The pre-filled QC By NAME is not counted
  // on its own — it was put there by the form, not the user — but picking
  // someone in the dropdown is.
  const dirty =
    logDate !== openedOn ||
    shift !== 'day' ||
    accept !== '' ||
    reject !== '0' ||
    inspectorId !== null ||
    remarks !== '' ||
    qcReportPath !== null;

  function pickInspector(id: string | null): void {
    setInspectorId(id);
    const picked = qcOptions.find((u) => u.id === id);
    setInspector(picked ? qcSelectedLabel(picked) : '');
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
    if (acc + rej > o.qcPending) {
      setErr(`Accepted + Rejected (${acc + rej}) cannot be more than QC Pending (${o.qcPending}).`);
      return;
    }
    if (!inspector.trim()) {
      setErr('Inspected By is required.');
      return;
    }
    // Nobody touched the dropdown, so the field still holds the seeded name of
    // the signed-in person. Their own user id is on the session, so link the
    // entry to them — but only when they are genuinely on the QC list, because
    // that list, not this screen's permissions, is what "a QC person" means.
    const seededId = session && qcOptions.some((u) => u.id === session.id) ? session.id : null;
    const qcUserId = inspectorId ?? seededId;
    const input: SubmitQcLogInput = {
      jcOpId: o.jcOpId,
      qty: acc,
      rejectQty: rej,
      logDate,
      shift,
      // The name stays the snapshot of who signed off on the day; the id below
      // is the extra link, sent only when there is a real user behind it.
      operatorName: inspector.trim(),
      ...(qcUserId ? { qcUserId } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      ...(qcReportPath ? { qcReportPath, qcReportName } : {}),
    };
    try {
      await submitQc.mutateAsync(input);
      // useSubmitQcLog refreshes op-entry's own views but not this register's
      // feed, so the row used to linger in Pending until the 60 s poll. Refresh
      // the register (and the TPI tab, which reads the same operations) now,
      // so the row leaves the list the moment the popup closes.
      void queryClient.invalidateQueries({ queryKey: qcHistoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: tpiKeys.all });
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
    logDate,
    setLogDate,
    shift,
    setShift,
    accept,
    setAccept,
    reject,
    setReject,
    inspector,
    inspectorId,
    pickInspector,
    qcOptions,
    qcOptionsLoading: qcUsers.isFetching,
    remarks,
    setRemarks,
    qcReportName,
    setReport,
    err,
    submitting: submitQc.isPending,
    doSubmit,
  };
}

/** Hook + view in one, for the popup. Draws nothing without qc_submit `entry`. */
export function QcCallInspectForm(props: {
  o: QcHistoryPendingRow;
  /** The form's own Cancel button. */
  onCancel: () => void;
  /** After a successful submit. */
  onDone: () => void;
  /** Optional — only the popup listens. */
  onDirtyChange?: (dirty: boolean) => void;
}): React.JSX.Element | null {
  const { o, onCancel, onDone, onDirtyChange } = props;
  const form = useQcCallInspect({ o, onDone });
  const { dirty } = form;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  if (!form.canEntry) return null;
  return <QcCallInspectFormView form={form} onCancel={onCancel} />;
}

/** The markup. Same classes, labels and messages as the inline register form
 *  has always had — this IS that form, moved. */
export function QcCallInspectFormView(props: {
  form: QcCallInspectState;
  onCancel: () => void;
}): React.JSX.Element {
  const { form, onCancel } = props;
  const { o } = form;

  return (
    <div style={{ padding: '14px 16px', borderTop: '2px solid var(--green)' }}>
      {/* Legacy L4167: QC Entry header naming the JC/Op and the operation. */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 10 }}>
        ✅ QC Inspection — {o.jcCode} Op{opSrNo(o.opSeq)} — {o.operation}
      </div>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 10 }}>
            QC Date
          </label>
          <input
            type="date"
            className="innovic-input"
            value={form.logDate}
            onChange={(e) => form.setLogDate(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 10 }}>
            Shift
          </label>
          <select
            className="innovic-select"
            value={form.shift}
            onChange={(e) => form.setShift(e.target.value as Shift)}
          >
            {SHIFTS.map((s) => (
              <option key={s} value={s}>
                {SHIFT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 10, color: 'var(--green)' }}>
            ✅ Accepted (max {o.qcPending})
          </label>
          <input
            type="number"
            className="innovic-input"
            min={0}
            max={o.qcPending}
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
            max={o.qcPending}
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
            👤 Inspected By ★
          </label>
          {/* The whole QC list comes back in one small response, so the
              picker filters it in the browser and there is no ?search= to
              round-trip. */}
          <SearchableSelect
            value={form.inspectorId}
            onChange={form.pickInspector}
            options={form.qcOptions}
            onSearch={NO_SERVER_SEARCH}
            loading={form.qcOptionsLoading}
            valueLabel={form.inspector}
            selectedLabel={qcSelectedLabel}
            placeholder="🔍 Select QC person…"
            emptyText="No QC users — set them up in Access Control"
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
