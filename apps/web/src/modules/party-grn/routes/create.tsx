// New Party Material GRN — client-supplied material received against a JW order.
// A full page (owner 2026-11-04: a create form with line items is a page).
//
// ADR-203 (owner D4): the receipt and the QC are TWO steps. This page records
// only what arrived — per JWSO line, the Received Qty. The customer material
// itself is not picked: it is the line's own Customer RM (`<item>-RM`), so it
// can never mismatch the part. Accepted / Rejected are entered afterwards by
// Incoming QC (row ⋯ "Incoming QC" on the list → party-grn-qc-modal.tsx).
//
// Lines with no Customer RM yet (a JWSO saved before ADR-203) are shown greyed
// and cannot be received until the JWSO is saved again. Lines with nothing
// Pending are greyed too, with the reason (Waiting QC / Fully received).
//
// Every receivable line must carry a Received Qty; a line not on this challan
// is Deleted from the list (same button as SO creation) and can be restored.
//
// `?jw=<jwsoId>` (from the JWSO screens) opens with that JWSO already picked.

import type { CreatePartyGrnInput, CreatePartyGrnLineInput } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner, useToast } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { FormActions, PageHeader, useSaveShortcut } from '@/ui/layout';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useCreatePartyGrn, useNextPartyGrnCode } from '../api';
import { type LineEntry, PartyGrnReceiveLines } from '../components/party-grn-receive-lines';

const searchSchema = z.object({
  // A malformed id is ignored.
  jw: z.string().uuid().optional().catch(undefined),
});

export const partyGrnNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-grn/new',
  validateSearch: searchSchema,
  component: PartyGrnNewPage,
});

