// New Customer Material Return (ADR-203, owner decision D3) — sends the
// customer's own raw material back against one JWSO. A full page (owner
// 2026-11-04: a create form with line items is a page).
//
// Steps: pick the JWSO (open OR closed — material is often returned after the
// order closes) → the server lists what can still go back
// (GET /customer-material-returns/returnable): spare GOOD material per JWSO
// line, and REJECTED pieces per Party GRN line → type a Return Qty on the rows
// going back (blank = not this time) → Return Date, Vehicle No., Remarks →
// Save. The caps shown are the server's; it re-checks them under lock and its
// message is shown inline. After Save the page offers the print.
//
// Picking a different JWSO clears every typed qty (they belonged to the old
// JWSO's rows).

import type { CreateCustomerMaterialReturnInput, CustomerMaterialReturn } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { FormActions, PageHeader, useSaveShortcut } from '@/ui/layout';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useCreateCustomerMaterialReturn, useCustomerMaterialReturnable } from '../api';
import { CMR_KIND_LABEL } from '../components/cmr-columns';
import { CmrReturnableTable, cmrRowKey } from '../components/cmr-returnable-table';
import { usePrintCmr } from '../components/use-print-cmr';

export const customerMaterialReturnNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-material-returns/new',
  component: CustomerMaterialReturnNewPage,
});

function CustomerMaterialReturnNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const goBack = useCallback(() => void navigate({ to: '/customer-material-returns' }), [navigate]);
  const [saved, setSaved] = useState<CustomerMaterialReturn | null>(null);
  // Once saved there is nothing left to lose, so leaving never asks.
  const exit = useExitConfirm({ onExit: goBack, enabled: saved === null });
  const docPrint = usePrintCmr();

  const [returnDate, setReturnDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  /** Typed Return Qty per returnable row (cmrRowKey → text). */
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [printing, setPrinting] = useState<'preview' | 'download' | null>(null);

  // No status filter: a JWSO that has closed still has the customer's spare
  // or rejected material sitting in the store.
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];
  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwDetail = jwDetailQ.data && jwDetailQ.data.id === jwId ? jwDetailQ.data : null;
  const picked = jwHeaders.find((j) => j.jwId === jwId) ?? null;
  const customerName = picked?.customerName ?? jwDetail?.customerName ?? '';

  const returnableQ = useCustomerMaterialReturnable(jwId ?? undefined);
  const rows = useMemo(
    () => (returnableQ.data ?? []).filter((r) => r.returnableQty > 0),
    [returnableQ.data],
  );

  const saveKey = useSaveKey();
  const createMut = useCreateCustomerMaterialReturn(saveKey);

  const onPickJw = (id: string | null): void => {
    setJwId(id);
    setQtys({});
    setErr(null);
  };

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('JWSO No. is required.');
      return;
    }
    const lines: CreateCustomerMaterialReturnInput['lines'] = [];
    for (const r of rows) {
      const raw = (qtys[cmrRowKey(r)] ?? '').trim();
      if (!raw) continue;
      const q = Number(raw);
      const label = `JWSO L${r.jwLineNo} (${CMR_KIND_LABEL[r.kind]})`;
      if (!Number.isInteger(q) || q <= 0) {
        setErr(`${label}: Return Qty must be a whole number, 1 or more.`);
        return;
      }
      if (q > r.returnableQty) {
        setErr(`${label}: Return Qty (${q}) cannot be more than Returnable (${r.returnableQty}).`);
        return;
      }
      lines.push({
        kind: r.kind,
        jwLineId: r.jwLineId,
        ...(r.kind === 'rejected' && r.partyGrnLineId ? { partyGrnLineId: r.partyGrnLineId } : {}),
        qty: q,
      });
    }
    if (lines.length === 0) {
      setErr('Type a Return Qty on at least one row.');
      return;
    }
    const input: CreateCustomerMaterialReturnInput = { returnDate, jobWorkOrderId: jwId, lines };
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: (row) => setSaved(row),
      onError: (e) =>
        setErr(e instanceof Error ? e.message : 'Could not save the return. Try again.'),
    });
  };
  const canSave = !createMut.isPending && Boolean(jwId) && rows.length > 0;
  useSaveShortcut(onSave, canSave && saved === null);

  // After Save: say so and offer the paper that goes with the material.
  if (saved) {
    return (
      <div>
        {exit.dialog}
        <PageHeader
          title="Customer Material Return saved"
          backLabel="Back to Customer Material Return"
          onBack={goBack}
        />
        <Panel>
          <div style={{ fontSize: 'var(--fs-sm)' }}>
            <span className="mono fw-700">{saved.code}</span> — {saved.totalQty} pcs back to the
            customer on {saved.jwCode ?? 'the JWSO'}. Preview or download the return to send with
            the material.
          </div>
        </Panel>
        <FormActions>
          <button type="button" className="btn btn-ghost" onClick={goBack}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={printing !== null}
            onClick={() => {
              setPrinting('preview');
              void docPrint.preview(saved.id, saved.code).finally(() => setPrinting(null));
            }}
          >
            {printing === 'preview' ? <Loader2 size={14} className="inline animate-spin" /> : null}{' '}
            Preview
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={printing !== null}
            onClick={() => {
              setPrinting('download');
              void docPrint.download(saved.id, saved.code).finally(() => setPrinting(null));
            }}
          >
            {printing === 'download' ? <Loader2 size={14} className="inline animate-spin" /> : null}{' '}
            ⬇ Download PDF
          </button>
        </FormActions>
      </div>
    );
  }

  const dirty =
    jwId !== null ||
    vehicleNo !== '' ||
    remarks !== '' ||
    Object.values(qtys).some((q) => q.trim() !== '');

  return (
    <div>
      {exit.dialog}
      <PageHeader
        title="New Customer Material Return"
        backLabel="Back to Customer Material Return"
        onBack={goBack}
      />

      <Panel>
        <FormGrid>
          <FormField label="Return Date" required size="sm" htmlFor="cmr-date">
            <input
              id="cmr-date"
              type="date"
              className="innovic-input"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </FormField>
          <FormField label="JWSO No." required size="lg" htmlFor="cmr-jwso">
            <SearchableSelect
              id="cmr-jwso"
              value={jwId}
              onChange={onPickJw}
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
          <FormField label="Vehicle No." size="sm" htmlFor="cmr-vehicle">
            <input
              id="cmr-vehicle"
              type="text"
              className="innovic-input"
              autoComplete="off"
              maxLength={32}
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
            />
          </FormField>
          <FormField label="Customer" size="lg" htmlFor="cmr-customer">
            <input
              id="cmr-customer"
              type="text"
              className="innovic-input"
              readOnly
              value={customerName}
            />
          </FormField>
          <FormField label="Remarks" size="lg" htmlFor="cmr-remarks">
            <input
              id="cmr-remarks"
              type="text"
              className="innovic-input"
              autoComplete="off"
              maxLength={500}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel title="Material that can go back">
        {!jwId ? (
          <div className="empty-state" style={{ padding: 14 }}>
            Pick a JWSO first.
          </div>
        ) : returnableQ.isLoading ? (
          <div className="text3" style={{ fontSize: 'var(--fs-xs)', padding: 'var(--sp-2)' }}>
            <Loader2 size={13} className="inline animate-spin" /> Loading…
          </div>
        ) : returnableQ.isError ? (
          <div className="empty-state" style={{ color: 'var(--red2)', padding: 14 }}>
            {returnableQ.error instanceof Error
              ? returnableQ.error.message
              : 'Could not load what can be returned. Try again.'}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state" style={{ padding: 14 }}>
            Nothing of this customer&apos;s material is left to return on this JWSO.
          </div>
        ) : (
          <CmrReturnableTable
            rows={rows}
            qtys={qtys}
            onQtyChange={(k, v) => setQtys((prev) => ({ ...prev, [k]: v }))}
          />
        )}
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
          disabled={!canSave}
          title={
            !jwId
              ? 'Pick the JWSO No. first'
              : rows.length === 0
                ? returnableQ.isLoading
                  ? 'Loading what can be returned…'
                  : 'Nothing on this JWSO can be returned'
                : undefined
          }
          onClick={onSave}
        >
          {createMut.isPending ? (
            <>
              <Loader2 size={14} className="inline animate-spin" /> Saving…
            </>
          ) : (
            'Save Return'
          )}
        </button>
      </FormActions>
    </div>
  );
}
