// New Item Issue (ADR-193 phase 3b) — one slip, many lines, issued against a
// Job Card, an Assembly (Equipment) SO, or for General use. The server caps a
// line at its To Issue; going over needs a reason from an approve-tier user
// (409 needsConfirmation → the confirm box below).
import {
  type CreateStoreIssueInput,
  ISSUE_AGAINST,
  ISSUE_AGAINST_LABELS,
  type IssueAgainst,
  STORE_ISSUE_REVERSE_REASON_MIN,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import { useSaveKey } from '@/lib/use-save-key';
import { useJcMaterial, useSoMaterial } from '../../material/api';
import { JcMaterialTable } from '../../material/components/jc-material-table';
import { SoMaterialTable } from '../../material/components/so-material-table';
import { useCreateStoreIssue } from '../api';
import { type DraftIssueLine, IssueLinesEditor, toIssueLines } from './issue-lines-editor';
import { JobCardPicker, OperatorPicker, SalesOrderPicker } from './issue-pickers';

interface OverLine {
  itemCode: string;
  toIssueQty: number;
  qty: number;
}

export interface NewIssueSeed {
  issueAgainst: IssueAgainst;
  jobCardId?: string | undefined;
  salesOrderId?: string | undefined;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function NewIssueModal({
  seed,
  onClose,
}: {
  seed?: NewIssueSeed | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [against, setAgainst] = useState<IssueAgainst>(seed?.issueAgainst ?? 'job_card');
  const [jobCardId, setJobCardId] = useState<string | null>(seed?.jobCardId ?? null);
  const [salesOrderId, setSalesOrderId] = useState<string | null>(seed?.salesOrderId ?? null);
  const [department, setDepartment] = useState('');
  const [date, setDate] = useState(todayIst());
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [issuedToText, setIssuedToText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<DraftIssueLine[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState<OverLine[] | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // R2 — one idempotency key per open modal, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const createMut = useCreateStoreIssue(saveKey);
  const { data: eff } = useMyAccess();
  const canApprove = effectiveFormPerms(eff, 'issue_create').approve;
  // Any edit after a 409 drops the more-than-To-Issue box — the list it showed no
  // longer matches what would be sent (review F4).
  const editLines = (next: DraftIssueLine[]): void => {
    setLines(next);
    setOver(null);
  };
  const jcMat = useJcMaterial(against === 'job_card' ? (jobCardId ?? undefined) : undefined);
  const soMat = useSoMaterial(against === 'assembly_so' ? (salesOrderId ?? undefined) : undefined);

  const switchAgainst = (a: IssueAgainst): void => {
    setAgainst(a);
    setLines([]);
    setOver(null);
    setErr(null);
  };

  // "Fill To Issue": one line per material row still to issue, qty = the
  // smaller of To Issue and Available. Rows with nothing to issue are skipped.
  const fillToIssue = (): void => {
    const rows =
      against === 'job_card'
        ? (jcMat.data?.lines ?? []).map((l) => ({ ...l, bal: l.toIssueQty ?? 0 }))
        : (soMat.data?.lines ?? []).map((l) => ({ ...l, bal: l.toIssueQty }));
    editLines(
      rows
        .filter((l) => l.bal > 0)
        .map((l) => {
          const q = r3(Math.max(0, Math.min(l.bal, l.availableQty)));
          return {
            itemId: l.itemId,
            itemCode: l.itemCode,
            itemName: l.itemName,
            uom: l.uom,
            qtyText: q > 0 ? String(q) : '',
            hint: `To Issue ${r3(l.bal)} · Available ${r3(l.availableQty)}`,
          };
        }),
    );
  };

  const save = (andAnother: boolean, reason?: string): void => {
    setErr(null);
    const fail = (m: string): void => setErr(m);
    if (!date) return fail('Issue Date is required.');
    if (against === 'job_card' && !jobCardId) return fail('Pick the Job Card.');
    if (against === 'assembly_so' && !salesOrderId) return fail('Pick the Assembly SO.');
    if (against === 'general' && !department.trim())
      return fail('Enter the Department that uses it.');
    if (!operatorId && !issuedToText.trim())
      return fail('Pick who received it (Operator) or type a name.');
    if (purpose.trim().length < 3) return fail('Enter the Purpose (at least 3 characters).');
    const ls = toIssueLines(lines);
    if (!ls.ok) return fail(ls.error);

    const input: CreateStoreIssueInput = {
      issueDate: date,
      issueAgainst: against,
      purpose: purpose.trim(),
      lines: ls.lines,
    };
    if (against === 'job_card' && jobCardId) input.jobCardId = jobCardId;
    if (against === 'assembly_so' && salesOrderId) input.salesOrderId = salesOrderId;
    if (against === 'general') input.department = department.trim();
    if (operatorId) input.operatorId = operatorId;
    else input.issuedToText = issuedToText.trim();
    if (remarks.trim()) input.remarks = remarks.trim();
    if (reason) input.confirmReason = reason;

    createMut.mutate(input, {
      onSuccess: (created) => {
        setOver(null);
        setConfirmReason('');
        if (!andAnother) return onClose();
        // Keep against / document / received-by; clear the lines.
        setLastSaved(created.code);
        setLines([]);
        setPurpose('');
        setRemarks('');
      },
      onError: (e) => {
        const d = (e as { details?: { needsConfirmation?: boolean; over?: OverLine[] } }).details;
        if (d?.needsConfirmation && d.over) {
          setOver(d.over);
          return;
        }
        setErr(e instanceof Error ? e.message : 'Could not save the issue. Try again.');
      },
    });
  };

  const mat = against === 'job_card' ? jcMat : against === 'assembly_so' ? soMat : null;
  const docPicked = against === 'job_card' ? Boolean(jobCardId) : Boolean(salesOrderId);

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 1000, width: '96vw' }}>
        <div className="modal-hdr">
          <span className="modal-title">New Item Issue</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {ISSUE_AGAINST.map((a) => (
              <button
                key={a}
                type="button"
                className={against === a ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                onClick={() => switchAgainst(a)}
              >
                {ISSUE_AGAINST_LABELS[a]}
              </button>
            ))}
          </div>

          <div className="form-grid">
            {against === 'job_card' ? (
              <div className="form-grp">
                <label className="form-label" htmlFor="si-jc">
                  Job Card <span className="req">★</span>
                </label>
                <JobCardPicker
                  id="si-jc"
                  value={jobCardId}
                  valueLabel={jcMat.data?.jcCode}
                  onChange={setJobCardId}
                />
              </div>
            ) : against === 'assembly_so' ? (
              <div className="form-grp">
                <label className="form-label" htmlFor="si-so">
                  Assembly SO <span className="req">★</span>
                </label>
                <SalesOrderPicker
                  id="si-so"
                  value={salesOrderId}
                  valueLabel={
                    soMat.data
                      ? soNoWithInternal(soMat.data.soCode, soMat.data.soInternalNo)
                      : undefined
                  }
                  onChange={setSalesOrderId}
                />
              </div>
            ) : (
              <div className="form-grp">
                <label className="form-label">
                  Department <span className="req">★</span>
                </label>
                <input
                  type="text"
                  className="innovic-input"
                  placeholder="e.g. Maintenance, Production"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                />
              </div>
            )}

            <div className="form-grp">
              <label className="form-label">
                Issue Date <span className="req">★</span>
              </label>
              <input
                type="date"
                className="innovic-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="form-grp">
              <label className="form-label" htmlFor="si-op">
                Issued To <span className="req">★</span>
              </label>
              <OperatorPicker id="si-op" value={operatorId} onChange={setOperatorId} />
              {!operatorId ? (
                <input
                  type="text"
                  className="innovic-input"
                  style={{ marginTop: 4 }}
                  placeholder="…or type a name if not an operator"
                  value={issuedToText}
                  onChange={(e) => setIssuedToText(e.target.value)}
                />
              ) : null}
            </div>

            <div className="form-grp">
              <label className="form-label">
                Purpose <span className="req">★</span>
              </label>
              <input
                type="text"
                className="innovic-input"
                placeholder="Manufacturing / Assembly / Repair"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>

            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <input
                type="text"
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {mat && docPicked ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="fw-700" style={{ fontSize: 12 }}>
                  Material
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!mat.data}
                  onClick={fillToIssue}
                  title="One line per item still to issue — qty = To Issue, or Available if less"
                >
                  Fill To Issue
                </button>
              </div>
              {mat.isLoading ? (
                <div className="text3" style={{ fontSize: 12 }}>
                  <Loader2 size={14} className="inline animate-spin" /> Loading…
                </div>
              ) : mat.isError ? (
                <div style={{ color: 'var(--red2)', fontSize: 12 }}>
                  {mat.error instanceof Error ? mat.error.message : 'Could not load material.'}
                </div>
              ) : against === 'job_card' && jcMat.data ? (
                <JcMaterialTable data={jcMat.data} />
              ) : against === 'assembly_so' && soMat.data ? (
                <SoMaterialTable data={soMat.data} />
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <div className="fw-700" style={{ fontSize: 12, marginBottom: 6 }}>
              Items to issue
            </div>
            <IssueLinesEditor lines={lines} onChange={editLines} />
          </div>

          {over ? (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                border: '1px solid var(--amber2)',
                borderRadius: 4,
              }}
            >
              <div className="fw-700" style={{ fontSize: 12, color: 'var(--amber2)' }}>
                More than To Issue
              </div>
              <ul style={{ fontSize: 12, margin: '6px 0 8px 16px' }}>
                {over.map((o) => (
                  <li key={o.itemCode}>
                    <span className="mono fw-700">{o.itemCode}</span>: Issue Qty {o.qty}, To Issue{' '}
                    {o.toIssueQty}
                  </li>
                ))}
              </ul>
              <div className="text3" style={{ fontSize: 11, marginBottom: 6 }}>
                {canApprove
                  ? 'Issuing more needs a reason.'
                  : 'Issuing more needs a Store user with approve rights — ask one to post this issue, or lower the qty.'}
              </div>
              <input
                type="text"
                className="innovic-input"
                disabled={!canApprove}
                placeholder="Reason, e.g. extra bar for a setup piece"
                value={confirmReason}
                onChange={(e) => setConfirmReason(e.target.value)}
              />
            </div>
          ) : null}

          {lastSaved && !err ? (
            <div className="text2" style={{ marginTop: 12, fontSize: 12 }}>
              ✓ Saved <span className="td-code">{lastSaved}</span> — enter the next issue.
            </div>
          ) : null}
          {err ? (
            <div
              style={{
                marginTop: 12,
                padding: 8,
                background: 'var(--red3)',
                color: 'var(--red2)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {err}
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {lastSaved ? 'Close' : 'Cancel'}
          </button>
          {over ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                !canApprove ||
                createMut.isPending ||
                confirmReason.trim().length < STORE_ISSUE_REVERSE_REASON_MIN
              }
              onClick={() => save(false, confirmReason.trim())}
              title={`Reason needed (at least ${STORE_ISSUE_REVERSE_REASON_MIN} characters)`}
            >
              Issue Anyway
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={createMut.isPending}
                onClick={() => save(true)}
                title="Save, then start the next issue for the same document and person"
              >
                Save &amp; New
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={createMut.isPending}
                onClick={() => save(false)}
              >
                {createMut.isPending ? (
                  <>
                    <Loader2 size={14} className="inline animate-spin" /> Saving…
                  </>
                ) : (
                  'Save Issue'
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
