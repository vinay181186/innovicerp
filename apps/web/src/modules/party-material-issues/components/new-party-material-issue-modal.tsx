// New Customer Material Issue modal (ADR-079) — issues client-supplied material
// to a Job Card for in-house machining.
//
// ADR-203: the material is no longer a free choice. Cascade JWSO → Job Card →
// Customer RM, where the Customer RM is READ from the JWSO line the Job Card was
// raised against (jc.sourceLink.jobWorkOrderLineId → that line's partyMaterial).
// It is shown read-only and sent only once resolved; the server derives and
// checks the same thing on Save.

import { type CreatePartyMaterialIssueInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useJobCardsList } from '@/modules/job-cards/api';
import { useJobWorkOrder, useJobWorkOrdersList } from '@/modules/job-work-orders/api';
import { usePartyMaterialsList } from '@/modules/party-materials/api';
import { useDiscardGuard } from '@/modules/store-inventory/components/discard-guard';
import { useCreatePartyMaterialIssue, usePartyMaterialIssuable } from '../api';
import { Field } from './modal-field';

export function NewPartyMaterialIssueModal({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const [issueDate, setIssueDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jobWorkOrderId, setJobWorkOrderId] = useState<string | null>(null);
  const [jcSearch, setJcSearch] = useState('');
  const [jobCardId, setJobCardId] = useState<string | null>(null);
  // The JWSO line the picked Job Card draws on. Normally read off the JC; only
  // picked by hand when the JC's own line cannot be found on the JWSO.
  const [jcLineId, setJcLineId] = useState<string | null>(null);
  const [manualLineId, setManualLineId] = useState<string>('');
  const [qty, setQty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];

  // The picked JWSO is remembered, since the picker's option list changes with
  // every search.
  const [pickedJw, setPickedJw] = useState<{ code: string; clientId: string | null } | null>(null);

  // Only this JWSO's job cards: the JC search also matches the source JWSO
  // code, so with no JC typed the JWSO code brings its cards.
  const jcQuery = useJobCardsList(
    {
      search: jcSearch.trim() || pickedJw?.code || undefined,
      limit: 200,
      offset: 0,
    },
    { enabled: Boolean(jobWorkOrderId) },
  );
  const jcItems = useMemo(
    () =>
      (jcQuery.data?.items ?? []).filter(
        (jc) => jc.sourceLink?.type === 'jw' && jc.sourceLink.jobWorkOrderId === jobWorkOrderId,
      ),
    [jcQuery.data, jobWorkOrderId],
  );

  // The JWSO's lines carry each line's Customer RM (ADR-203).
  const jwDetailQ = useJobWorkOrder(jobWorkOrderId ?? undefined);
  const jwLines = useMemo(
    () =>
      jwDetailQ.data && jwDetailQ.data.id === jobWorkOrderId
        ? [...jwDetailQ.data.lines].sort((a, b) => a.lineNo - b.lineNo)
        : [],
    [jwDetailQ.data, jobWorkOrderId],
  );

  // Resolve the line: the JC's own source line; failing that the JWSO's only
  // line; failing that the line the user picks.
  const ownLine = jcLineId ? (jwLines.find((l) => l.id === jcLineId) ?? null) : null;
  const needsLinePick = Boolean(jobCardId) && !ownLine && jwLines.length > 1;
  const line =
    ownLine ??
    (jobCardId && jwLines.length === 1 ? (jwLines[0] ?? null) : null) ??
    (needsLinePick ? (jwLines.find((l) => l.id === manualLineId) ?? null) : null);
  const partyMaterialId = line?.partyMaterialId ?? null;

  // ADR-203: what may still go to this Job Card — the server's own figure
  // (JWSO line balance, capped by what the JC still needs), not the register
  // stock, which can belong to other lines of the same customer.
  const issuableQ = usePartyMaterialIssuable(jobCardId);
  const issuable = issuableQ.data && !issuableQ.isFetching ? issuableQ.data : null;

  // The material's code/name (the customer's materials, one fetch).
  const { data: pmData } = usePartyMaterialsList(
    {
      search: undefined,
      ...(pickedJw?.clientId ? { clientId: pickedJw.clientId } : {}),
      limit: 200,
      offset: 0,
    },
    { enabled: Boolean(partyMaterialId) },
  );
  const material = useMemo(
    () => (pmData?.items ?? []).find((p) => p.id === partyMaterialId) ?? null,
    [pmData, partyMaterialId],
  );

  const onJwChange = (id: string | null): void => {
    setJobWorkOrderId(id);
    const jw = jwHeaders.find((j) => j.jwId === id);
    setPickedJw(jw ? { code: jw.code, clientId: jw.clientId ?? null } : null);
    setJcSearch('');
    setJobCardId(null);
    setJcLineId(null);
    setManualLineId('');
  };
  const pickJc = (id: string | null): void => {
    setJobCardId(id);
    const jc = jcItems.find((j) => j.id === id);
    setJcLineId(jc?.sourceLink?.type === 'jw' ? jc.sourceLink.jobWorkOrderLineId : null);
    setManualLineId('');
  };

  // Auto-pick the JC when only one fits — once per JWSO, so clearing it by
  // hand is not undone.
  const autoJcFor = useRef<string | null>(null);
  useEffect(() => {
    if (!jobWorkOrderId || jobCardId || jcSearch.trim()) return;
    if (!jcQuery.data || jcQuery.isFetching || jcQuery.isPlaceholderData) return;
    if (autoJcFor.current === jobWorkOrderId) return;
    autoJcFor.current = jobWorkOrderId;
    const only = jcItems.length === 1 ? jcItems[0] : undefined;
    if (only) {
      setJobCardId(only.id);
      setJcLineId(only.sourceLink?.type === 'jw' ? only.sourceLink.jobWorkOrderLineId : null);
    }
  }, [
    jobWorkOrderId,
    jobCardId,
    jcSearch,
    jcQuery.data,
    jcQuery.isFetching,
    jcQuery.isPlaceholderData,
    jcItems,
  ]);

  const dirty = Boolean(jobWorkOrderId || qty.trim() || remarks.trim());
  const guard = useDiscardGuard(dirty, onClose);

  const createMut = useCreatePartyMaterialIssue();

  const onSave = (): void => {
    setErr(null);
    if (!jobWorkOrderId) {
      setErr('JWSO No. is required.');
      return;
    }
    if (!jobCardId) {
      setErr('JC No. is required. Work cannot start without it.');
      return;
    }
    if (needsLinePick && !line) {
      setErr('Pick the JWSO line this Job Card is for.');
      return;
    }
    if (line && !line.partyMaterialId) {
      setErr(`JWSO line ${line.lineNo} has no customer RM — save the JWSO first.`);
      return;
    }
    const q = Number(qty);
    if (!qty.trim() || !Number.isInteger(q) || q <= 0) {
      setErr('Issue Qty must be a whole number, 1 or more.');
      return;
    }
    if (!issuable) {
      setErr('Still checking the To Issue qty — try again in a moment.');
      return;
    }
    if (issuable.blockedReason) {
      setErr(`Nothing can be issued: ${issuable.blockedReason}`);
      return;
    }
    if (issuable.issuable <= 0) {
      setErr(
        `Nothing can be issued to this Job Card — accepted and not yet issued on its JWSO line ${issuable.lineBalance}, JC still needs ${issuable.jcRemaining}.`,
      );
      return;
    }
    if (q > issuable.issuable) {
      setErr(
        `Issue Qty ${q} is more than To Issue ${issuable.issuable} (line has ${issuable.lineBalance} · JC needs ${issuable.jcRemaining}).`,
      );
      return;
    }
    const input: CreatePartyMaterialIssueInput = {
      issueDate,
      jobWorkOrderId,
      jobCardId,
      qty: q,
    };
    // Sent only once resolved; the server derives it from the JC's line anyway.
    if (partyMaterialId) input.partyMaterialId = partyMaterialId;
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) =>
        setErr(
          e instanceof Error ? e.message : 'Could not save Issue. Check the lines and try again.',
        ),
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
        zIndex: 100,
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
          width: 'min(680px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          New Customer Material Issue
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Issue Date">
            <input
              type="date"
              className="innovic-input"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              style={{ maxWidth: '18ch' }}
            />
          </Field>
          <Field label="Issue Qty" required>
            <input
              type="number"
              min={1}
              step={1}
              {...(issuable ? { max: Math.max(issuable.issuable, 0) } : {})}
              className="innovic-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{
                fontSize: 14,
                fontWeight: 700,
                border: '2px solid var(--green)',
                borderRadius: 4,
                maxWidth: '12ch',
              }}
            />
          </Field>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="JWSO No." required>
              <SearchableSelect
                id="pmi-jwso"
                value={jobWorkOrderId}
                onChange={onJwChange}
                valueLabel={pickedJw?.code}
                onSearch={setJwSearch}
                loading={jwQuery.isFetching}
                placeholder="🔍 Select JWSO — type number or customer…"
                options={jwHeaders.map((j) => ({
                  id: j.jwId,
                  code: j.code,
                  name: j.customerName ?? '',
                }))}
              />
            </Field>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="JC No." required>
              <SearchableSelect
                id="pmi-jc"
                value={jobCardId}
                onChange={pickJc}
                onSearch={setJcSearch}
                loading={jcQuery.isFetching}
                disabled={!jobWorkOrderId}
                emptyText="No Job Card on this JWSO"
                placeholder={
                  jobWorkOrderId ? '🔍 Select Job Card of this JWSO…' : 'Pick the JWSO first'
                }
                options={jcItems.map((jc) => ({ id: jc.id, code: jc.code, name: jc.itemName }))}
              />
            </Field>
          </div>

          {needsLinePick ? (
            <div style={{ gridColumn: 'span 2' }}>
              <Field label="JWSO Line" required>
                <select
                  className="innovic-select"
                  value={manualLineId}
                  onChange={(e) => setManualLineId(e.target.value)}
                >
                  <option value="">Pick the line this Job Card is for…</option>
                  {jwLines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {`L${l.lineNo} · ${itemCodeWithRev(l.itemCodeText, l.revision)} · ${l.partName}`}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          {/* Customer RM — read-only, from the Job Card's JWSO line. */}
          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Customer RM">
              <div
                className="innovic-input"
                style={{
                  background: 'var(--bg4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 32,
                }}
              >
                {!jobCardId ? (
                  <span className="text3">Pick the Job Card first</span>
                ) : jwDetailQ.isLoading ? (
                  <span className="text3">
                    <Loader2 size={12} className="inline animate-spin" /> Loading…
                  </span>
                ) : !line ? (
                  <span className="text3">—</span>
                ) : !line.partyMaterialId ? (
                  <span style={{ color: 'var(--amber2)' }}>
                    No customer RM on JWSO line {line.lineNo} — save the JWSO first
                  </span>
                ) : (
                  <>
                    <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                      {line.rmItemCode ?? line.partyMaterialCode}
                    </span>
                    {material ? (
                      <span className="text3" style={{ fontSize: 11 }}>
                        {material.code} · {material.name}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </Field>
            {jobCardId ? (
              <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                {issuableQ.isError ? (
                  <span style={{ color: 'var(--red2)' }}>Could not load the To Issue qty.</span>
                ) : !issuable ? (
                  <span>
                    <Loader2 size={12} className="inline animate-spin" /> Checking To Issue qty…
                  </span>
                ) : (
                  <>
                    To Issue:{' '}
                    <span
                      style={{
                        color: issuable.issuable > 0 ? 'var(--green2)' : 'var(--red2)',
                        fontWeight: 700,
                      }}
                    >
                      {issuable.issuable}
                    </span>{' '}
                    NOS{' '}
                    <span style={{ fontSize: 10 }}>
                      {issuable.blockedReason
                        ? `— ${issuable.blockedReason}`
                        : `(line has ${issuable.lineBalance} · JC needs ${issuable.jcRemaining})`}
                    </span>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Remarks">
              <input
                type="text"
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Lot info, purpose, etc."
              />
            </Field>
          </div>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 12,
              padding: 8,
              background: 'rgba(239,68,68,0.08)',
              color: 'var(--red2)',
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={onSave}
          >
            {createMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save Issue'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
