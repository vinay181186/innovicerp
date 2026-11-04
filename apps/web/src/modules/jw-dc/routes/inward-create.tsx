// New Inward Entry — a full page (owner 2026-11-04: a create form with line items
// is a page). Receives processed material back against an outward DC that still
// has a pending return. The store records only how much came back; accept /
// reject happens at Incoming QC.

import { useSaveKey } from '@/lib/use-save-key';
import { type CreateJwDcInwardInput, type CreateJwDcInwardLineInput } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner, useToast } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { FormActions, PageHeader, useSaveShortcut } from '@/ui/layout';
import {
  useCreateJwDcInward,
  useJwDcOutwardDetail,
  useJwDcOutwardList,
  useNextInwardCode,
} from '../api';

export const jwDcInwardNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jw-dc/inward/new',
  component: JwDcInwardNewPage,
});

interface InwardLineUi {
  outwardLineId: string;
  itemCode: string;
  /** Customer's drawing revision off the order line behind this DC line. */
  itemRevision: string | null;
  /** The CUSTOMER's own purchase-order line number (POL), read-only. */
  clientPoLineNo: string | null;
  itemName: string;
  processText: string | null;
  sentQty: number;
  alreadyReturned: number;
  pending: number;
  receivedQty: number;
}

function JwDcInwardNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const goBack = useCallback(
    () => void navigate({ to: '/jw-dc', search: { tab: 'inward' } }),
    [navigate],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const [date, setDate] = useState(todayLocal());
  const [dcId, setDcId] = useState<string | null>(null);
  const [vendorChallan, setVendorChallan] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<InwardLineUi[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const { data: next } = useNextInwardCode();

  // Outward DCs with pending returns (filter client-side). Live DCs only — a
  // Cancelled DC (ADR-235) takes no return.
  const { data: outData } = useJwDcOutwardList({ limit: 200, offset: 0, includeCancelled: false });
  const pendingDcs = useMemo(
    () => (outData?.items ?? []).filter((d) => d.pendingQty > 0),
    [outData],
  );

  const { data: detail } = useJwDcOutwardDetail(dcId ?? undefined);
  // Seed the lines once per DC. A refetch of the SAME DC (window focus, a live
  // update) must not reset the Received Qty being typed (ADR-230).
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!detail || !dcId) {
      seededFor.current = null;
      setLines([]);
      return;
    }
    if (seededFor.current === dcId) return;
    seededFor.current = dcId;
    setLines(
      detail.lines.map((l) => ({
        outwardLineId: l.id,
        itemCode: l.itemCode ?? l.itemCodeText,
        itemRevision: l.itemRevision,
        clientPoLineNo: l.clientPoLineNo,
        itemName: l.itemName ?? l.itemNameText ?? '',
        processText: l.processText,
        sentQty: l.sentQty,
        alreadyReturned: l.alreadyReturned,
        pending: l.pending,
        receivedQty: l.pending,
      })),
    );
  }, [detail, dcId]);

  const saveKey = useSaveKey();
  const createMut = useCreateJwDcInward(saveKey);
  const toast = useToast();

  const onSave = (): void => {
    setErr(null);
    if (!dcId) {
      setErr('JW DC is required.');
      return;
    }
    const valid: CreateJwDcInwardLineInput[] = [];
    for (const l of lines) {
      if (l.receivedQty <= 0) continue;
      valid.push({ jwDcOutwardLineId: l.outwardLineId, receivedQty: l.receivedQty });
    }
    if (valid.length === 0) {
      setErr('Enter Receive Now for at least one line.');
      return;
    }
    const input: CreateJwDcInwardInput = {
      inwardDate: date,
      jwDcOutwardId: dcId,
      lines: valid,
    };
    if (vendorChallan.trim()) input.vendorChallanNo = vendorChallan.trim();
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: (saved) => {
        toast.ok(`Inward ${saved.code} saved`);
        exit.leave(goBack);
      },
      onError: (e) =>
        setErr(
          e instanceof Error ? e.message : 'Could not save Inward. Check the lines and try again.',
        ),
    });
  };
  useSaveShortcut(onSave, !createMut.isPending);

  const setLine = (i: number, patch: Partial<InwardLineUi>): void => {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const nextLine = { ...l, ...patch };
        // Re-clamp to pending bound
        nextLine.receivedQty = Math.min(Math.max(0, nextLine.receivedQty), l.pending);
        return nextLine;
      }),
    );
  };

  const dirty = dcId !== null || vendorChallan !== '' || vehicleNo !== '' || remarks !== '';

  return (
    <div>
      {exit.dialog}
      <PageHeader title="New Inward Entry" backLabel="Back to JW DC" onBack={goBack} />

      <Panel>
        {/* ADR-189 — Incoming QC is the only inspector. The store records what
            came back; accept / reject happens at Incoming QC, as for DC Receive. */}
        <Banner tone="info">Received qty goes to Incoming QC — no accept/deviate here.</Banner>
        <FormGrid>
          <FormField label="Inward No." size="sm" htmlFor="jwdc-in-code">
            <input
              id="jwdc-in-code"
              type="text"
              className="innovic-input"
              value={next?.code ?? '(auto on save)'}
              readOnly
            />
          </FormField>
          <FormField label="Inward Date" size="sm" htmlFor="jwdc-in-date">
            <input
              id="jwdc-in-date"
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="JW DC" required size="lg" htmlFor="jwdc-in-dc">
            <SearchableSelect
              id="jwdc-in-dc"
              value={dcId}
              onChange={setDcId}
              options={pendingDcs.map((dc) => ({
                id: dc.id,
                code: dc.code,
                name: `${dc.vendorName ?? dc.vendorNameText ?? dc.vendorCodeText ?? ''} (${dc.jwpoCodeText})`,
              }))}
              placeholder="-- Select DC --"
            />
          </FormField>
          <FormField label="Vendor Challan No." size="md" htmlFor="jwdc-in-challan">
            <input
              id="jwdc-in-challan"
              type="text"
              className="innovic-input"
              value={vendorChallan}
              onChange={(e) => setVendorChallan(e.target.value)}
              placeholder="Vendor reference"
            />
          </FormField>
          <FormField label="Vehicle No." size="md" htmlFor="jwdc-in-vehicle">
            <input
              id="jwdc-in-vehicle"
              type="text"
              className="innovic-input"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="GJ-05-XX-5678"
            />
          </FormField>
          <FormField label="Remarks" size="md" htmlFor="jwdc-in-remarks">
            <input
              id="jwdc-in-remarks"
              type="text"
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      {lines.length > 0 ? (
        <Panel title="DC Lines" bodyPadding="none">
          <table style={{ width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--bg4)' }}>
                <th style={{ padding: 6, color: 'var(--purple)' }}>POL</th>
                <th style={{ padding: 6 }}>Item Code · Name</th>
                <th style={{ padding: 6, color: 'var(--purple)' }}>Process</th>
                <th className="th-num" style={{ padding: 6 }}>
                  Sent
                </th>
                <th className="th-num" style={{ padding: 6, color: 'var(--green2)' }}>
                  Received
                </th>
                <th className="th-num" style={{ padding: 6, color: 'var(--amber2)' }}>
                  Pending
                </th>
                <th className="th-num" style={{ padding: 6 }}>
                  Receive Now
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const hasPending = l.pending > 0;
                return (
                  <tr
                    key={l.outwardLineId}
                    style={{
                      background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)',
                      opacity: hasPending ? 1 : 0.4,
                    }}
                  >
                    <td
                      className="td-ctr mono fw-700"
                      style={{ padding: 6, color: 'var(--purple)' }}
                    >
                      {l.clientPoLineNo ?? '—'}
                    </td>
                    <td style={{ padding: 6, fontSize: 12 }}>
                      <b>{itemCodeWithRev(l.itemCode, l.itemRevision)}</b>{' '}
                      <span style={{ color: 'var(--text3)' }}>{l.itemName}</span>
                    </td>
                    <td style={{ padding: 6, fontSize: 11, color: 'var(--purple)' }}>
                      {l.processText ?? '—'}
                    </td>
                    <td className="mono td-num" style={{ padding: 6 }}>
                      {l.sentQty}
                    </td>
                    <td className="mono td-num" style={{ padding: 6, color: 'var(--green2)' }}>
                      {l.alreadyReturned > 0 ? l.alreadyReturned : '0'}
                    </td>
                    <td
                      className="mono fw-700 td-num"
                      style={{ padding: 6, color: l.pending > 0 ? 'var(--amber)' : 'var(--green)' }}
                    >
                      {l.pending}
                    </td>
                    <td className="td-num" style={{ padding: 6 }}>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        max={l.pending}
                        value={l.receivedQty}
                        disabled={!hasPending}
                        onChange={(e) => {
                          const r = Math.min(Number(e.target.value) || 0, l.pending);
                          setLine(i, { receivedQty: r });
                        }}
                        style={{ width: 65, fontSize: 13, fontWeight: 700, textAlign: 'right' }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ) : null}

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
          disabled={createMut.isPending}
          onClick={onSave}
        >
          {createMut.isPending ? (
            <>
              <Loader2 size={14} className="inline animate-spin" /> Saving…
            </>
          ) : (
            'Save Inward'
          )}
        </button>
      </FormActions>
    </div>
  );
}
