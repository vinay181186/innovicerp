// New Item Issue (ADR-193 phase 3b) — one slip, many lines, issued against a
// Job Card, an Assembly (Equipment) SO, or for General use. A full page (owner
// 2026-11-04: a create form with line items is a page). The server caps a line
// at its To Issue; going over needs a reason from an approve-tier user (409
// needsConfirmation → the confirm box below).
//
// `?issueAgainst=job_card&jobCardId=…` (JC Material tab "Issue from Store") or
// `?issueAgainst=assembly_so&salesOrderId=…` (assembly page) opens it seeded.
import {
  type CreateStoreIssueInput,
  ISSUE_AGAINST,
  ISSUE_AGAINST_LABELS,
  type IssueAgainst,
  STORE_ISSUE_REVERSE_REASON_MIN,
} from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { soNoWithInternal } from '@/lib/so-number';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner, useToast } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { FormActions, PageHeader, useSaveShortcut } from '@/ui/layout';
import { useJcMaterial, useSoMaterial } from '../../material/api';
import { JcMaterialTable } from '../../material/components/jc-material-table';
import { SoMaterialTable } from '../../material/components/so-material-table';
import { useCreateStoreIssue } from '../api';
import { IssueOverBox, type OverLine } from '../components/issue-over-box';
import {
  type DraftIssueLine,
  IssueLinesEditor,
  toIssueLines,
} from '../components/issue-lines-editor';
import { JobCardPicker, ProductionUserPicker, SalesOrderPicker } from '../components/issue-pickers';

const searchSchema = z.object({
  issueAgainst: z.enum(ISSUE_AGAINST).optional().catch(undefined),
  jobCardId: z.string().uuid().optional().catch(undefined),
  salesOrderId: z.string().uuid().optional().catch(undefined),
});

