// New Customer Material Issue modal (ADR-079) — issues client-supplied material
// to a Job Card for in-house machining. Split out of party-material-issue-view.tsx
// (ADR-199, table standard 2026-10-01). Unchanged behaviour: the JWSO → JC →
// Customer Material cascade, the auto-pick-when-one-fits helpers, the discard
// guard and the server-side re-checks on Save.

import { type CreatePartyMaterialIssueInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { useJobCardsList } from '@/modules/job-cards/api';
import { useJobWorkOrder, useJobWorkOrdersList } from '@/modules/job-work-orders/api';
import { usePartyMaterialsList } from '@/modules/party-materials/api';
import { partyMaterialFitsJwLine } from '@/modules/party-materials/fits-jw-line';
import { useDiscardGuard } from '@/modules/store-inventory/components/discard-guard';
import { useCreatePartyMaterialIssue } from '../api';
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
  const [pmSearch, setPmSearch] = useState('');
  const [partyMaterialId, setPartyMaterialId] = useState<string | null>(null);
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

  // Cascade JWSO → JC → Party Material (party-material-issue-create#1). The
  // picked JWSO / JC are remembered, since the pickers' option lists change
  // with every search. The server still makes the same checks on Save.
  const [pickedJw, setPickedJw] = useState<{ code: string; clientId: string | null } | null>(null);
  const [pickedJcItemId, setPickedJcItemId] = useState<string | null>(null);

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

  // ADR-195: the JWSO's own customer material (-rm item code) — a material
  // pinned to it is valid for every job card on this JWSO.
  const jwDetailQ = useJobWorkOrder(jobWorkOrderId ?? undefined);
  const jwClientMaterial =
    jwDetailQ.data && jwDetailQ.data.id === jobWorkOrderId ? jwDetailQ.data.clientMaterial : null;

  // Only the JWSO customer's materials, and — once a JC is picked — only the
  // ones for the part that JC makes or the JWSO's customer material (a
  // material with no Item Code still shows). Same rule the API enforces.
  const {
    data: pmData,
    isFetching: pmFetching,
    isPlaceholderData: pmStale,
  } = usePartyMaterialsList(
    {
      search: pmSearch.trim() || undefined,
      ...(pickedJw?.clientId ? { clientId: pickedJw.clientId } : {}),
      limit: 200,
      offset: 0,
    },
    { enabled: Boolean(jobWorkOrderId) },
  );
  const pmAll = useMemo(
    () =>
      (pmData?.items ?? []).filter((p) =>
        partyMaterialFitsJwLine(p, pickedJcItemId, jwClientMaterial),
      ),
    [pmData, pickedJcItemId, jwClientMaterial],
  );
  const selectedPm = useMemo(
    () => pmAll.find((p) => p.id === partyMaterialId) ?? null,
    [pmAll, partyMaterialId],
  );

  const onJwChange = (id: string | null): void => {
    setJobWorkOrderId(id);
    const jw = jwHeaders.find((j) => j.jwId === id);
    setPickedJw(jw ? { code: jw.code, clientId: jw.clientId ?? null } : null);
    setJcSearch('');
    setJobCardId(null);
    setPickedJcItemId(null);
    setPmSearch('');
    setPartyMaterialId(null);
  };
  const onJcChange = (id: string | null): void => {
    setJobCardId(id);
    setPickedJcItemId(jcItems.find((jc) => jc.id === id)?.itemId ?? null);
    setPartyMaterialId(null);
  };

  // Auto-pick when only one fits — once per parent pick, so clearing it by
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
      setPickedJcItemId(only.itemId);
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
  const autoPmFor = useRef<string | null>(null);
  useEffect(() => {
    if (!jobCardId || partyMaterialId || pmSearch.trim()) return;
    if (!pmData || pmFetching || pmStale) return;
    if (autoPmFor.current === jobCardId) return;
    autoPmFor.current = jobCardId;
    const only = pmAll.length === 1 ? pmAll[0] : undefined;
    if (only) setPartyMaterialId(only.id);
  }, [jobCardId, partyMaterialId, pmSearch, pmData, pmFetching, pmStale, pmAll]);

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
    if (!partyMaterialId) {
      setErr('Customer Material is required.');
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Issue Qty must be 1 or more.');
      return;
    }
    const input: CreatePartyMaterialIssueInput = {
      issueDate,
      jobWorkOrderId,
      jobCardId,
      partyMaterialId,
      qty: q,
    };
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
            />
          </Field>
          <Field label="Issue Qty" required>
            <input
              type="number"
              min={1}
              className="innovic-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{
                fontSize: 14,
                fontWeight: 700,
                border: '2px solid var(--green)',
                borderRadius: 4,
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
                onChange={onJcChange}
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

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Customer Material" required>
              <SearchableSelect
                id="pmi-material"
                value={partyMaterialId}
                onChange={setPartyMaterialId}
                onSearch={setPmSearch}
                loading={pmFetching}
                disabled={!jobWorkOrderId}
                emptyText="No material of this customer for this part"
                placeholder={
                  jobWorkOrderId
                    ? '🔍 Select party material — type code or name…'
                    : 'Pick the JWSO first'
                }
                options={pmAll.map((p) => ({
                  id: p.id,
                  code: p.code,
                  name: `${p.name} · Available ${p.stockQty}`,
                }))}
              />
            </Field>
            {selectedPm ? (
              <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                Available:{' '}
                <span style={{ color: 'var(--green2)', fontWeight: 700 }}>
                  {selectedPm.stockQty}
                </span>{' '}
                {selectedPm.uom}
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