function PartyGrnNewPage(): React.JSX.Element {
  const { jw: initialJwId } = partyGrnNewRoute.useSearch();
  const navigate = useNavigate();
  const goBack = useCallback(() => void navigate({ to: '/party-grn' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const [date, setDate] = useState(todayLocal());
  const toast = useToast();
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(initialJwId ?? null);
  const [dcNo, setDcNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [entries, setEntries] = useState<Record<string, LineEntry>>({});
  // JWSO line ids the user Deleted — not rendered, not sent.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [err, setErr] = useState<string | null>(null);

  const nextCodeQ = useNextPartyGrnCode();
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    // Only JWSOs with at least one line still to receive.
    receivable: true,
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];
  const selectedJw = useMemo(
    () => jwHeaders.find((j) => j.jwId === jwId) ?? null,
    [jwHeaders, jwId],
  );
  // The picked JWSO's lines (with their Customer RM) come from its detail. A
  // `?jw=` deep link may name a JWSO not on the picker's first page.
  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwDetail = jwDetailQ.data && jwDetailQ.data.id === jwId ? jwDetailQ.data : null;
  const jwCustomerName = selectedJw?.customerName ?? jwDetail?.customerName ?? '';
  const jwClientPoNo = selectedJw?.clientPoNo ?? jwDetail?.clientPoNo ?? '';
  // Only lines still open take material; closed / cancelled lines are left out.
  const jwLines = useMemo(
    () =>
      (jwDetail?.lines ?? [])
        .filter((l) => l.status !== 'closed' && l.status !== 'cancelled')
        .sort((a, b) => a.lineNo - b.lineNo),
    [jwDetail],
  );

  // ADR-203 — the server's receipt cap per line: Pending = Order Qty −
  // (Accepted + received still Waiting QC). Rejected pieces do not count. The
  // server sends each line's Waiting QC qty (rmWaitingQcQty).
  const waitingOf = (lineId: string): number =>
    jwLines.find((x) => x.id === lineId)?.rmWaitingQcQty ?? 0;
  const pendingOf = (l: { id: string; orderQty: number; rmAcceptedQty: number }): number =>
    Math.max(0, l.orderQty - l.rmAcceptedQty - waitingOf(l.id));
  // A line can take material only with a Customer RM and something Pending.
  const canReceive = (l: {
    id: string;
    orderQty: number;
    rmAcceptedQty: number;
    partyMaterialId: string | null;
  }): boolean => Boolean(l.partyMaterialId) && pendingOf(l) > 0;
  const receivableCount = jwLines.filter(canReceive).length;
  const nothingToReceive = jwDetail !== null && receivableCount === 0;
  const visibleLines = jwLines.filter((l) => !removed.has(l.id));

  // R2 — one idempotency key per open form, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const createMut = useCreatePartyGrn(saveKey);

  const onJwChange = (id: string | null): void => {
    setJwId(id);
    // The typed quantities belong to the old JWSO's lines — never carry them over.
    setEntries({});
    setRemoved(new Set());
  };

  const onDeleteLine = (lineId: string): void => {
    setRemoved((prev) => new Set(prev).add(lineId));
    // A deleted line's typed qty + remarks go with it.
    setEntries((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== lineId)));
  };

  const setEntry = (lineId: string, patch: Partial<LineEntry>): void => {
    setEntries((prev) => {
      const cur = prev[lineId] ?? { receivedQty: '', remarks: '' };
      return { ...prev, [lineId]: { ...cur, ...patch } };
    });
  };

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('JWSO No. is required.');
      return;
    }
    if (!dcNo.trim()) {
      setErr('Customer Challan No. is required.');
      return;
    }
    const validLines: CreatePartyGrnLineInput[] = [];
    for (const l of jwLines) {
      // Greyed lines take nothing; Deleted lines were not on this challan.
      if (!canReceive(l) || removed.has(l.id)) continue;
      const e = entries[l.id];
      const raw = e?.receivedQty.trim() ?? '';
      const q = Number(raw);
      if (!raw || !Number.isInteger(q) || q <= 0) {
        setErr(`JWSO line ${l.lineNo}: enter Received Qty (1 or more), or Delete the line.`);
        return;
      }
      const pending = pendingOf(l);
      if (q > pending) {
        setErr(
          `JWSO line ${l.lineNo}: Received Qty ${q} is more than Pending ${pending} ` +
            `(Order Qty ${l.orderQty} − Accepted ${l.rmAcceptedQty} − Waiting QC ${waitingOf(l.id)}).`,
        );
        return;
      }
      const ln: CreatePartyGrnLineInput = { jwLineId: l.id, receivedQty: q };
      if (e?.remarks.trim()) ln.remarks = e.remarks.trim();
      validLines.push(ln);
    }
    if (validLines.length === 0) {
      setErr('Keep at least one line with a Received Qty.');
      return;
    }
    const input: CreatePartyGrnInput = {
      grnDate: date,
      jobWorkOrderId: jwId,
      dcNo: dcNo.trim(),
      lines: validLines,
    };
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: (created) => {
        toast.ok(`Party GRN ${created.code} saved`);
        exit.leave(goBack);
      },
      onError: (e) =>
        setErr(
          e instanceof Error ? e.message : 'Could not save GRN. Check the lines and try again.',
        ),
    });
  };
  useSaveShortcut(onSave, !createMut.isPending && !nothingToReceive);

  const dirty =
    jwId !== (initialJwId ?? null) ||
    dcNo !== '' ||
    remarks !== '' ||
    removed.size > 0 ||
    Object.values(entries).some((e) => e.receivedQty !== '' || e.remarks !== '');

  return (
    <div>
      {exit.dialog}
      <PageHeader title="New Party GRN" backLabel="Back to Party GRN" onBack={goBack} />

      <Panel>
        <FormGrid>
          <FormField label="GRN No." size="sm" htmlFor="pgrn-code">
            <input
              id="pgrn-code"
              type="text"
              className="innovic-input"
              readOnly
              value={nextCodeQ.data?.code ?? ''}
              style={{ fontWeight: 700, color: 'var(--cyan)' }}
            />
          </FormField>
          <FormField label="GRN Date" size="sm" htmlFor="pgrn-date">
            <input
              id="pgrn-date"
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="Client PO No." size="sm" htmlFor="pgrn-cpo">
            {/* A second way to pick the SAME JWSO: by the customer's PO. Both
                boxes set jwId, so they can never disagree; the shared search
                already matches Client PO No. on the server. A JWSO with no
                Client PO is left out here but stays in the JWSO No. picker. */}
            <SearchableSelect
              id="pgrn-cpo"
              value={jwId}
              onChange={onJwChange}
              onSearch={setJwSearch}
              loading={jwQuery.isFetching}
              error={jwQuery.error}
              placeholder="🔍 Select Client PO No.…"
              options={jwHeaders
                .filter((j) => (j.clientPoNo ?? '').trim() !== '')
                .map((j) => ({
                  id: j.jwId,
                  code: j.clientPoNo,
                  name: `${j.code} · ${j.customerName ?? ''}`,
                }))}
              selectedLabel={(o) => o.code ?? o.name}
              valueLabel={jwClientPoNo || undefined}
            />
          </FormField>
          <FormField label="Customer Challan No." required size="sm" htmlFor="pgrn-dc">
            <input
              id="pgrn-dc"
              type="text"
              className="innovic-input"
              autoComplete="off"
              maxLength={64}
              value={dcNo}
              onChange={(e) => setDcNo(e.target.value)}
            />
          </FormField>
          <FormField label="JWSO No." required size="lg" htmlFor="pgrn-jwso">
            <SearchableSelect
              id="pgrn-jwso"
              value={jwId}
              onChange={onJwChange}
              onSearch={setJwSearch}
              loading={jwQuery.isFetching}
              error={jwQuery.error}
              placeholder="🔍 Select JWSO — type number or customer…"
              options={jwHeaders.map((j) => ({
                id: j.jwId,
                code: j.code,
                name: j.customerName ?? '',
              }))}
              valueLabel={
                jwDetail ? `${jwDetail.code} — ${jwDetail.customerName ?? ''}` : undefined
              }
            />
          </FormField>
          <FormField label="Customer" size="lg" htmlFor="pgrn-client">
            <input
              id="pgrn-client"
              type="text"
              className="innovic-input"
              readOnly
              value={jwCustomerName}
            />
          </FormField>
          <FormField label="GRN Remarks" size="full" htmlFor="pgrn-remarks">
            <input
              id="pgrn-remarks"
              type="text"
              className="innovic-input"
              autoComplete="off"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel
        title="Line Items"
        actions={
          removed.size > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setRemoved(new Set())}
            >
              ↺ Restore deleted lines ({removed.size})
            </button>
          ) : null
        }
      >
        <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
          Delete the lines not on this challan. Accepted / Deviated are entered later by Incoming
          QC.
        </div>
        <PartyGrnReceiveLines
          jwId={jwId}
          loading={jwDetailQ.isLoading}
          loadError={
            jwDetailQ.isError
              ? jwDetailQ.error instanceof Error
                ? jwDetailQ.error.message
                : 'Could not load the JWSO lines.'
              : null
          }
          jwCode={jwDetail?.code ?? null}
          nothingToReceive={nothingToReceive}
          allDeleted={jwLines.length > 0 && visibleLines.length === 0}
          lines={visibleLines}
          entries={entries}
          canReceive={canReceive}
          waitingOf={waitingOf}
          pendingOf={pendingOf}
          setEntry={setEntry}
          onDeleteLine={onDeleteLine}
        />
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
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={createMut.isPending || nothingToReceive}
          title={nothingToReceive ? 'Nothing left to receive on this JWSO' : undefined}
          onClick={onSave}
        >
          {createMut.isPending ? (
            <>
              <Loader2 size={14} className="inline animate-spin" /> Saving…
            </>
          ) : (
            'Save GRN'
          )}
        </button>
      </FormActions>
    </div>
  );
}