export const storeIssueNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'issue-register/new',
  validateSearch: searchSchema,
  component: StoreIssueNewPage,
});

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function StoreIssueNewPage(): React.JSX.Element {
  const seed = storeIssueNewRoute.useSearch();
  const navigate = useNavigate();
  const goBack = useCallback(() => void navigate({ to: '/issue-register' }), [navigate]);

  const [against, setAgainst] = useState<IssueAgainst>(seed.issueAgainst ?? 'job_card');
  const [jobCardId, setJobCardId] = useState<string | null>(seed.jobCardId ?? null);
  const [salesOrderId, setSalesOrderId] = useState<string | null>(seed.salesOrderId ?? null);
  const [department, setDepartment] = useState('');
  const [date, setDate] = useState(todayIst());
  const [issuedToUserId, setIssuedToUserId] = useState<string | null>(null);
  const [issuedToText, setIssuedToText] = useState('');
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<DraftIssueLine[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState<OverLine[] | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // After Save & New only the kept document + person are on screen: nothing to lose yet.
  const edited = lines.length > 0 || Boolean(purpose.trim() || remarks.trim());
  const exit = useExitConfirm({ onExit: goBack, enabled: !lastSaved || edited });

  // R2 — one idempotency key per open form, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const toast = useToast();
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
    if (!issuedToUserId && !issuedToText.trim())
      return fail('Pick who received it, or type a name.');
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
    if (issuedToUserId) input.issuedToUserId = issuedToUserId;
    else input.issuedToText = issuedToText.trim();
    if (remarks.trim()) input.remarks = remarks.trim();
    if (reason) input.confirmReason = reason;

    createMut.mutate(input, {
      onSuccess: (created) => {
        setOver(null);
        setConfirmReason('');
        if (!andAnother) {
          toast.ok(`Item Issue ${created.code} saved`);
          return exit.leave(goBack);
        }
        toast.ok(`Item Issue ${created.code} saved — enter the next issue.`);
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

  // Ctrl+S is whichever primary button is showing: Save Issue, or Issue Anyway
  // once the box has asked and the reason is there.
  const canIssueAnyway =
    canApprove && confirmReason.trim().length >= STORE_ISSUE_REVERSE_REASON_MIN;
  useSaveShortcut(
    () => (over ? save(false, confirmReason.trim()) : save(false)),
    !createMut.isPending && (!over || canIssueAnyway),
  );

  const mat = against === 'job_card' ? jcMat : against === 'assembly_so' ? soMat : null;
  const docPicked = against === 'job_card' ? Boolean(jobCardId) : Boolean(salesOrderId);
  const dirty =
    edited || (!lastSaved && Boolean(department.trim() || issuedToUserId || issuedToText.trim()));

  return (
    <div>
      {exit.dialog}
      <PageHeader title="New Item Issue" backLabel="Back to Item Issue Register" onBack={goBack} />

      <Panel>
        <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
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

        <FormGrid>
          {against === 'job_card' ? (
            <FormField label="Job Card" required size="lg" htmlFor="si-jc">
              <JobCardPicker
                id="si-jc"
                value={jobCardId}
                valueLabel={jcMat.data?.jcCode}
                onChange={setJobCardId}
              />
            </FormField>
          ) : against === 'assembly_so' ? (
            <FormField label="Assembly SO" required size="lg" htmlFor="si-so">
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
            </FormField>
          ) : (
            <FormField label="Department" required size="lg" htmlFor="si-dept">
              <input
                id="si-dept"
                type="text"
                className="innovic-input"
                placeholder="e.g. Maintenance, Production"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </FormField>
          )}

          <FormField label="Issue Date" required size="sm" htmlFor="si-date">
            <input
              id="si-date"
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>

          <FormField label="Issued To" required size="sm" htmlFor="si-op">
            <ProductionUserPicker id="si-op" value={issuedToUserId} onChange={setIssuedToUserId} />
            {!issuedToUserId ? (
              <input
                type="text"
                className="innovic-input"
                style={{ marginTop: 'var(--sp-1)' }}
                placeholder="…or type a name"
                value={issuedToText}
                onChange={(e) => setIssuedToText(e.target.value)}
              />
            ) : null}
          </FormField>

          <FormField label="Purpose" required size="lg" htmlFor="si-purpose">
            <input
              id="si-purpose"
              type="text"
              className="innovic-input"
              placeholder="Manufacturing / Assembly / Repair"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </FormField>

          <FormField label="Remarks" size="lg" htmlFor="si-remarks">
            <input
              id="si-remarks"
              type="text"
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      {mat && docPicked ? (
        <Panel
          title="Material"
          actions={
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!mat.data}
              onClick={fillToIssue}
              title="One line per item still to issue — qty = To Issue, or Available if less"
            >
              Fill To Issue
            </button>
          }
        >
          {mat.isLoading ? (
            <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          ) : mat.isError ? (
            <div style={{ color: 'var(--red2)', fontSize: 'var(--fs-sm)' }}>
              {mat.error instanceof Error ? mat.error.message : 'Could not load material.'}
            </div>
          ) : against === 'job_card' && jcMat.data ? (
            <JcMaterialTable data={jcMat.data} />
          ) : against === 'assembly_so' && soMat.data ? (
            <SoMaterialTable data={soMat.data} />
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Items to issue">
        <IssueLinesEditor lines={lines} onChange={editLines} />
        {over ? (
          <IssueOverBox
            over={over}
            canApprove={canApprove}
            reason={confirmReason}
            onReasonChange={setConfirmReason}
          />
        ) : null}
      </Panel>

      <FormActions
        dirty={dirty}
        note={
          err ? (
            <Banner tone="error" role="alert" flush>
              {err}
            </Banner>
          ) : undefined
        }
      >
        <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
          {lastSaved ? 'Close' : 'Cancel'}
        </button>
        {over ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canIssueAnyway || createMut.isPending}
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
      </FormActions>
    </div>
  );
}
